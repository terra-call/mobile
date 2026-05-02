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
// 1. Auth the /api/video/token endpoint with Firebase
//    ID token verification before App Store submission
// 2. Install @twilio/video-react-native-sdk and test
//    real room connections via EAS dev build

import { doc, getDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "./firebase";
import { logAudit } from "./audit";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/**
 * Plain-English error shown to the caregiver when video token minting fails.
 * Worded so a non-technical user knows the safe fallback (call 911) without
 * leaking server details. Do not change wording without product approval.
 */
export const VIDEO_TOKEN_ERROR_MESSAGE =
  "Video connection failed. Please call 911 if this is an emergency.";

export type CameraConsent = "granted" | "denied" | "unset";

/** Read the camera-consent value stored on a care-receiver's user doc. */
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
 * Tell the server to push a "camera_activate" notification to the
 * care-receiver's device. The receiver's app picks this up via the
 * notification listener and navigates to the camera-publish screen.
 */
export async function initiateCameraActivation(input: {
  receiverPushToken: string;
  receiverName: string;
  caregiverName: string;
  roomName: string;
}): Promise<{ ok: boolean; videoConfigured?: boolean; error?: string }> {
  if (!API_BASE) return { ok: false, error: "API server URL not configured" };
  try {
    const res = await fetch(`${API_BASE}/api/video/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      return { ok: false, error: `Server returned ${res.status}` };
    }
    const data = (await res.json()) as { ok?: boolean; videoConfigured?: boolean };
    return { ok: !!data.ok, videoConfigured: data.videoConfigured };
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
    | "network_error";
}

export type VideoTokenResult = VideoTokenSuccess | VideoTokenFailure;

/**
 * Mint a short-lived Twilio Video access token for the requesting client.
 * The same endpoint is used by both sides of an emergency video session:
 *   • caregiver — joins the room as a subscriber/viewer
 *   • care-receiver — joins the room as a publisher (front camera)
 *
 * On failure: writes an entry to the `auditLogs` collection (HIPAA trail) and
 * returns a structured error so the UI can show VIDEO_TOKEN_ERROR_MESSAGE.
 *
 * @param identity   stable per-user identifier — caregiver uid or receiver uid
 * @param roomName   deterministic emergency room name from buildVideoRoomName
 * @param auditUserId  the uid to attribute the audit-log entry to (optional)
 */
export async function requestVideoToken(input: {
  identity: string;
  roomName: string;
  auditUserId?: string;
}): Promise<VideoTokenResult> {
  const { identity, roomName, auditUserId } = input;

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

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/video/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity, roomName }),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "network failure";
    audit(`Token request network error: ${reason} (room=${roomName})`);
    return { ok: false, code: "network_error", message: VIDEO_TOKEN_ERROR_MESSAGE };
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

/** Fetch a care-receiver's Expo push token from Firestore. */
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
