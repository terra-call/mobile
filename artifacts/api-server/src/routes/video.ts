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
import twilio from "twilio";
import { logger } from "../lib/logger";
import {
  isPermittedForReceiver,
  verifyFirebaseIdToken,
} from "../middlewares/firebaseAuth";
import { sendPush } from "../lib/notificationScheduler";

const router: IRouter = Router();

const VIDEO_TOKEN_TTL_SECONDS = 3600; // 1 hour — Twilio max is 24h, 1h is plenty for an emergency room

function isVideoConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET
  );
}

/**
 * POST /api/video/token
 *
 * SECURITY — Firebase ID token auth on video endpoint
 * Required before App Store submission
 * Prevents unauthorized token minting
 *
 * Headers: `Authorization: Bearer <Firebase ID token>`  (REQUIRED)
 * Body:    { roomName: string, targetUserId: string }
 *
 * Identity is derived SERVER-SIDE from the verified Firebase uid — clients
 * cannot supply or override it. Permission is checked against the
 * `permittedCaregivers` array on the receiver's user doc via Firestore
 * REST, forwarding the caller's own ID token so existing Security Rules
 * enforce read access (no admin-credential bypass).
 *
 * Defense-in-depth: the requested `roomName` MUST be derived from
 * `targetUserId` (matches the deterministic format
 * `tc-emrg-<targetUserIdPrefix12>-<stamp>`) so a caller can't pass a
 * receiver they're permitted for while actually requesting tokens for a
 * different receiver's room.
 */
router.post(
  "/video/token",
  verifyFirebaseIdToken,
  async (req: Request, res: Response) => {
    const { roomName, targetUserId } = req.body as {
      roomName?: string;
      targetUserId?: string;
    };
    const auth = req.firebaseAuth!;

    if (!roomName || !targetUserId) {
      return res
        .status(400)
        .json({ error: "roomName and targetUserId are required" });
    }

    // Server-derived identity. Never trust a client-supplied identity field —
    // the whole point of this middleware is to bind tokens to verified uids.
    const identity = auth.uid;

    // Defense-in-depth: room name must match the deterministic format used
    // by the mobile client's buildVideoRoomName(receiverId).
    const expectedPrefix = `tc-emrg-${targetUserId.substring(0, 12)}-`;
    if (!roomName.startsWith(expectedPrefix)) {
      logger.warn(
        {
          action: "unauthorized_token_request",
          userId: auth.uid,
          targetUserId,
          roomName,
          reason: "room_target_mismatch",
        },
        "Token request rejected — roomName does not match targetUserId",
      );
      return res.status(403).json({ error: "forbidden" });
    }

    // Permission: caller is the receiver themselves OR a permitted caregiver.
    const permitted = await isPermittedForReceiver(auth, targetUserId);
    if (!permitted) {
      logger.warn(
        {
          action: "unauthorized_token_request",
          userId: auth.uid,
          targetUserId,
          roomName,
          reason: "not_permitted_caregiver",
        },
        "Token request rejected — caller is not the receiver nor a permitted caregiver",
      );
      return res.status(403).json({ error: "forbidden" });
    }

    if (!isVideoConfigured()) {
      return res.status(503).json({
        error: "video_not_configured",
        message:
          "Twilio Video credentials are not configured on the server. Add TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET to enable.",
      });
    }

    try {
      const AccessToken = twilio.jwt.AccessToken;
      const VideoGrant = AccessToken.VideoGrant;

      const token = new AccessToken(
        process.env.TWILIO_ACCOUNT_SID!,
        process.env.TWILIO_API_KEY_SID!,
        process.env.TWILIO_API_KEY_SECRET!,
        { identity, ttl: VIDEO_TOKEN_TTL_SECONDS },
      );
      token.addGrant(new VideoGrant({ room: roomName }));

      logger.info(
        { identity, roomName, targetUserId },
        "Twilio Video access token minted (auth verified)",
      );
      return res.json({
        token: token.toJwt(),
        roomName,
        identity,
        ttlSeconds: VIDEO_TOKEN_TTL_SECONDS,
      });
    } catch (err) {
      logger.error(
        { err, identity, roomName },
        "Failed to mint Twilio Video token",
      );
      return res.status(500).json({ error: "token_mint_failed" });
    }
  },
);

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
