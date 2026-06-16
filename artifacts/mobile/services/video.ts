// TWILIO VIDEO — Phase 2 camera integration
// ─────────────────────────────────────────────────────────────────────────────
// Client-side helpers for the camera-activation flow used by the emergency
// "Call Their Device" button.
//
// Real Twilio Video room joining (publishing front-camera + subscribing to
// remote tracks) requires `@twilio/video-react-native-sdk`, which is a native
// module and therefore needs a custom EAS dev build of the app — Expo Go will
// not work for actual video streaming. The consent flow, the 15-second timer,
// the push-notification trigger, the receiver's screen and the caregiver's
// viewer screen all work in Expo Go for end-to-end flow testing.
// ─────────────────────────────────────────────────────────────────────────────

// TODO — PRE-SUBMISSION (HIGH):
// 1. ✅ DONE — /api/video/token now requires a Firebase ID token in the
//    Authorization header. Verified server-side via Google's public JWKS
//    (jose library, no service-account credentials required). See
//    artifacts/api-server/src/middlewares/firebaseAuth.ts.
// 2. Install @twilio/video-react-native-sdk and test
//    real room connections via EAS dev build

import { doc, getDoc } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "./firebase";
import { logAudit } from "./audit";

// Normalize: strip a trailing slash AND a trailing `/api` so the value is
// always the bare origin. Historically the workspace `.replit` env had this
// URL ending in `/api`, which silently double-prefixed every fetch to
// `/api/api/...` and produced 404s. Tolerate both shapes so an env-var typo
// can never resurrect that bug.
const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "")
  .replace(/\/$/, "")
  .replace(/\/api$/, "");

/**
 * Plain-English error shown to the caregiver when video token minting fails.
 * Worded so a non-technical user knows the safe fallback (call 911) without
 * leaking server details. Do not change wording without product approval.
 */
export const VIDEO_TOKEN_ERROR_MESSAGE =
  "Video connection failed. Please call 911 if this is an emergency.";

export type CameraConsent = "granted" | "denied" | "unset";

/** Read the camera-consent value stored on a care-recipient's user doc. */
export async function getCameraConsent(receiverId: string): Promise<CameraConsent> {
  if (!isFirebaseConfigured || !db) return "unset";
  try {
    const snap = await getDoc(doc(db, "users", receiverId));
    if (!snap.exists()) return "unset";
    const v = snap.data().cameraConsent as boolean | undefined;
    if (v === true) return "granted";
    if (v === false) return "denied";
    return "unset";
  } catch {
    return "unset";
  }
}

/** Build a deterministic Twilio Video room name for an emergency session. */
export function buildVideoRoomName(receiverId: string): string {
  const stamp = Math.floor(Date.now() / 1000);
  return `tc-emrg-${receiverId.substring(0, 12)}-${stamp}`;
}

/**
 * Build a deterministic Twilio Video room name for a RECIPIENT-INITIATED call.
 * Keyed on the recipient uid so /api/video/token can enforce the same
 * room-name/uid binding as the emergency flow. Distinct prefix lets the
 * server tell the two flows apart in logs.
 */
export function buildCallRoomName(recipientId: string): string {
  const stamp = Math.floor(Date.now() / 1000);
  return `tc-call-${recipientId.substring(0, 12)}-${stamp}`;
}

/**
 * Recipient-initiated "Call My Caregiver" — tell the server to write the
 * cameraActivations doc that the caregiver's app is listening for.
 * NOT an emergency: no SMS, no missed-checkin push, no escalation.
 */
