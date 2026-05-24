// TWILIO VIDEO — Phase 2 camera integration
// ─────────────────────────────────────────────────────────────────────────────
// These routes scaffold the Twilio Programmable Video flow used by the
// "Call Their Device" emergency button. When a caregiver's call is unanswered
// for 15 seconds, the mobile app calls /api/video/initiate which:
//   1. Sends an Expo push to the care-recipient's device asking it to activate
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
  createFirestoreDocAsCaller,
  fetchUserDocAsCaller,
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
 *
 * SECURITY — Firebase ID token auth on video endpoint
 * Required before App Store submission
 * Prevents unauthorized push-notification dispatch (would otherwise let any
 * unauth'd caller spam care-recipients with "your camera is being activated"
 * pushes — a serious abuse vector and HIPAA red flag).
 *
 * Headers: `Authorization: Bearer <Firebase ID token>`  (REQUIRED)
 * Body:    { receiverPushToken, receiverName?, caregiverName?, roomName,
 *            targetUserId }
 *
 * The caller's Firebase uid is verified, then matched against the receiver's
 * `permittedCaregivers` array (via Firestore REST forwarding the caller's
 * own ID token, so existing Security Rules govern read access). Same
 * room-name / target-uid binding as /video/token to prevent cross-receiver
 * confusion attacks.
 */
router.post(
  "/video/initiate",
  verifyFirebaseIdToken,
  async (req: Request, res: Response) => {
  try {
    const { receiverName, caregiverName, roomName, targetUserId } =
      req.body as {
        // NOTE — receiverPushToken from the client body is INTENTIONALLY
        // ignored. We resolve the token server-side from Firestore by
        // targetUserId so a permitted caregiver cannot weaponize this
        // endpoint to push "your camera is being activated" notifications
        // to arbitrary device tokens.
        receiverName?: string;
        caregiverName?: string;
        roomName?: string;
        targetUserId?: string;
      };
    const auth = req.firebaseAuth!;

    if (!roomName || !targetUserId) {
      return res
        .status(400)
        .json({ error: "roomName and targetUserId are required" });
    }

    // Defense-in-depth: room name must match deterministic format derived
    // from targetUserId (mirrors /video/token guard).
    if (!roomName.startsWith(`tc-emrg-${targetUserId.substring(0, 12)}-`)) {
      logger.warn(
        {
          action: "unauthorized_token_request",
          userId: auth.uid,
          targetUserId,
          roomName,
          reason: "room_target_mismatch",
          route: "/video/initiate",
        },
        "Initiate rejected — roomName does not match targetUserId",
      );
      return res.status(403).json({ error: "forbidden" });
    }

    // Permission: caller must be the receiver themselves OR a permitted
    // caregiver. The receiver activating their OWN camera is a degenerate
    // case but harmless — the push would just route to their own device.
    const permitted = await isPermittedForReceiver(auth, targetUserId);
    if (!permitted) {
      logger.warn(
        {
          action: "unauthorized_token_request",
          userId: auth.uid,
          targetUserId,
          roomName,
          reason: "not_permitted_caregiver",
          route: "/video/initiate",
        },
        "Initiate rejected — caller is not a permitted caregiver",
      );
      return res.status(403).json({ error: "forbidden" });
    }

    // PUSH-TARGET INTEGRITY — resolve the push token from Firestore for
    // the verified targetUserId, NOT from the request body. Even though
    // the caller is now an authenticated, permitted caregiver, allowing
    // them to specify an arbitrary `receiverPushToken` would let them
    // dispatch "camera is activating" pushes to any Expo device token —
    // a serious abuse vector and the exact class of issue HIPAA reviewers
    // flag. Read uses the caller's own ID token so existing Firestore
    // Security Rules govern visibility.
    const receiverDoc = await fetchUserDocAsCaller(auth.idToken, targetUserId);
    const receiverPushToken =
      (receiverDoc as { fields?: { expoPushToken?: { stringValue?: string } } } | null)
        ?.fields?.expoPushToken?.stringValue ?? "";

    // FIRESTORE SIGNALING FALLBACK — write a `cameraActivations` doc that
    // the receiver subscribes to via onSnapshot. This is the PRIMARY signal:
    // it works on every platform regardless of push token state (FCM-blocked
    // Android, app force-killed, silent mode, low power, missing iOS APNs
    // entitlement, etc). The push is now best-effort wakeup only.
    const signalDocName = await createFirestoreDocAsCaller(
      auth.idToken,
      "cameraActivations",
      {
        receiverUid: targetUserId,
        callerUid: auth.uid,
        callerName: caregiverName ?? "Caregiver",
        receiverName: receiverName ?? "Care recipient",
        roomName,
        status: "pending",
        createdAt: new Date(),
      },
    );

    if (!signalDocName) {
      logger.error(
        { callerUid: auth.uid, targetUserId, roomName },
        "Initiate failed — could not write cameraActivations signal doc",
      );
      return res.status(502).json({
        error: "signal_write_failed",
        message: "Could not signal the receiver's device. Please try again.",
      });
    }

    // Best-effort push wakeup — fires only if the receiver has a valid token
    // on file. Failure here is logged but does NOT fail the request, because
    // the Firestore signal above is what actually triggers camera activation
    // on devices with the app foregrounded or recently backgrounded.
    let pushSent = false;
    if (receiverPushToken && receiverPushToken.startsWith("ExponentPushToken")) {
      const title = "Camera Activation — Emergency";
      const body = `${caregiverName ?? "Your caregiver"} needs to see ${receiverName ?? "you"} now. Your front camera is being activated.`;
      const pushResult = await sendPush([receiverPushToken], title, body, {
        type: "camera_activate",
        roomName,
        caregiverName: caregiverName ?? "Caregiver",
        // Defensive: include the intended receiver UID so the mobile listener
        // can ignore the push if the device happens to be logged into a
        // different account (e.g. stale push token routed to wrong device).
        receiverUid: targetUserId,
      });
      pushSent = pushResult.delivered;
      if (!pushResult.delivered) {
        logger.warn(
          { roomName, targetUserId, callerUid: auth.uid, validTokens: pushResult.validTokens },
          "Camera activation push wakeup failed (Firestore signal still delivered)",
        );
      }
    } else {
      logger.info(
        { callerUid: auth.uid, targetUserId, roomName, hasToken: !!receiverPushToken },
        "Skipping push wakeup — no valid Expo push token on file (Firestore signal still delivered)",
      );
    }

    logger.info(
      { roomName, receiverName, caregiverName, targetUserId, callerUid: auth.uid, pushSent, signalDoc: signalDocName },
      "Camera activation signaled (auth verified)",
    );

    return res.json({
      ok: true,
      roomName,
      pushSent,
      signalWritten: true,
      videoConfigured: isVideoConfigured(),
    });
  } catch (err) {
    logger.error({ err }, "/api/video/initiate failed");
    return res.status(500).json({ error: "internal_error" });
  }
  },
);

export default router;
