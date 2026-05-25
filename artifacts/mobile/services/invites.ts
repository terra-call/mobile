import { doc, getDoc, setDoc, updateDoc, arrayUnion, runTransaction } from "firebase/firestore";
import { db, isFirebaseConfigured } from "./firebase";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface InviteDoc {
  code: string;
  caregiverId: string;
  caregiverName: string;
  caregiverEmail: string;
  createdAt: string;
  expiresAt: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
}

export interface PermittedCaregiver {
  id: string;
  name: string;
  email: string;
}

// 6-digit numeric code, no leading zeros stripped
function generateCode(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

// ── Caregiver: create a fresh invite code ────────────────────────────────────
export async function createInvite(caregiver: {
  id: string;
  name: string;
  email: string;
}): Promise<{ code: string; expiresAt: string }> {
  if (!isFirebaseConfigured || !db) {
    throw new Error("Firebase not configured");
  }

  // Try up to 5 times in the very unlikely case of a collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const ref = doc(db, "invites", code);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const data = existing.data() as InviteDoc;
      // If existing code is expired or already redeemed, we can overwrite
      const isExpired = new Date(data.expiresAt).getTime() < Date.now();
      if (!isExpired && !data.redeemedBy) continue;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const invite: InviteDoc = {
      code,
      caregiverId: caregiver.id,
      caregiverName: caregiver.name,
      caregiverEmail: caregiver.email,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      redeemedBy: null,
      redeemedAt: null,
    };
    try {
      await setDoc(ref, invite);
      return { code, expiresAt: invite.expiresAt };
    } catch (err) {
      const errCode = (err as { code?: string })?.code ?? "";
      const errMsg = (err as Error)?.message ?? String(err);
      console.error("[createInvite] Firestore write failed", { code: errCode, message: errMsg });
      if (errCode === "permission-denied") {
        throw new Error("Firestore rules do not allow writing to /invites. Update your Firestore security rules — see replit.md.");
      }
      throw err;
    }
  }
  throw new Error("Could not generate a unique invite code");
}

// ── Care recipient: redeem an invite code ─────────────────────────────────────
export type RedeemResult =
  | { ok: true; caregiver: PermittedCaregiver }
  | { ok: false; reason: "not-found" | "expired" | "redeemed" | "self" | "duplicate" | "error" };

export async function redeemInvite(
  code: string,
  receiver: { id: string; permittedCaregivers: PermittedCaregiver[] }
): Promise<RedeemResult> {
  if (!isFirebaseConfigured || !db) {
    return { ok: false, reason: "error" };
  }

  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== 6) {
    return { ok: false, reason: "not-found" };
  }

  const inviteRef = doc(db, "invites", cleaned);
  const userRef = doc(db, "users", receiver.id);

  try {
    const newCaregiver = await runTransaction(db, async (tx) => {
      const snap = await tx.get(inviteRef);
      if (!snap.exists()) {
        throw new Error("not-found");
      }
      const data = snap.data() as InviteDoc;

      if (data.redeemedBy) throw new Error("redeemed");
      if (new Date(data.expiresAt).getTime() < Date.now()) throw new Error("expired");
      if (data.caregiverId === receiver.id) throw new Error("self");
      if (receiver.permittedCaregivers.some((c) => c.id === data.caregiverId)) {
        throw new Error("duplicate");
      }

      const cg: PermittedCaregiver = {
        id: data.caregiverId,
        name: data.caregiverName,
        email: data.caregiverEmail,
      };

      // Maintain a denormalized `permittedCaregiverIds: string[]` in parallel
      // with the rich `permittedCaregivers` objects array. The IDs array is
      // what Firestore Security Rules consult to authorize cameraActivations
      // writes (rules can use `in` against a list of strings, but cannot
      // iterate map values inside an array of objects).
      tx.update(userRef, {
        permittedCaregivers: arrayUnion(cg),
        permittedCaregiverIds: arrayUnion(cg.id),
      });
      tx.update(inviteRef, {
        redeemedBy: receiver.id,
        redeemedAt: new Date().toISOString(),
      });

      return cg;
    });

    return { ok: true, caregiver: newCaregiver };
  } catch (err) {
    const reason = (err as Error)?.message;
    if (reason === "not-found" || reason === "redeemed" || reason === "expired" || reason === "self" || reason === "duplicate") {
      return { ok: false, reason };
    }
    return { ok: false, reason: "error" };
  }
}

// ── Caregiver: text the code to a phone number via API server (Twilio) ───────
export type SmsResult =
  | { ok: true }
  | { ok: false; reason: "rate-limited" | "invalid" | "send-failed" | "network" };

export async function sendInviteSms(
  phone: string,
  code: string,
  caregiverName: string
): Promise<SmsResult> {
  if (!API_BASE) return { ok: false, reason: "network" };
  try {
    const res = await fetch(`${API_BASE}/api/invites/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code, caregiverName }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: false, reason: "rate-limited" };
    if (res.status === 400) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "send-failed" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
