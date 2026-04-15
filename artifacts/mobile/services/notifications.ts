import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { doc, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "./firebase";

export type ScheduleType = "4h" | "8h" | "12h" | "24h" | "custom";

export interface CheckInSchedule {
  type: ScheduleType;
  customHour: number;
  customMinute: number;
}

export interface NotificationSettings {
  enabled: boolean;
  schedule: CheckInSchedule;
  missedWindowMin: number;
  escalationWindowMin: number;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  schedule: { type: "8h", customHour: 9, customMinute: 0 },
  missedWindowMin: 15,
  escalationWindowMin: 30,
};

// Configure foreground notification behaviour
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ── Push token registration ───────────────────────────────────────────────────
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (Platform.OS === "web") return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") return null;

    // Get Expo push token (requires EAS project ID for remote delivery;
    // token registration gracefully skips if not configured)
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    if (isFirebaseConfigured && db && token) {
      await updateDoc(doc(db, "users", userId), { expoPushToken: token });
    }

    return token ?? null;
  } catch {
    // getExpoPushTokenAsync fails in Expo Go without EAS project config —
    // permissions are still registered, local notifications still work
    return null;
  }
}

// ── Local reminder scheduling ─────────────────────────────────────────────────
export async function scheduleCheckInReminders(settings: NotificationSettings): Promise<void> {
  if (Platform.OS === "web") return;

  // Always cancel existing first
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!settings.enabled) return;

  const content: Notifications.NotificationContentInput = {
    title: "Time to Check In",
    body: "Tap the I'M OK button to let your caregiver know you're safe.",
    sound: true,
  };

  const { schedule } = settings;

  if (schedule.type === "custom") {
    // Daily at a specific time
    await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: schedule.customHour,
        minute: schedule.customMinute,
      },
    });
  } else {
    const hours = schedule.type === "4h" ? 4 : schedule.type === "8h" ? 8 : schedule.type === "12h" ? 12 : 24;
    await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: hours * 3600,
        repeats: true,
      },
    });
  }
}

export async function cancelAllReminders(): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// ── Send push notification via Expo Push API ──────────────────────────────────
// Works from device when caregiver tokens are known.
// For full background delivery, use the API server scheduler.
export async function sendExpoPushNotification(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  const validTokens = tokens.filter((t) => t && t.startsWith("ExponentPushToken"));
  if (validTokens.length === 0) return;

  const messages = validTokens.map((to) => ({ to, title, body, data: data ?? {}, sound: "default" }));

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch {
    // Network errors are silently swallowed — local status update already happened
  }
}

interface CaregiverContactInfo {
  pushToken: string | null;
  phone: string | null;
}

// ── Fetch caregiver push tokens and phone numbers ────────────────────────────
export async function getCaregiverContacts(
  permittedCaregivers: Array<{ id: string }>
): Promise<CaregiverContactInfo[]> {
  if (!isFirebaseConfigured || !db || permittedCaregivers.length === 0) return [];

  try {
    const { getDoc } = await import("firebase/firestore");
    const contacts: CaregiverContactInfo[] = [];
    for (const cg of permittedCaregivers) {
      const snap = await getDoc(doc(db, "users", cg.id));
      if (snap.exists()) {
        const data = snap.data();
        contacts.push({
          pushToken: (data?.expoPushToken as string | undefined) ?? null,
          phone: (data?.phone as string | undefined) ?? null,
        });
      }
    }
    return contacts;
  } catch {
    return [];
  }
}

// ── Backwards-compat: push tokens only ───────────────────────────────────────
export async function getCaregiverPushTokens(
  permittedCaregivers: Array<{ id: string }>
): Promise<string[]> {
  const contacts = await getCaregiverContacts(permittedCaregivers);
  return contacts.map((c) => c.pushToken).filter(Boolean) as string[];
}

export async function getCaregiverPhones(
  permittedCaregivers: Array<{ id: string }>
): Promise<string[]> {
  const contacts = await getCaregiverContacts(permittedCaregivers);
  return contacts.map((c) => c.phone).filter(Boolean) as string[];
}

// ── API server caller ─────────────────────────────────────────────────────────
const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export async function callNotifyApi(
  path: string,
  body: Record<string, unknown>
): Promise<boolean> {
  if (!API_BASE) return false;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Trigger SMS alert via the API server ─────────────────────────────────────
export async function triggerSmsAlert(
  phones: string[],
  receiverName: string,
  status: "missed" | "emergency" | "manual_emergency",
  minutesSinceDue: number
): Promise<void> {
  await callNotifyApi("/notify/sms", { phones, receiverName, status, minutesSinceDue });
}