export async function initiateReceiverCall(input: {
  caregiverId: string;
  roomName: string;
  recipientName?: string;
  caregiverName?: string;
}): Promise<{ ok: boolean; signalDocId?: string; pushSent?: boolean; error?: string }> {
  if (!API_BASE) return { ok: false, error: "API server URL not configured" };

  let idToken: string;
  try {
    const currentUser = auth?.currentUser;
    if (!currentUser) return { ok: false, error: "Not signed in" };
    idToken = await currentUser.getIdToken();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "id-token refresh failed";
    return { ok: false, error: reason };
  }

  try {
    const res = await fetch(`${API_BASE}/api/video/receiver-initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { ok: false, error: "Not authorized" };
    if (!res.ok) {
      // Try to read the server's structured error envelope first so we can
      // distinguish "rules-not-deployed" (firestore_rules_denied) from
      // "caregiver-not-linked" without forcing the user to read HTTP codes.
      let serverError: string | undefined;
      let serverMessage: string | undefined;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        serverError = body.error;
        serverMessage = body.message;
      } catch {
        // Non-JSON body; fall through to generic message.
      }
      if (serverError === "firestore_rules_denied") {
        return {
          ok: false,
          error:
            serverMessage ??
            "Your caregiver link is not fully set up. Please contact support if this keeps happening.",
        };
      }
      if (res.status === 403) {
        return {
          ok: false,
          error: serverMessage ?? "Caregiver is not linked to your account",
        };
      }
      return { ok: false, error: serverMessage ?? `Server returned ${res.status}` };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      signalDocId?: string;
      pushSent?: boolean;
    };
    return { ok: !!data.ok, signalDocId: data.signalDocId, pushSent: data.pushSent };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start call";
    return { ok: false, error: message };
  }
}

/**
 * Tell the server to push a "camera_activate" notification to the
 * care-recipient's device. The receiver's app picks this up via the
 * notification listener and navigates to the camera-publish screen.
 *
 * SECURITY — sends the caller's Firebase ID token in the Authorization
 * header. The server verifies it, confirms the caller is a permitted
 * caregiver of `targetUserId`, and only then dispatches the push.
 */
export async function initiateCameraActivation(input: {
  /**
   * Best-effort push wakeup token. Optional — server now writes a Firestore
   * signal doc that the receiver subscribes to via onSnapshot, which is the
   * primary delivery mechanism. Push is just a wakeup for backgrounded apps.
   */
  receiverPushToken?: string;
  receiverName: string;
  caregiverName: string;
  roomName: string;
  /** uid of the care-recipient — used by the server for permission check. */
  targetUserId: string;
}): Promise<{ ok: boolean; videoConfigured?: boolean; pushSent?: boolean; error?: string }> {
  if (!API_BASE) return { ok: false, error: "API server URL not configured" };

  let idToken: string;
  try {
    const currentUser = auth?.currentUser;
    if (!currentUser) return { ok: false, error: "Not signed in" };
    idToken = await currentUser.getIdToken();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "id-token refresh failed";
    return { ok: false, error: reason };
  }

  try {
    const res = await fetch(`${API_BASE}/api/video/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { ok: false, error: "Not authorized" };
    if (!res.ok) {
      let serverError: string | undefined;
      let serverMessage: string | undefined;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        serverError = body.error;
        serverMessage = body.message;
      } catch {
        // Non-JSON body; fall through.
      }
      if (serverError === "firestore_rules_denied") {
        return {
          ok: false,
          error:
            serverMessage ??
            "Camera activation is not yet enabled on this account. Please contact support.",
        };
      }
      if (res.status === 403) {
        return {
          ok: false,
          error: serverMessage ?? "Not permitted to activate this camera",
        };
      }
      return { ok: false, error: serverMessage ?? `Server returned ${res.status}` };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      videoConfigured?: boolean;
      pushSent?: boolean;
    };
    return {
      ok: !!data.ok,
      videoConfigured: data.videoConfigured,
      pushSent: data.pushSent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start camera";
    return { ok: false, error: message };
  }
}

// TWILIO VIDEO — token minting client
// ─────────────────────────────────────────────────────────────────────────────
export interface VideoTokenSuccess {
  ok: true;
  token: string;
  roomName: string;
  identity: string;
  ttlSeconds: number;
}

export interface VideoTokenFailure {
  ok: false;
  /** Plain-English message safe to surface to the caregiver. */
  message: string;
  /** Machine-readable code for telemetry. */
  code:
    | "no_api_base"
    | "video_not_configured"
    | "bad_request"
    | "server_error"
    | "network_error"
    | "unauthorized"
    | "forbidden";
}

export type VideoTokenResult = VideoTokenSuccess | VideoTokenFailure;

/**
 * Mint a short-lived Twilio Video access token for the requesting client.
 * The same endpoint is used by both sides of an emergency video session:
 *   • caregiver — joins the room as a subscriber/viewer
 *   • care-recipient — joins the room as a publisher (front camera)
 *
 * SECURITY — every request includes the caller's Firebase ID token in the
 * Authorization header. The server verifies it cryptographically and uses
 * the verified uid as the Twilio identity (the local `identity` arg is
 * effectively ignored by the server — kept here only for the audit-log
 * details until Twilio Video SDK integration removes it entirely).
 *
 * On failure: writes an entry to the `auditLogs` collection (HIPAA trail) and
 * returns a structured error so the UI can show VIDEO_TOKEN_ERROR_MESSAGE.
 *
 * @param identity      stable per-user identifier — caregiver uid or receiver uid
 * @param roomName      deterministic emergency room name from buildVideoRoomName
 * @param targetUserId  uid of the OTHER party in the room (the care-recipient
 *                      whose room this is). Used by the server for
 *                      permittedCaregivers permission check.
 * @param auditUserId   the uid to attribute the audit-log entry to (optional)
 */
export async function requestVideoToken(input: {
  identity: string;
  roomName: string;
  targetUserId: string;
  auditUserId?: string;
  // RECIPIENT-INITIATED CALL ONLY — the cameraActivations docId written by
  // /api/video/receiver-initiate. Required for tc-call-* rooms so the server
  // can bind token minting to the specific caregiverId that was signaled
  // (not just "any permitted caregiver", which would let a permitted
  // caregiver B join recipient→caregiverA's private call uninvited).
  activationDocId?: string;
}): Promise<VideoTokenResult> {
  const { identity, roomName, targetUserId, auditUserId, activationDocId } = input;

  const audit = (details: string) => {
    if (!auditUserId) return;
    logAudit({
      userId: auditUserId,
      action: "video_token_error",
      details,
      targetUserId: identity !== auditUserId ? identity : undefined,
    });
  };

  if (!API_BASE) {
    audit(`Token request aborted — EXPO_PUBLIC_API_URL not configured (room=${roomName})`);
    return { ok: false, code: "no_api_base", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }

  // SECURITY — fetch a fresh Firebase ID token. `getIdToken()` returns the
  // cached token if it's still valid for >5 minutes, otherwise refreshes it
  // automatically. Without a signed-in user we cannot mint a video token at
  // all (server returns 401), so fail fast with the standard error UI.
  let idToken: string;
  try {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      audit(`Token request aborted — no signed-in Firebase user (room=${roomName})`);
      return { ok: false, code: "unauthorized", message: VIDEO_TOKEN_ERROR_MESSAGE };
    }
    idToken = await currentUser.getIdToken();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "id-token refresh failed";
    audit(`Token request aborted — could not obtain Firebase ID token: ${reason} (room=${roomName})`);
    return { ok: false, code: "unauthorized", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/video/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ roomName, targetUserId, activationDocId }),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "network failure";
    audit(`Token request network error: ${reason} (room=${roomName})`);
    return { ok: false, code: "network_error", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }

  if (res.status === 401) {
    audit(`Token mint refused — Firebase ID token rejected by server (room=${roomName})`);
    return { ok: false, code: "unauthorized", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }
  if (res.status === 403) {
    audit(`Token mint refused — caller not permitted for room ${roomName} (target=${targetUserId})`);
    return { ok: false, code: "forbidden", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }
  if (res.status === 503) {
    audit(`Token mint refused — Twilio Video not configured on server (room=${roomName})`);
    return { ok: false, code: "video_not_configured", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }
  if (res.status === 400) {
    audit(`Token mint rejected — bad request (identity=${identity}, room=${roomName})`);
    return { ok: false, code: "bad_request", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }
  if (!res.ok) {
    audit(`Token mint server error: HTTP ${res.status} (room=${roomName})`);
    return { ok: false, code: "server_error", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }

  try {
    const data = (await res.json()) as Partial<VideoTokenSuccess>;
    if (!data.token || !data.roomName || !data.identity || !data.ttlSeconds) {
      audit(`Token mint returned malformed response (room=${roomName})`);
      return { ok: false, code: "server_error", message: VIDEO_TOKEN_ERROR_MESSAGE };
    }
    // Success — write a HIPAA-grade audit row for the mint event so the
    // admin Audit Log tab can correlate it against the parallel `events`
    // doc that emergency-call.tsx wrote on the caregiver's tap.
    if (auditUserId) {
      logAudit({
        userId: auditUserId,
        action: "video_token_minted",
        details: `Twilio Video token minted (identity=${data.identity}, room=${roomName}, ttl=${data.ttlSeconds}s)`,
        targetUserId: data.identity !== auditUserId ? data.identity : undefined,
      });
    }
    return {
      ok: true,
      token: data.token,
      roomName: data.roomName,
      identity: data.identity,
      ttlSeconds: data.ttlSeconds,
    };
  } catch {
    audit(`Token mint response not JSON (room=${roomName})`);
    return { ok: false, code: "server_error", message: VIDEO_TOKEN_ERROR_MESSAGE };
  }
}

/** Fetch a care-recipient's Expo push token from Firestore. */
export async function getReceiverPushToken(receiverId: string): Promise<string | null> {
  if (!isFirebaseConfigured || !db) return null;
  try {
    const snap = await getDoc(doc(db, "users", receiverId));
    if (!snap.exists()) return null;
    const tok = snap.data().expoPushToken as string | undefined;
    return tok && tok.startsWith("ExponentPushToken") ? tok : null;
  } catch {
    return null;
  }
}
