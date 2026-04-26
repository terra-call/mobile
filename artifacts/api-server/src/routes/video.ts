// TWILIO VIDEO — Phase 2 camera integration
// ─────────────────────────────────────────────────────────────────────────────
// These routes scaffold the Twilio Programmable Video flow used by the
// "Call Their Device" emergency button. When a caregiver's call is unanswered
// for 15 seconds, the mobile app calls /api/video/initiate which:
//   1. Sends an Expo push to the care-receiver's device asking it to activate
//      the front camera and join a Twilio Video room
//   2. Returns the room name + a fresh access token to the caregiver so the
//      caregiver app can join the same room as a subscriber
//
// The actual `twilio-video` SDK is not yet installed. To enable real video,
// the operator must:
//   a. Add TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET to environment secrets
//   b. `pnpm --filter @workspace/api-server add twilio` (already a dep)
//   c. Install `@twilio/video-react-native-sdk` in the mobile app and ship a
//      custom EAS dev build (Expo Go does not support the native module)
//
// Until those creds exist, /token returns 503 with a clear error so the client
// can show a "Camera not available yet" fallback instead of crashing.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { sendPush } from "../lib/notificationScheduler";

const router: IRouter = Router();

function isVideoConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET
  );
}

/**
 * POST /api/video/token
 * Body: { identity: string, roomName: string }
 * Mints a short-lived Twilio Video access token so the requesting client
 * can join the named room.
 */
router.post("/video/token", async (req: Request, res: Response) => {
  const { identity, roomName } = req.body as { identity?: string; roomName?: string };

  if (!identity || !roomName) {
    return res.status(400).json({ error: "identity and roomName are required" });
  }

  if (!isVideoConfigured()) {
    return res.status(503).json({
      error: "video_not_configured",
      message:
        "Twilio Video credentials are not configured on the server. Add TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET to enable.",
    });
  }

  // TWILIO VIDEO — Phase 2 camera integration
  // Once creds exist, swap this stub for:
  //   import twilio from "twilio";
  //   const AccessToken = twilio.jwt.AccessToken;
  //   const VideoGrant = AccessToken.VideoGrant;
  //   const token = new AccessToken(
  //     process.env.TWILIO_ACCOUNT_SID!,
  //     process.env.TWILIO_API_KEY_SID!,
  //     process.env.TWILIO_API_KEY_SECRET!,
  //     { identity, ttl: 3600 }
  //   );
  //   token.addGrant(new VideoGrant({ room: roomName }));
  //   return res.json({ token: token.toJwt(), roomName, identity });
  return res.status(503).json({
    error: "video_not_configured",
    message: "Twilio Video token minting is stubbed. Install twilio-video SDK integration.",
  });
});

/**
 * POST /api/video/initiate
 * Body: { receiverPushToken: string, receiverName: string, caregiverName: string, roomName: string }
 * Notifies the care-receiver's device via push notification to activate
 * the front camera and join the named Twilio Video room.
 *
 * SECURITY NOTE — Phase 2 follow-up:
 * This endpoint is currently unauthenticated. Before going to production it
 * MUST be hardened with: (a) Firebase ID-token verification of the caller,
 * (b) Firestore lookup confirming the caller is a permitted caregiver of
 * the receiver, and (c) a server-side re-check of the receiver's stored
 * cameraConsent flag. The client-side checks today are convenience-only and
 * could be bypassed by anyone who can reach the server.
 */
router.post("/video/initiate", async (req: Request, res: Response) => {
  try {
    const { receiverPushToken, receiverName, caregiverName, roomName } = req.body as {
      receiverPushToken?: string;
      receiverName?: string;
      caregiverName?: string;
      roomName?: string;
    };

    if (!receiverPushToken || !roomName) {
      return res.status(400).json({ error: "receiverPushToken and roomName are required" });
    }

    if (!receiverPushToken.startsWith("ExponentPushToken")) {
      return res.status(400).json({
        error: "invalid_push_token",
        message: "receiverPushToken does not look like a valid Expo push token",
      });
    }

    const title = "Camera Activation — Emergency";
    const body = `${caregiverName ?? "Your caregiver"} needs to see ${receiverName ?? "you"} now. Your front camera is being activated.`;

    // High-priority push with data payload that the mobile app's notification
    // listener uses to navigate the receiver into the camera-publish screen.
    const pushResult = await sendPush([receiverPushToken], title, body, {
      type: "camera_activate",
      roomName,
      caregiverName: caregiverName ?? "Caregiver",
    });

    if (!pushResult.delivered) {
      logger.warn(
        { roomName, receiverName, validTokens: pushResult.validTokens },
        "Camera activation push failed to dispatch"
      );
      return res.status(502).json({
        error: "push_dispatch_failed",
        message: "Could not reach the receiver's device. Please try again.",
      });
    }

    logger.info({ roomName, receiverName, caregiverName }, "Camera activation push sent");

    return res.json({
      ok: true,
      roomName,
      pushSent: true,
      videoConfigured: isVideoConfigured(),
    });
  } catch (err) {
    logger.error({ err }, "/api/video/initiate failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
