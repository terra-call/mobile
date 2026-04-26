import { logger } from "./logger";
import { sendSmsToMany, isSmsConfigured } from "./smsService";

interface ScheduleEntry {
  userId: string;
  receiverName: string;
  receiverToken: string | null;
  caregiverTokens: string[];
  caregiverPhones: string[];
  scheduleType: "4h" | "8h" | "12h" | "24h" | "custom";
  customHour: number;
  customMinute: number;
  missedWindowMin: number;
  escalationWindowMin: number;
  lastCheckedInAt: string | null;
  nextDueAt: string;
  missedNotifiedAt: string | null;
  escalationNotifiedAt: string | null;
  smsMissedSentAt: string | null;
  smsEscalationSentAt: string | null;
  updatedAt: string;
}

const schedules = new Map<string, ScheduleEntry>();

function computeNextDue(
  type: ScheduleEntry["scheduleType"],
  customHour: number,
  customMinute: number
): string {
  const now = new Date();
  if (type === "custom") {
    const next = new Date();
    next.setHours(customHour, customMinute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const hours = type === "4h" ? 4 : type === "8h" ? 8 : type === "12h" ? 12 : 24;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function registerSchedule(
  entry: Omit<ScheduleEntry, "nextDueAt" | "missedNotifiedAt" | "escalationNotifiedAt" | "smsMissedSentAt" | "smsEscalationSentAt" | "updatedAt">
): void {
  const existing = schedules.get(entry.userId);
  const nextDueAt =
    existing?.nextDueAt ??
    computeNextDue(entry.scheduleType, entry.customHour, entry.customMinute);

  schedules.set(entry.userId, {
    ...entry,
    nextDueAt,
    missedNotifiedAt: existing?.missedNotifiedAt ?? null,
    escalationNotifiedAt: existing?.escalationNotifiedAt ?? null,
    smsMissedSentAt: existing?.smsMissedSentAt ?? null,
    smsEscalationSentAt: existing?.smsEscalationSentAt ?? null,
    updatedAt: new Date().toISOString(),
  });

  logger.info(
    { userId: entry.userId, receiverName: entry.receiverName, phones: entry.caregiverPhones.length },
    "Schedule registered"
  );
}

// Mark an active manual emergency for this user. Suppresses any pending
// missed/escalation alerts so the scheduler doesn't fire a "Missed Check-In"
// notification on top of the manual emergency the receiver just triggered.
export function markEmergency(userId: string): void {
  const entry = schedules.get(userId);
  if (!entry) return;
  const now = new Date().toISOString();
  schedules.set(userId, {
    ...entry,
    missedNotifiedAt: now,
    escalationNotifiedAt: now,
    smsMissedSentAt: now,
    smsEscalationSentAt: now,
    updatedAt: now,
  });
}

export function recordCheckIn(userId: string, checkedInAt: string): void {
  const entry = schedules.get(userId);
  if (!entry) return;

  schedules.set(userId, {
    ...entry,
    lastCheckedInAt: checkedInAt,
    nextDueAt: computeNextDue(entry.scheduleType, entry.customHour, entry.customMinute),
    missedNotifiedAt: null,
    escalationNotifiedAt: null,
    smsMissedSentAt: null,
    smsEscalationSentAt: null,
    updatedAt: new Date().toISOString(),
  });
}

export function getSchedule(userId: string): ScheduleEntry | undefined {
  return schedules.get(userId);
}

// ── Send an immediate emergency alert (push + SMS) atomically ─────────────────

export async function sendEmergencyAlert(
  userId: string,
  receiverName: string,
  caregiverTokens: string[],
  caregiverPhones: string[]
): Promise<{ pushSent: number; smsSent: number }> {
  const title = `🚨 EMERGENCY — ${receiverName}`;
  const body = `${receiverName} has indicated they need help immediately. This is a manual emergency alert — please respond now.`;

  // Suppress any pending scheduler-driven missed/escalation alerts for this user
  markEmergency(userId);

  const validTokens = caregiverTokens.filter((t) => t?.startsWith("ExponentPushToken"));
  logger.info(
    {
      userId,
      receiverName,
      tokensReceived: caregiverTokens.length,
      tokensValid: validTokens.length,
      phonesReceived: caregiverPhones.length,
    },
    "Manual emergency alert"
  );

  await sendPush(caregiverTokens, title, body, { type: "manual_emergency", userId });

  if (isSmsConfigured() && caregiverPhones.length > 0) {
    await sendDirectSms(caregiverPhones, receiverName, "manual_emergency", 0);
  }

  return {
    pushSent: validTokens.length,
    smsSent: caregiverPhones.length,
  };
}

// ── Send an immediate SMS alert (called from direct API route) ────────────────

export async function sendDirectSms(
  phones: string[],
  receiverName: string,
  status: "missed" | "emergency" | "manual_emergency",
  minutesSinceDue: number
): Promise<void> {
  if (!isSmsConfigured() || phones.length === 0) return;

  const body =
    status === "manual_emergency"
      ? `🚨 URGENT – Terra Call: ${receiverName} has indicated they need help immediately. This was triggered manually — not a missed check-in. Please respond now.`
      : status === "missed"
        ? `Terra Call Alert: ${receiverName} has missed their scheduled check-in (${Math.round(minutesSinceDue)} min ago). Please check on them.`
        : `URGENT – Terra Call: ${receiverName} has not checked in for ${Math.round(minutesSinceDue)} minutes. Immediate attention required.`;

  await sendSmsToMany(phones, body);
}

// ── Expo Push API sender ──────────────────────────────────────────────────────

export async function sendPush(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ validTokens: number; delivered: boolean }> {
  const valid = tokens.filter((t) => t?.startsWith("ExponentPushToken"));
  if (valid.length === 0) return { validTokens: 0, delivered: false };

  const messages = valid.map((to) => ({ to, title, body, data: data ?? {}, sound: "default" }));
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Expo Push API returned non-OK");
      return { validTokens: valid.length, delivered: false };
    }
    return { validTokens: valid.length, delivered: true };
  } catch (err) {
    logger.error({ err }, "Failed to reach Expo Push API");
    return { validTokens: valid.length, delivered: false };
  }
}

// ── Scheduler tick ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const now = Date.now();

  for (const [userId, entry] of schedules) {
    const dueAt = new Date(entry.nextDueAt).getTime();
    if (now < dueAt) continue;

    const minSinceDue = (now - dueAt) / 60000;
    const lastCheckInTs = entry.lastCheckedInAt
      ? new Date(entry.lastCheckedInAt).getTime()
      : 0;

    if (lastCheckInTs >= dueAt) continue; // Checked in on time

    // ── Emergency escalation ─────────────────────────────────────────────────
    if (minSinceDue >= entry.escalationWindowMin && !entry.escalationNotifiedAt) {
      logger.info({ userId, receiverName: entry.receiverName }, "Escalation alerts firing");

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

      // ── SMS escalation (if not already sent for this window) ────────────────
      if (!entry.smsEscalationSentAt && entry.caregiverPhones.length > 0) {
        const body = `URGENT – Terra Call: ${entry.receiverName} has not checked in for ${Math.round(minSinceDue)} minutes. Immediate attention required. Current status: EMERGENCY.`;
        await sendSmsToMany(entry.caregiverPhones, body);
        schedules.set(userId, {
          ...entry,
          escalationNotifiedAt: new Date().toISOString(),
          smsEscalationSentAt: new Date().toISOString(),
        });
      } else {
        schedules.set(userId, { ...entry, escalationNotifiedAt: new Date().toISOString() });
      }

    // ── Missed check-in ──────────────────────────────────────────────────────
    } else if (minSinceDue >= entry.missedWindowMin && !entry.missedNotifiedAt) {
      logger.info({ userId, receiverName: entry.receiverName }, "Missed check-in alerts firing");

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

      // ── SMS missed (backup alert) ───────────────────────────────────────────
      if (!entry.smsMissedSentAt && entry.caregiverPhones.length > 0) {
        const body = `Terra Call Alert: ${entry.receiverName} has missed their scheduled check-in (${Math.round(minSinceDue)} min overdue). Please check on them. Status: MISSED.`;
        await sendSmsToMany(entry.caregiverPhones, body);
        schedules.set(userId, {
          ...entry,
          missedNotifiedAt: new Date().toISOString(),
          smsMissedSentAt: new Date().toISOString(),
        });
      } else {
        schedules.set(userId, { ...entry, missedNotifiedAt: new Date().toISOString() });
      }
    }
  }
}

// ── Start the scheduler ───────────────────────────────────────────────────────

export function startNotificationScheduler(): void {
  logger.info({ smsEnabled: isSmsConfigured() }, "Notification scheduler started (60s interval)");
  setInterval(() => {
    tick().catch((err) => logger.error({ err }, "Scheduler tick error"));
  }, 60_000);
}
