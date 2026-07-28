import { Router } from "express";
import {
  registerSchedule,
  recordCheckIn,
  getSchedule,
  removeSchedule,
  sendDirectSms,
  sendEmergencyAlert,
} from "../lib/notificationScheduler";
import { sendSmsToMany, isSmsConfigured, getTwilioClient, getTwilioFromNumber } from "../lib/smsService";

const router = Router();

// ── Direct push: send arbitrary notification to Expo push tokens ──────────────
router.post("/notify/send", async (req, res) => {
  const { tokens, title, body, data } = req.body as {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  };

  if (!Array.isArray(tokens) || !title || !body) {
    res.status(400).json({ error: "tokens (array), title, and body are required" });
    return;
  }

  const valid = tokens.filter((t) => t?.startsWith("ExponentPushToken"));
  if (valid.length === 0) {
    res.json({ sent: 0 });
    return;
  }

  const messages = valid.map((to) => ({ to, title, body, data: data ?? {}, sound: "default" }));

  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    const result = await resp.json();
    res.json({ sent: valid.length, result });
  } catch {
    res.status(500).json({ error: "Failed to reach Expo Push API" });
  }
});

// ── Direct SMS: send Twilio SMS to phone number list ─────────────────────────
router.post("/notify/sms", async (req, res) => {
  const { phones, receiverName, status, minutesSinceDue } = req.body as {
    phones: string[];
    receiverName: string;
    status: "missed" | "emergency" | "manual_emergency";
    minutesSinceDue?: number;
  };

  if (!Array.isArray(phones) || !receiverName || !status) {
    res.status(400).json({ error: "phones (array), receiverName, and status are required" });
    return;
  }

  if (!isSmsConfigured()) {
    res.status(503).json({ error: "SMS not configured (missing Twilio credentials)" });
    return;
  }

  const validPhones = phones.filter((p) => p && p.trim().length >= 7);
  if (validPhones.length === 0) {
    res.json({ sent: 0, message: "No valid phone numbers provided" });
    return;
  }

  await sendDirectSms(validPhones, receiverName, status, minutesSinceDue ?? 0);
  res.json({ sent: validPhones.length });
});

// ── Admin: system health (Twilio delivery rate over last 24h) ────────────────
// Note: this endpoint is currently unauthenticated and only exposes aggregate
// SMS delivery counters (no phone numbers, no message bodies). Adding proper
// Firebase ID-token verification is tracked as a follow-up.
function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "unknown";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

router.get("/admin/health", async (_req, res) => {
  const out: {
    twilio: { configured: boolean; sent: number; delivered: number; rate: number | null };
    recentErrors: string[];
  } = {
    twilio: { configured: isSmsConfigured(), sent: 0, delivered: 0, rate: null },
    recentErrors: [],
  };

  const client = getTwilioClient();
  const from = getTwilioFromNumber();
  if (client && from) {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const messages = await client.messages.list({ from, dateSentAfter: since, limit: 100 });
      out.twilio.sent = messages.length;
      out.twilio.delivered = messages.filter(
        (m) => m.status === "delivered" || m.status === "received"
      ).length;
      out.twilio.rate = messages.length > 0 ? out.twilio.delivered / messages.length : null;

      for (const m of messages) {
        if (m.status === "failed" || m.status === "undelivered") {
          // Mask phone numbers — only the last four digits are exposed.
          out.recentErrors.push(`SMS to ${maskPhone(m.to)}: ${m.errorMessage ?? m.status}`);
        }
      }
      out.recentErrors = out.recentErrors.slice(0, 5);
    } catch (err) {
      out.recentErrors.push(`Twilio API error: ${(err as Error).message}`);
    }
  }

  res.json(out);
});

// ── Manual emergency: push + SMS atomically, suppresses missed alerts ────────
router.post("/notify/emergency", async (req, res) => {
  const { userId, receiverName, caregiverTokens, caregiverPhones } = req.body as {
    userId: string;
    receiverName: string;
    caregiverTokens?: string[];
    caregiverPhones?: string[];
  };

  if (!userId || !receiverName) {
    res.status(400).json({ error: "userId and receiverName are required" });
    return;
  }

  const tokens = (caregiverTokens ?? []).filter(Boolean);
  const phones = (caregiverPhones ?? []).filter((p) => p && p.trim().length >= 7);

  const result = await sendEmergencyAlert(userId, receiverName, tokens, phones);
  res.json({ ok: true, ...result });
});

// ── Register or update a care recipient's check-in schedule ───────────────────
router.post("/notify/schedule", (req, res) => {
  const body = req.body as {
    userId: string;
    receiverName: string;
    receiverToken?: string;
    caregiverTokens?: string[];
    caregiverPhones?: string[];
    scheduleType: "4h" | "8h" | "12h" | "24h" | "custom";
    customHour?: number;
    customMinute?: number;
    missedWindowMin?: number;
    escalationWindowMin?: number;
    lastCheckedInAt?: string;
  };

  if (!body.userId || !body.receiverName || !body.scheduleType) {
    res.status(400).json({ error: "userId, receiverName, and scheduleType are required" });
    return;
  }

  registerSchedule({
    userId: body.userId,
    receiverName: body.receiverName,
    receiverToken: body.receiverToken ?? null,
    caregiverTokens: body.caregiverTokens ?? [],
    caregiverPhones: (body.caregiverPhones ?? []).filter(Boolean),
    scheduleType: body.scheduleType,
    customHour: body.customHour ?? 9,
    customMinute: body.customMinute ?? 0,
    missedWindowMin: body.missedWindowMin ?? 15,
    escalationWindowMin: body.escalationWindowMin ?? 30,
    lastCheckedInAt: body.lastCheckedInAt ?? null,
  });

  res.json({ ok: true });
});

// ── Remove a schedule (account deletion) ─────────────────────────────────────
router.post("/notify/schedule/remove", (req, res) => {
  const { userId } = req.body as { userId: string };
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const removed = removeSchedule(userId);
  res.json({ ok: true, removed });
});

// ── Record a check-in event (resets missed/escalation counters) ───────────────
router.post("/notify/checkin", (req, res) => {
  const { userId, checkedInAt } = req.body as { userId: string; checkedInAt: string };
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  recordCheckIn(userId, checkedInAt ?? new Date().toISOString());
  res.json({ ok: true });
});

// ── Debug: view current schedule state ───────────────────────────────────────
router.get("/notify/schedule/:userId", (req, res) => {
  const schedule = getSchedule(req.params.userId ?? "");
  if (!schedule) {
    res.status(404).json({ error: "No schedule found" });
    return;
  }
  res.json(schedule);
});

// ── Status check: is SMS configured? ────────────────────────────────────────
router.get("/notify/sms/status", (_req, res) => {
  res.json({ configured: isSmsConfigured() });
});

export default router;
