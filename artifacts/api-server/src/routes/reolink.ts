// REOLINK — Home Camera proxy routes
// ─────────────────────────────────────────────────────────────────────────────
// Two endpoints, both Firebase-ID-token authed (same model as /api/video/*):
//
//   POST /api/reolink/test
//     Body: { host, port, username, password }
//     The recipient validates their camera during Home Camera setup. The server
//     attempts a real Login + Snap against the camera. On success it returns an
//     AES-GCM ciphertext blob (`enc`) the client persists to its own user doc —
//     so the plaintext password is never written to Firestore and never has to
//     come back to any client again.
//
//   GET /api/reolink/snapshot?targetUserId=<recipientUid>
//     Returns a single JPEG. Caller must be the recipient OR a permitted
//     caregiver (isPermittedForReceiver). The server reads the recipient's
//     stored config (forwarding the caller's own ID token, so Firestore rules
//     govern access), decrypts the credentials, pulls a frame, and streams the
//     image. The caregiver app polls this ~every 1.5s for a pseudo-live feed.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  fetchUserDocAsCaller,
  isPermittedForReceiver,
  verifyFirebaseIdToken,
} from "../middlewares/firebaseAuth";
import {
  decryptCreds,
  encryptCreds,
  isCryptoConfigured,
} from "../lib/reolinkCrypto";
import { fetchSnapshot, isAllowedCameraHost } from "../lib/reolinkClient";
import { createFixedWindowLimiter } from "../lib/rateLimit";

const router: IRouter = Router();

// Per-recipient snapshot rate limit. A legit caregiver feed polls ~1 frame /
// 1.5s (~40/min) per viewer; we cap each recipient well above a single viewer
// (room for a couple of concurrent caregivers + retries) but low enough that a
// runaway client loop can't keep logging into the camera and pulling frames.
// Over the limit → 429; the client backs off and self-heals next window.
const SNAPSHOT_WINDOW_MS = 60_000;
const SNAPSHOT_MAX_PER_WINDOW = 100;
const snapshotLimiter = createFixedWindowLimiter({
  windowMs: SNAPSHOT_WINDOW_MS,
  max: SNAPSHOT_MAX_PER_WINDOW,
});

/** Strip scheme/whitespace/trailing slash from a user-entered host. */
function sanitizeHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const h = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!h || /\s/.test(h) || h.includes("/")) return null;
  return h;
}

function sanitizePort(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 443;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/** Decode the `reolink` map from a Firestore REST user document. */
function extractReolink(
  doc: Record<string, unknown> | null,
): { host: string; port: number; enc: string } | null {
  const m = (
    doc as {
      fields?: {
        reolink?: {
          mapValue?: {
            fields?: {
              host?: { stringValue?: string };
              port?: { integerValue?: string; stringValue?: string };
              enc?: { stringValue?: string };
            };
          };
        };
      };
    } | null
  )?.fields?.reolink?.mapValue?.fields;
  if (!m) return null;
  const host = m.host?.stringValue;
  const enc = m.enc?.stringValue;
  if (!host || !enc) return null;
  const portRaw = m.port?.integerValue ?? m.port?.stringValue;
  const port = portRaw ? parseInt(String(portRaw), 10) : 443;
  return {
    host,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 443,
    enc,
  };
}

/**
 * POST /api/reolink/test — validate a camera connection during setup.
 */
router.post(
  "/reolink/test",
  verifyFirebaseIdToken,
  async (req: Request, res: Response) => {
    if (!isCryptoConfigured()) {
      logger.error("Reolink test rejected — SESSION_SECRET not configured");
      return res.status(500).json({ ok: false, error: "crypto_not_configured" });
    }

    const body = req.body as {
      host?: unknown;
      port?: unknown;
      username?: unknown;
      password?: unknown;
    };
    const host = sanitizeHost(body.host);
    const port = sanitizePort(body.port);
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!host || port === null || !username || !password) {
      return res.status(400).json({ ok: false, error: "invalid_input" });
    }
    if (!(await isAllowedCameraHost(host))) {
      return res.status(400).json({ ok: false, error: "unreachable" });
    }

    const result = await fetchSnapshot(host, port, { username, password });
    if (!result.ok) {
      const status = result.error === "auth" ? 401 : 502;
      return res.status(status).json({ ok: false, error: result.error });
    }

    const enc = encryptCreds({ username, password });
    logger.info(
      { callerUid: req.firebaseAuth!.uid, port },
      "Reolink test connection succeeded",
    );
    return res.json({ ok: true, enc });
  },
);

/**
 * GET /api/reolink/snapshot?targetUserId=<recipientUid> — pull one JPEG frame.
 */
router.get(
  "/reolink/snapshot",
  verifyFirebaseIdToken,
  async (req: Request, res: Response) => {
    if (!isCryptoConfigured()) {
      return res.status(500).json({ error: "crypto_not_configured" });
    }
    const auth = req.firebaseAuth!;
    const targetUserId = String(req.query.targetUserId ?? "");
    if (!targetUserId) {
      return res.status(400).json({ error: "targetUserId required" });
    }

    const permitted = await isPermittedForReceiver(auth, targetUserId);
    if (!permitted) {
      logger.warn(
        { callerUid: auth.uid, targetUserId, route: "/reolink/snapshot" },
        "Reolink snapshot rejected — caller not permitted for receiver",
      );
      return res.status(403).json({ error: "forbidden" });
    }

    // Rate-limit per recipient (only permitted callers count, so an unrelated
    // caller can't grief a recipient's window). Stops a runaway client loop
    // from repeatedly logging into the camera and pulling frames.
    const limit = snapshotLimiter(`snapshot:${targetUserId}`);
    if (!limit.allowed) {
      logger.warn(
        {
          callerUid: auth.uid,
          targetUserId,
          retryAfterSec: limit.retryAfterSec,
          route: "/reolink/snapshot",
        },
        "Reolink snapshot rate-limited (per-recipient cap exceeded)",
      );
      res.setHeader("Retry-After", String(limit.retryAfterSec));
      return res
        .status(429)
        .json({ error: "rate_limited", retryAfterSec: limit.retryAfterSec });
    }

    const doc = await fetchUserDocAsCaller(auth.idToken, targetUserId);
    const cfg = extractReolink(doc);
    if (!cfg) {
      return res.status(404).json({ error: "not_configured" });
    }

    let creds;
    try {
      creds = decryptCreds(cfg.enc);
    } catch {
      logger.error(
        { targetUserId },
        "Reolink snapshot — failed to decrypt stored credentials",
      );
      return res.status(500).json({ error: "decrypt_failed" });
    }

    const result = await fetchSnapshot(cfg.host, cfg.port, creds);
    if (!result.ok) {
      return res.status(502).json({ error: "camera_offline", reason: result.error });
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.end(result.jpeg);
  },
);

export default router;
