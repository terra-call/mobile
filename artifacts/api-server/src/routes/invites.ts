import { Router } from "express";
import { sendSms, isSmsConfigured } from "../lib/smsService";

const router = Router();

// ── Simple in-memory rate limiter: max 10 invite SMS per IP per hour ─────────
const RATE_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;
const ipHits = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

// ── Send a Terra Call invite code to a phone number via Twilio SMS ───────────
router.post("/invites/sms", async (req, res) => {
  const { phone, code, caregiverName } = req.body as {
    phone?: string;
    code?: string;
    caregiverName?: string;
  };

  if (!phone || !code) {
    res.status(400).json({ error: "phone and code are required" });
    return;
  }

  // Code must be exactly 6 digits
  const cleanCode = String(code).replace(/\D/g, "");
  if (cleanCode.length !== 6) {
    res.status(400).json({ error: "code must be 6 digits" });
    return;
  }

  // Basic phone validation: 7–16 chars, digits/spaces/+/-/parens only
  const trimmedPhone = String(phone).trim();
  if (trimmedPhone.length < 7 || trimmedPhone.length > 20 || !/^[\d\s+()-]+$/.test(trimmedPhone)) {
    res.status(400).json({ error: "invalid phone number" });
    return;
  }

  if (!isSmsConfigured()) {
    res.status(503).json({ error: "SMS not configured" });
    return;
  }

  // Rate limit by client IP
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many invites sent. Try again later." });
    return;
  }

  // Sanitize name — cap length, strip control chars
  const rawName = (caregiverName ?? "").toString().replace(/[\r\n\t]/g, " ").trim().slice(0, 50);
  const inviter = rawName.length > 0 ? rawName : "Your caregiver";

  const body = `${inviter} invited you to Terra Call. Open the app, tap "Add Caregiver", and enter code: ${cleanCode}\n\nThis code expires in 24 hours.`;

  const sent = await sendSms(trimmedPhone, body);
  if (!sent) {
    res.status(502).json({ error: "SMS send failed", sent: false });
    return;
  }
  res.json({ sent: true });
});

export default router;
