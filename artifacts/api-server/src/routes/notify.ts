import { Router } from "express";
import { registerSchedule, recordCheckIn, getSchedule } from "../lib/notificationScheduler";

const router = Router();

// Direct push: send arbitrary notification to tokens
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
  } catch (err) {
    res.status(500).json({ error: "Failed to reach Expo Push API" });
  }
});

// Register or update a care receiver's check-in schedule
router.post("/notify/schedule", (req, res) => {
  const body = req.body as {
    userId: string;
    receiverName: string;
    receiverToken?: string;
    caregiverTokens?: string[];
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
    scheduleType: body.scheduleType,
    customHour: body.customHour ?? 9,
    customMinute: body.customMinute ?? 0,
    missedWindowMin: body.missedWindowMin ?? 15,
    escalationWindowMin: body.escalationWindowMin ?? 30,
    lastCheckedInAt: body.lastCheckedInAt ?? null,
  });

  res.json({ ok: true });
});

// Record a check-in event (resets the missed/escalation counters)
router.post("/notify/checkin", (req, res) => {
  const { userId, checkedInAt } = req.body as { userId: string; checkedInAt: string };
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  recordCheckIn(userId, checkedInAt ?? new Date().toISOString());
  res.json({ ok: true });
});

// Debug: view current schedule for a user
router.get("/notify/schedule/:userId", (req, res) => {
  const schedule = getSchedule(req.params.userId ?? "");
  if (!schedule) {
    res.status(404).json({ error: "No schedule found" });
    return;
  }
  res.json(schedule);
});

export default router;
