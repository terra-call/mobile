// REOLINK — credential encryption
// ─────────────────────────────────────────────────────────────────────────────
// Care-recipients enter their Reolink camera username + password during Home
// Camera setup. The PASSWORD must never be stored in plaintext (HIPAA-adjacent
// app) and must never be sent back to any client after initial setup.
//
// We store an AES-256-GCM ciphertext blob (`reolink.enc`) on the recipient's
// user doc. The symmetric key is DERIVED from the existing `SESSION_SECRET`
// server secret via HKDF — so we don't have to provision a brand-new secret,
// and the key never leaves the server. The ciphertext is safe to live on a
// (signed-in-readable) Firestore doc because it's useless without the key.
//
// Only the server (the Reolink snapshot proxy) ever decrypts it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

const HKDF_SALT = Buffer.from("terra-call-reolink-salt-v1", "utf8");
const HKDF_INFO = Buffer.from("reolink-credential-encryption", "utf8");
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;

export interface ReolinkCreds {
  username: string;
  password: string;
}

export function isCryptoConfigured(): boolean {
  return SESSION_SECRET.length > 0;
}

function deriveKey(): Buffer {
  if (!SESSION_SECRET) {
    throw new Error("SESSION_SECRET not set — cannot derive Reolink credential key");
  }
  const derived = hkdfSync(
    "sha256",
    Buffer.from(SESSION_SECRET, "utf8"),
    HKDF_SALT,
    HKDF_INFO,
    32,
  );
  return Buffer.from(derived);
}

/** Encrypt camera credentials → base64(iv | tag | ciphertext). */
export function encryptCreds(creds: ReolinkCreds): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(creds), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a base64(iv | tag | ciphertext) blob → credentials. Throws on tamper. */
export function decryptCreds(blob: string): ReolinkCreds {
  const key = deriveKey();
  const raw = Buffer.from(blob, "base64");
  if (raw.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Reolink credential blob too short");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as ReolinkCreds;
  if (typeof parsed.username !== "string" || typeof parsed.password !== "string") {
    throw new Error("Decrypted Reolink creds malformed");
  }
  return parsed;
}
