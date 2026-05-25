import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { doc, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "./firebase";

export interface PushRegistrationResult {
  token: string | null;
  error: string | null;
}

function getEasProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId
  );
}

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

// ── Permission helpers ────────────────────────────────────────────────────────
// "undetermined" = OS hasn't been asked yet (so we can show the pre-prompt and
// then trigger the system dialog). "denied" = user said no — we cannot re-ask
// programmatically; they must enable it from Settings.
export type NotifPermStatus = "granted" | "denied" | "undetermined";

export async function getNotificationPermissionStatus(): Promise<NotifPermStatus> {
  if (Platform.OS === "web") return "denied";
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    if (status === "undetermined") return "undetermined";
    return "denied";
  } catch {
    return "denied";
  }
}

// Triggers the OS permission dialog. Only call this AFTER the user has opted
// in via our friendly pre-prompt. Returns true if they granted access.
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

// ── Push token registration ───────────────────────────────────────────────────
// Passive: only fetches and stores a push token if permission is ALREADY
// granted. Does NOT trigger the OS dialog. The friendly pre-prompt handles that.
export async function registerForPushNotifications(userId: string): Promise<PushRegistrationResult> {
  if (Platform.OS === "web") {
    return { token: null, error: "Push notifications are not supported on web." };
  }

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      return { token: null, error: "Notification permission was not granted." };
    }

    const projectId = getEasProjectId();
    if (!projectId) {
      return { token: null, error: "Missing EAS projectId in app config." };
    }

    // Pass projectId explicitly — auto-detect is unreliable in standalone builds.
    // On Android standalone APKs this also requires FCM credentials uploaded to EAS
    // (otherwise this throws "Default FirebaseApp is not initialized").
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    if (!token) {
      return { token: null, error: "Expo push token came back empty." };
    }

    if (isFirebaseConfigured && db) {
      await updateDoc(doc(db, "users", userId), { expoPushToken: token });
    }

    return { token, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { token: null, error: message };
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
  await callNotifyApi("/api/notify/sms", { phones, receiverName, status, minutesSinceDue });
}
