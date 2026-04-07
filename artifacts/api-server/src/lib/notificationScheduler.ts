import { logger } from "./logger";

interface ScheduleEntry {
  userId: string;
  receiverName: string;
  receiverToken: string | null;
  caregiverTokens: string[];
  scheduleType: "4h" | "8h" | "12h" | "24h" | "custom";
  customHour: number;
  customMinute: number;
  missedWindowMin: number;
  escalationWindowMin: number;
  lastCheckedInAt: string | null;
  nextDueAt: string;
  missedNotifiedAt: string | null;
  escalationNotifiedAt: string | null;
  updatedAt: string;
}

const schedules = new Map<string, ScheduleEntry>();

function computeNextDue(
  type: ScheduleEntry["scheduleType"],
  customHour: number,
  customMinute: number,
  fromNow = false
): string {
  const now = new Date();
  if (type === "custom") {
    const next = new Date();
    next.setHours(customHour, customMinute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const hours = type === "4h" ? 4 : type === "8h" ? 8 : type === "12h" ? 12 : 24;
  const next = new Date(Date.now() + hours * 3600 * 1000);
  return next.toISOString();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function registerSchedule(entry: Omit<ScheduleEntry, "nextDueAt" | "missedNotifiedAt" | "escalationNotifiedAt" | "updatedAt">): void {
  const existing = schedules.get(entry.userId);
  const nextDueAt = existing?.nextDueAt ?? computeNextDue(entry.scheduleType, entry.customHour, entry.customMinute);

  schedules.set(entry.userId, {
    ...entry,
    nextDueAt,
    missedNotifiedAt: existing?.missedNotifiedAt ?? null,
    escalationNotifiedAt: existing?.escalationNotifiedAt ?? null,
    updatedAt: new Date().toISOString(),
  });
}

export function recordCheckIn(userId: string, checkedInAt: string): void {
  const entry = schedules.get(userId);
  if (!entry) return;

  const nextDueAt = computeNextDue(entry.scheduleType, entry.customHour, entry.customMinute);
  schedules.set(userId, {
    ...entry,
    lastCheckedInAt: checkedInAt,
    nextDueAt,
    missedNotifiedAt: null,
    escalationNotifiedAt: null,
    updatedAt: new Date().toISOString(),
  });
}

export function getSchedule(userId: string): ScheduleEntry | undefined {
  return schedules.get(userId);
}

// ── Expo Push API sender ──────────────────────────────────────────────────────

async function sendPush(tokens: string[], title: string, body: string, data?: Record<string, string>): Promise<void> {
  const valid = tokens.filter((t) => t?.startsWith("ExponentPushToken"));
  if (valid.length === 0) return;

  const messages = valid.map((to) => ({ to, title, body, data: data ?? {}, sound: "default" }));
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Expo Push API returned non-OK");
    }
  } catch (err) {
    logger.error({ err }, "Failed to reach Expo Push API");
  }
}

// ── Scheduler tick ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const now = Date.now();

  for (const [userId, entry] of schedules) {
    const dueAt = new Date(entry.nextDueAt).getTime();
    if (now < dueAt) continue;

    const minSinceDue = (now - dueAt) / 60000;

    // Last check-in was before the due time → they haven't checked in yet
    const lastCheckInTs = entry.lastCheckedInAt ? new Date(entry.lastCheckedInAt).getTime() : 0;
    const checkedInOnTime = lastCheckInTs >= dueAt;
    if (checkedInOnTime) continue;

    const allTokens = [
      ...(entry.receiverToken ? [entry.receiverToken] : []),
      ...entry.caregiverTokens,
    ];

    // ── Escalation ──────────────────────────────────────────────────────────
    if (minSinceDue >= entry.escalationWindowMin && !entry.escalationNotifiedAt) {
      logger.info({ userId, receiverName: entry.receiverName }, "Escalation: sending emergency alerts");
      await sendPush(
        entry.caregiverTokens,
        `🚨 EMERGENCY — ${entry.receiverName}`,
        `${entry.receiverName} has not checked in for ${Math.round(minSinceDue)} minutes. Immediate attention required.`,
        { type: "emergency", userId }
      );
      if (entry.receiverToken) {
        await sendPush(
          [entry.receiverToken],
          "URGENT: Check In Now",
          "Your caregiver has been alerted. Please check in immediately.",
          { type: "emergency_reminder" }
        );
      }
      schedules.set(userId, { ...entry, escalationNotifiedAt: new Date().toISOString() });

    // ── Missed ──────────────────────────────────────────────────────────────
    } else if (minSinceDue >= entry.missedWindowMin && !entry.missedNotifiedAt) {
      logger.info({ userId, receiverName: entry.receiverName }, "Missed: sending missed check-in alert");
      await sendPush(
        entry.caregiverTokens,
        `⚠️ Missed Check-In — ${entry.receiverName}`,
        `${entry.receiverName} missed their scheduled check-in. Please verify they are safe.`,
        { type: "missed", userId }
      );
      if (entry.receiverToken) {
        await sendPush(
          [entry.receiverToken],
          "Missed Check-In Reminder",
          "You missed your scheduled check-in. Please check in now.",
          { type: "missed_reminder" }
        );
      }
      schedules.set(userId, { ...entry, missedNotifiedAt: new Date().toISOString() });
    }
  }
}

// ── Start the scheduler ───────────────────────────────────────────────────────

export function startNotificationScheduler(): void {
  logger.info("Notification scheduler started (60s interval)");
  setInterval(() => {
    tick().catch((err) => logger.error({ err }, "Scheduler tick error"));
  }, 60_000);
}
