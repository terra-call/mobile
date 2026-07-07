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
  fetchFirestoreDocAsCaller,
  fetchUserDocAsCaller,
  isPermittedForReceiver,
  verifyFirebaseIdToken,
} from "../middlewares/firebaseAuth";
import { sendPush, PUSH_CHANNELS, TERRA_CALL_ALERT_SOUND } from "../lib/notificationScheduler";

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
    const { roomName, targetUserId, activationDocId } = req.body as {
      roomName?: string;
      targetUserId?: string;
      activationDocId?: string;
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

    // Defense-in-depth: room name must match one of the deterministic formats
    // used by the mobile client:
    //   • tc-emrg-<targetPrefix12>-<stamp>  — emergency caregiver-initiated
    //   • tc-call-<targetPrefix12>-<stamp>  — recipient-initiated "Call My Caregiver"
    // In both flows the room is keyed on the care-recipient uid, so the
    // targetUserId prefix check works identically.
    const prefixEmrg = `tc-emrg-${targetUserId.substring(0, 12)}-`;
    const prefixCall = `tc-call-${targetUserId.substring(0, 12)}-`;
    if (!roomName.startsWith(prefixEmrg) && !roomName.startsWith(prefixCall)) {
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

    // Permission split by flow:
    //   • tc-emrg-* (caregiver→recipient emergency) — caller must be the
    //     receiver themselves OR any permitted caregiver. Multiple caregivers
    //     joining is desired in an emergency (e.g. spouse + adult child).
    //   • tc-call-* (recipient→caregiver "Call My Caregiver") — caller must
    //     be EXACTLY the recipient or the signaled caregiverId from the
    //     cameraActivations doc. Permitted-but-not-signaled caregivers MUST
    //     NOT be able to join uninvited — this is a private 1:1 call.
    if (roomName.startsWith(prefixCall)) {
      if (!activationDocId) {
        logger.warn(
          {
            action: "unauthorized_token_request",
            userId: auth.uid,
            targetUserId,
            roomName,
            reason: "missing_activation_doc_for_call",
          },
          "tc-call token request rejected — activationDocId required",
        );
        return res.status(400).json({ error: "activationDocId required" });
      }
      const doc = await fetchFirestoreDocAsCaller(
        auth.idToken,
        "cameraActivations",
        activationDocId,
      );
      const fields =
        (doc as {
          fields?: {
            recipientId?: { stringValue?: string };
            caregiverId?: { stringValue?: string };
            initiatedBy?: { stringValue?: string };
            roomName?: { stringValue?: string };
          };
        } | null)?.fields;
      const signaledRecipientId = fields?.recipientId?.stringValue;
      const signaledCaregiverId = fields?.caregiverId?.stringValue;
      const initiatedBy = fields?.initiatedBy?.stringValue;
      const signaledRoom = fields?.roomName?.stringValue;
      if (
        !fields ||
        initiatedBy !== "recipient" ||
        signaledRoom !== roomName ||
        signaledRecipientId !== targetUserId
      ) {
        logger.warn(
          {
            action: "unauthorized_token_request",
            userId: auth.uid,
            targetUserId,
            roomName,
            activationDocId,
            reason: "activation_doc_mismatch",
          },
          "tc-call token request rejected — activation doc not found or mismatched",
        );
        return res.status(403).json({ error: "forbidden" });
      }
      // Identity must be one of the two signaled participants. No "permitted
      // caregiver B" smuggling in via the broader permittedCaregivers list.
      if (auth.uid !== signaledRecipientId && auth.uid !== signaledCaregiverId) {
        logger.warn(
          {
            action: "unauthorized_token_request",
            userId: auth.uid,
            targetUserId,
            roomName,
            activationDocId,
            reason: "caller_not_signaled_participant",
          },
          "tc-call token request rejected — caller is neither the signaled recipient nor caregiver",
        );
        return res.status(403).json({ error: "forbidden" });
      }
    } else {
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
    const signalResult = await createFirestoreDocAsCaller(
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

    if (!signalResult.ok) {
      logger.error(
        {
          callerUid: auth.uid,
          targetUserId,
          roomName,
          permissionDenied: signalResult.permissionDenied,
          firestoreStatus: signalResult.status,
        },
        "Initiate failed — could not write cameraActivations signal doc",
      );
      if (signalResult.permissionDenied) {
        // Rules-vs-code drift: the server's permission check passed, but the
        // Firestore Security Rules denied the create. Almost always means the
        // rules file in this repo hasn't been deployed to Firebase. Return
        // 403 (not 502) so the mobile app + ops surface this as an auth
        // problem rather than a server outage.
        return res.status(403).json({
          error: "firestore_rules_denied",
          message:
            "This call could not be signaled. Please contact support if the problem persists.",
        });
      }
      return res.status(502).json({
        error: "signal_write_failed",
        message: "Could not signal the receiver's device. Please try again.",
      });
    }
    const signalDocName = signalResult.name;

    // Best-effort push wakeup — fires only if the receiver has a valid token
    // on file. Failure here is logged but does NOT fail the request, because
    // the Firestore signal above is what actually triggers camera activation
    // on devices with the app foregrounded or recently backgrounded.
    let pushSent = false;
    if (receiverPushToken && receiverPushToken.startsWith("ExponentPushToken")) {
      // The CAREGIVER's name is shown on the recipient's incoming-call
      // notification (e.g. "Pat is calling"). This is NOT a PHI concern —
      // it's the caregiver's identity, not the care recipient's health info,
      // and it makes the call recognizable/answerable from a locked screen.
      // (The recipient's OWN name is still kept out of any push per replit.md.)
      const callerLabel = caregiverName?.trim() || "Your caregiver";
      const title = `${callerLabel} is calling`;
      const body = `${callerLabel} is checking on you. Tap to answer.`;
      const pushResult = await sendPush([receiverPushToken], title, body, {
        type: "camera_activate",
        initiatedBy: "caregiver",
        roomName,
        caregiverName: caregiverName ?? "Caregiver",
        // Defensive: include the intended receiver UID so the mobile listener
        // can ignore the push if the device happens to be logged into a
        // different account (e.g. stale push token routed to wrong device).
        receiverUid: targetUserId,
      }, {
        channelId: PUSH_CHANNELS.incomingCalls,
        sound: TERRA_CALL_ALERT_SOUND,
        priority: "high",
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

/**
 * POST /api/video/receiver-initiate
 *
 * Recipient-initiated "Call My Caregiver" flow. The care recipient taps the
 * blue button on their home screen; this endpoint writes a cameraActivations
 * doc with `initiatedBy: "recipient"` that the caregiver's app listens for
 * to surface an incoming-call modal. NOT an emergency — no SMS, no push,
 * no missed-checkin escalation.
 *
 * Headers: `Authorization: Bearer <Firebase ID token>` (REQUIRED)
 * Body:    { caregiverId: string, roomName: string,
 *            recipientName?: string, caregiverName?: string }
 *
 * AUTH GATE (mirrors /video/initiate pattern):
 *   1. verifyFirebaseIdToken — cryptographic ID-token check
 *   2. The caller IS the recipient (recipientId == auth.uid is implicit;
 *      we write it server-side from the verified uid)
 *   3. caregiverId must be listed on the recipient's `permittedCaregiverIds`
 *      array (prevents calling arbitrary uids)
 *   4. roomName must match `tc-call-<callerPrefix12>-<stamp>` to bind the
 *      room to the recipient (same defense-in-depth as /video/token)
 */
router.post(
  "/video/receiver-initiate",
  verifyFirebaseIdToken,
  async (req: Request, res: Response) => {
    try {
      const { caregiverId, roomName, recipientName, caregiverName } =
        req.body as {
          caregiverId?: string;
          roomName?: string;
          recipientName?: string;
          caregiverName?: string;
        };
      const auth = req.firebaseAuth!;

      if (!caregiverId || !roomName) {
        return res
          .status(400)
          .json({ error: "caregiverId and roomName are required" });
      }

      // Room name must be derived from the caller's own uid (the recipient).
      const expectedPrefix = `tc-call-${auth.uid.substring(0, 12)}-`;
      if (!roomName.startsWith(expectedPrefix)) {
        logger.warn(
          {
            action: "unauthorized_token_request",
            userId: auth.uid,
            caregiverId,
            roomName,
            reason: "room_caller_mismatch",
            route: "/video/receiver-initiate",
          },
          "Receiver-initiate rejected — roomName does not match caller uid",
        );
        return res.status(403).json({ error: "forbidden" });
      }

      // PERMISSION — caregiverId must be a permitted caregiver on the
      // recipient's own user doc. Reads use the caller's ID token so existing
      // Firestore Security Rules govern visibility (no admin bypass).
      const recipientDoc = await fetchUserDocAsCaller(auth.idToken, auth.uid);
      const permittedRaw =
        (recipientDoc as {
          fields?: {
            permittedCaregiverIds?: {
              arrayValue?: { values?: Array<{ stringValue?: string }> };
            };
          };
        } | null)?.fields?.permittedCaregiverIds?.arrayValue?.values ?? [];
      const permittedIds = permittedRaw
        .map((v) => v.stringValue)
        .filter((s): s is string => typeof s === "string");

      if (!permittedIds.includes(caregiverId)) {
        logger.warn(
          {
            action: "unauthorized_token_request",
            userId: auth.uid,
            caregiverId,
            roomName,
            reason: "caregiver_not_permitted",
            route: "/video/receiver-initiate",
          },
          "Receiver-initiate rejected — caregiverId not in recipient's permittedCaregiverIds",
        );
        return res.status(403).json({ error: "forbidden" });
      }

      // Write the cameraActivations signal doc using the caller's token so
      // Firestore Security Rules also enforce the recipient → caregiver
      // direction (defense-in-depth against server bugs).
      const signalResult = await createFirestoreDocAsCaller(
        auth.idToken,
        "cameraActivations",
        {
          callerUid: auth.uid,
          recipientId: auth.uid,
          caregiverId,
          initiatedBy: "recipient",
          callerName: recipientName ?? "Care recipient",
          recipientName: recipientName ?? "Care recipient",
          caregiverName: caregiverName ?? "Caregiver",
          roomName,
          status: "pending",
          createdAt: new Date(),
        },
      );

      if (!signalResult.ok) {
        logger.error(
          {
            callerUid: auth.uid,
            caregiverId,
            roomName,
            permissionDenied: signalResult.permissionDenied,
            firestoreStatus: signalResult.status,
          },
          "Receiver-initiate failed — could not write cameraActivations doc",
        );
        if (signalResult.permissionDenied) {
          // Rules-vs-code drift: the server's permittedCaregiverIds check
          // passed but Firestore Security Rules denied the create. Almost
          // always means the rules file in this repo hasn't been deployed
          // to Firebase (`firebase deploy --only firestore:rules`). Return
          // 403 with a distinct error code so the mobile app surfaces this
          // as "caregiver unavailable" rather than a generic server outage.
          return res.status(403).json({
            error: "firestore_rules_denied",
            message:
              "Your caregiver link is not fully set up. Please contact support if this keeps happening.",
          });
        }
        return res.status(502).json({
          error: "signal_write_failed",
          message: "Could not reach your caregiver. Please try again.",
        });
      }
      const signalDocName = signalResult.name;

      // signalDocName is "projects/<pid>/databases/(default)/documents/cameraActivations/<id>".
      // Strip everything before the final "/" to get just the docId so the
      // client can subscribe to status updates without a second roundtrip.
      const signalDocId =
        signalDocName.split("/").pop() ?? signalDocName;

      // PUSH WAKEUP — best effort. The Firestore signal above is the primary
      // delivery mechanism, but it only fires while the caregiver app is
      // foregrounded (Firestore onSnapshot pauses in background). Sending a
      // push wakes the caregiver's device so the listener subscribes in time
      // for the recipient's 45s call timeout. Mirrors the caregiver→recipient
      // direction in /video/initiate.
      //
      // PHI hygiene (per replit.md): title/body are generic with NO names.
      // The recipient name is forwarded in the `data` payload only, which is
      // delivered to the app silently and not shown on a locked screen.
      let pushSent = false;
      try {
        const caregiverDoc = await fetchUserDocAsCaller(auth.idToken, caregiverId);
        const caregiverPushToken =
          (caregiverDoc as {
            fields?: { expoPushToken?: { stringValue?: string } };
          } | null)?.fields?.expoPushToken?.stringValue ?? "";

        if (caregiverPushToken && caregiverPushToken.startsWith("ExponentPushToken")) {
          const title = "Incoming Video Call";
          const body = "Tap to answer";
          const pushResult = await sendPush([caregiverPushToken], title, body, {
            type: "incoming_call",
            initiatedBy: "recipient",
            roomName,
            recipientName: recipientName ?? "Care recipient",
            recipientId: auth.uid,
            signalDocId,
            // Defensive: the caregiver listener can ignore the push if the
            // device is logged into a different account than the intended
            // caregiver (e.g. stale token routed to wrong device).
            caregiverUid: caregiverId,
          }, {
            channelId: PUSH_CHANNELS.incomingCalls,
            sound: TERRA_CALL_ALERT_SOUND,
            priority: "high",
          });
          pushSent = pushResult.delivered;
          if (!pushResult.delivered) {
            logger.warn(
              { roomName, caregiverId, callerUid: auth.uid, validTokens: pushResult.validTokens },
              "Recipient-initiated call push wakeup failed (Firestore signal still delivered)",
            );
          }
        } else {
          logger.info(
            { callerUid: auth.uid, caregiverId, roomName, hasToken: !!caregiverPushToken },
            "Skipping caregiver push wakeup — no valid Expo push token on file (Firestore signal still delivered)",
          );
        }
      } catch (pushErr) {
        // Best-effort: never fail the request because push send blew up.
        logger.warn(
          {
            err: pushErr instanceof Error ? pushErr.message : String(pushErr),
            roomName,
            caregiverId,
          },
          "Recipient-initiated call push wakeup threw (Firestore signal still delivered)",
        );
      }

      logger.info(
        { roomName, recipientId: auth.uid, caregiverId, pushSent, signalDoc: signalDocName },
        "Recipient-initiated call signaled (auth verified)",
      );

      return res.json({
        ok: true,
        roomName,
        signalDocId,
        signalWritten: true,
        pushSent,
        videoConfigured: isVideoConfigured(),
      });
    } catch (err) {
      logger.error({ err }, "/api/video/receiver-initiate failed");
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

export default router;
