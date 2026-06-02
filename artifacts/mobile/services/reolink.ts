// REOLINK — Home Camera service (mobile)
// ─────────────────────────────────────────────────────────────────────────────
// A care-recipient can connect a Reolink camera (reachable at its public Reolink
// DDNS address + forwarded port) as a secondary "Home Camera" feed. The plaintext
// password never lives in Firestore: the API server validates the camera, returns
// an encrypted blob (`enc`), and we persist only that blob + non-secret fields on
// the recipient's own user doc.
//
// Caregivers later view the feed through the server snapshot proxy — they never
// receive the camera credentials.
// ─────────────────────────────────────────────────────────────────────────────

import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "./firebase";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "")
  .replace(/\/$/, "")
  .replace(/\/api$/, "");

export interface ReolinkInput {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ReolinkStatus {
  host: string;
  port: number;
  username: string;
  connected: boolean;
  cloudEnabled: boolean;
  lastConnected: number | null;
  configured: boolean;
}

export type ReolinkTestResult =
  | { ok: true; enc: string }
  | { ok: false; error: string };

async function freshIdToken(): Promise<string | null> {
  try {
    const u = auth?.currentUser;
    if (!u) return null;
    return await u.getIdToken();
  } catch {
    return null;
  }
}

/** Map a server error code to a plain-English, non-technical message. */
function describeError(code: unknown): string {
  switch (code) {
    case "auth":
      return "The camera rejected that username or password. Double-check them in the Reolink app.";
    case "unreachable":
    case "blocked":
      return "Couldn't reach the camera at that address. Check the web address and port, and make sure the camera is online.";
    case "no_image":
      return "Connected to the camera, but it didn't return a picture. Make sure it's a supported Reolink model.";
    case "crypto_not_configured":
      return "The server isn't ready to store camera credentials yet. Please try again later.";
    default:
      return "Couldn't connect to the camera. Please check your details and try again.";
  }
}

/** Validate a camera connection during setup. Returns the encrypted blob to save. */
export async function testReolinkConnection(
  input: ReolinkInput,
): Promise<ReolinkTestResult> {
  if (!API_BASE) {
    return { ok: false, error: "The app isn't configured to reach the server." };
  }
  const idToken = await freshIdToken();
  if (!idToken) {
    return { ok: false, error: "You're not signed in. Please sign in and try again." };
  }
  try {
    const res = await fetch(`${API_BASE}/api/reolink/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      enc?: string;
      error?: string;
    };
    if (res.ok && data.ok && data.enc) {
      return { ok: true, enc: data.enc };
    }
    return { ok: false, error: describeError(data.error) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Connection failed. Please try again.",
    };
  }
}

/** Persist verified camera config on the recipient's own user doc. */
export async function saveReolinkConfig(
  userId: string,
  input: { host: string; port: number; username: string; enc: string },
): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false;
  try {
    await setDoc(
      doc(db, "users", userId),
      {
        reolink: {
          host: input.host,
          port: input.port,
          username: input.username,
          enc: input.enc,
          cloudEnabled: true,
          connected: true,
          lastConnected: serverTimestamp(),
        },
      },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

/** Read current Home Camera status for display (never exposes the password). */
export async function getReolinkStatus(
  userId: string,
): Promise<ReolinkStatus | null> {
  if (!isFirebaseConfigured || !db) return null;
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (!snap.exists()) return null;
    const r = snap.data().reolink as
      | {
          host?: string;
          port?: number;
          username?: string;
          connected?: boolean;
          cloudEnabled?: boolean;
          lastConnected?: { toMillis?: () => number };
        }
      | undefined;
    if (!r || !r.host) return null;
    return {
      host: r.host,
      port: r.port ?? 443,
      username: r.username ?? "admin",
      connected: Boolean(r.connected),
      cloudEnabled: Boolean(r.cloudEnabled),
      lastConnected: r.lastConnected?.toMillis?.() ?? null,
      configured: true,
    };
  } catch {
    return null;
  }
}

/** Remove the stored Home Camera config. */
export async function clearReolinkConfig(userId: string): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false;
  try {
    await setDoc(doc(db, "users", userId), { reolink: null }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build an <Image> source (uri + auth headers) for the snapshot proxy. Includes
 * a cache-busting timestamp so each poll fetches a fresh frame. Returns null if
 * the app can't authenticate.
 */
export async function getReolinkSnapshotSource(
  targetUserId: string,
): Promise<{ uri: string; headers: Record<string, string> } | null> {
  if (!API_BASE) return null;
  const idToken = await freshIdToken();
  if (!idToken) return null;
  return {
    uri: `${API_BASE}/api/reolink/snapshot?targetUserId=${encodeURIComponent(
      targetUserId,
    )}&t=${Date.now()}`,
    headers: { Authorization: `Bearer ${idToken}` },
  };
}
