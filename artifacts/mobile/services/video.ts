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

import { doc, getDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "./firebase";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

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
