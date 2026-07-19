import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { db, isFirebaseConfigured } from "@/services/firebase";
import {
  getCaregiverContacts,
  sendExpoPushNotification,
  triggerSmsAlert,
  callNotifyApi,
  NOTIFICATION_CHANNELS,
  TERRA_CALL_ALERT_SOUND,
} from "@/services/notifications";
import { logEvent } from "@/services/events";
import { logAudit } from "@/services/audit";
import { captureAndSaveLocation } from "@/services/location";
import { useAuth } from "./AuthContext";

export type ReceiverStatus = "checked-in" | "missed" | "emergency" | "unknown";

// A single entry in a care recipient's rolling alert history. Stored as a
// capped array on the recipient's user doc (NOT the admin-only `events`
// collection) so caregivers — who already subscribe to the user doc — can see
// each alert individually in real time without extra Firestore rules/indexes.
// `at` is an ISO-8601 UTC string (serverTimestamp() cannot live inside an
// array element, so we record the client time; clock skew is display-only).
export interface AlertEntry {
  // Stable unique id per alert (used as the React list key in the caregiver
  // feed). Optional for backward-compatibility with any entries written before
  // ids were added — the feed falls back to a composite key in that case.
  id?: string;
  type: "manual_emergency" | "emergency" | "missed";
  at: string;
}

export interface CareReceiver {
  id: string;
  name: string;
  email: string;
  phone?: string;
  status: ReceiverStatus;
  lastCheckIn: string | null;
  location?: { lat: number; lng: number };
  missedWindowMin: number;
  escalationWindowMin: number;
  // Newest-first list of recent alerts raised by this recipient.
  recentAlerts: AlertEntry[];
  // Server timestamp of the most recent emergency, as an ISO string. Drives the
  // "· X min ago" label on the status card while in EMERGENCY (so it reflects
  // the alert time, not the stale last check-in time).
  lastEmergencyAt: string | null;
  // Whether this recipient has connected a Reolink home camera. Gates the
  // auto-surfacing emergency camera feed — no point popping the feed modal for
  // a recipient who never configured one.
  hasHomeCamera: boolean;
  // Caregiver uids this recipient has linked (from the recipient's
  // `permittedCaregivers` array). Used to scope the auto-emergency camera so it
  // only surfaces for a caregiver's OWN recipients — the same linkage the
  // server enforces server-side (isPermittedForReceiver).
  permittedCaregiverIds: string[];
}

interface CareDataContextValue {
  careReceivers: CareReceiver[];
  lastCheckIn: string | null;
  checkInHistory: string[];
  checkIn: () => Promise<void>;
  triggerEmergency: () => Promise<void>;
  loading: boolean;
  refreshStatus: () => void;
}

const CareDataContext = createContext<CareDataContextValue | null>(null);

const CHECK_IN_KEY = "@terra:checkIn";
const RECEIVERS_KEY = "@terra:receivers";

const DEFAULT_MISSED_MIN = 30;
const DEFAULT_ESCALATION_MIN = 120;

const DEMO_RECEIVERS: CareReceiver[] = [
  {
    id: "demo1",
    name: "Margaret Johnson",
    email: "margaret@demo.com",
    phone: "+1 (555) 010-1001",
    status: "checked-in",
    lastCheckIn: new Date(Date.now() - 12 * 60000).toISOString(),
    location: { lat: 37.7749, lng: -122.4194 },
    missedWindowMin: DEFAULT_MISSED_MIN,
    escalationWindowMin: DEFAULT_ESCALATION_MIN,
    recentAlerts: [],
    lastEmergencyAt: null,
    hasHomeCamera: false,
    permittedCaregiverIds: [],
  },
  {
    id: "demo2",
    name: "Robert Williams",
    email: "robert@demo.com",
    phone: "+1 (555) 010-1002",
    status: "missed",
    lastCheckIn: new Date(Date.now() - 47 * 60000).toISOString(),
    location: { lat: 37.7761, lng: -122.4186 },
    missedWindowMin: DEFAULT_MISSED_MIN,
    escalationWindowMin: DEFAULT_ESCALATION_MIN,
    recentAlerts: [],
    lastEmergencyAt: null,
    hasHomeCamera: false,
    permittedCaregiverIds: [],
  },
  {
    id: "demo3",
    name: "Eleanor Davis",
    email: "eleanor@demo.com",
    phone: "+1 (555) 010-1003",
    status: "emergency",
    lastCheckIn: new Date(Date.now() - 130 * 60000).toISOString(),
    location: { lat: 37.7739, lng: -122.421 },
    missedWindowMin: DEFAULT_MISSED_MIN,
    escalationWindowMin: DEFAULT_ESCALATION_MIN,
    recentAlerts: [],
    lastEmergencyAt: null,
    hasHomeCamera: false,
    permittedCaregiverIds: [],
  },
];

// Compute WHEN the next check-in is due, given the last check-in time and the
// configured schedule. Mirrors the server's computeNextDue: interval schedules
// are lastCheckIn + N hours; "custom" is the next occurrence of the configured
// daily time after the last check-in.
export function computeDueTs(
  lastCheckInTs: number,
  scheduleType: string = "8h",
  customHour: number = 9,
  customMinute: number = 0
): number {
  if (scheduleType === "custom") {
    const due = new Date(lastCheckInTs);
    due.setHours(customHour, customMinute, 0, 0);
    if (due.getTime() <= lastCheckInTs) due.setDate(due.getDate() + 1);
    return due.getTime();
  }
  const hours =
    scheduleType === "4h" ? 4 : scheduleType === "8h" ? 8 : scheduleType === "12h" ? 12 : 24;
  return lastCheckInTs + hours * 3600 * 1000;
}

// Status is based on how OVERDUE the scheduled check-in is — NOT raw time since
// the last check-in. The missed/escalation windows are grace periods measured
// from the due time, matching the server scheduler's alert semantics. (A prior
// version compared time-since-last-check-in directly against missedWindowMin,
// which flagged "missed" 15 min after any check-in regardless of a 24h schedule.)
function computeStatus(
  lastCheckIn: any,
  missedWindowMin: number = DEFAULT_MISSED_MIN,
  escalationWindowMin: number = DEFAULT_ESCALATION_MIN,
  scheduleType: string = "8h",
  customHour: number = 9,
  customMinute: number = 0
): ReceiverStatus {
  if (!lastCheckIn) return "unknown";
  const ts =
    typeof lastCheckIn.toDate === "function"
      ? lastCheckIn.toDate().getTime()
      : new Date(lastCheckIn).getTime();
  const dueTs = computeDueTs(ts, scheduleType, customHour, customMinute);
  const overdueMin = (Date.now() - dueTs) / 60000;
  if (overdueMin < missedWindowMin) return "checked-in";
  if (overdueMin < escalationWindowMin) return "missed";
  return "emergency";
}

export function CareDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [careReceivers, setCareReceivers] = useState<CareReceiver[]>([]);
  const [lastCheckIn, setLastCheckIn] = useState<string | null>(null);
  const [checkInHistory, setCheckInHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const HISTORY_KEY = `@terra:checkInHistory`;

  // Track which notification states have been sent so we don't spam
  const notifiedRef = useRef<{ missed: boolean; emergency: boolean }>({ missed: false, emergency: false });
  const permittedCaregiversRef = useRef<Array<{ id: string; name: string }>>([]);

  // ── Firestore subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setCareReceivers([]);
      setLastCheckIn(null);
      notifiedRef.current = { missed: false, emergency: false };
      return;
    }

    if (isFirebaseConfigured && db) {
      if (user.role === "care-receiver") {
        const unsubscribe = onSnapshot(doc(db, "users", user.id), (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const ts = data.lastCheckIn;
            if (ts) {
              const date =
                typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
              setLastCheckIn(date.toISOString());
              // Reset notification flags when they check in
              notifiedRef.current = { missed: false, emergency: false };
            }
            // Keep permitted caregivers for notification purposes
            permittedCaregiversRef.current = (data.permittedCaregivers ?? []) as Array<{ id: string; name: string }>;
          }
        });
        return unsubscribe;
      } else {
        setLoading(true);
        const q = query(
          collection(db, "users"),
          where("role", "==", "care-receiver")
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
          const liveReceivers: CareReceiver[] = snapshot.docs.map((d) => {
            const data = d.data();
            const missed = data.missedWindowMin ?? DEFAULT_MISSED_MIN;
            const escalation = data.escalationWindowMin ?? DEFAULT_ESCALATION_MIN;
            // A manually-stored "emergency" status (set by I'M NOT OK button)
            // always wins over the time-based computation. Otherwise compute
            // from lastCheckIn so a stale status doesn't get stuck.
            const storedStatus = data.status as ReceiverStatus | undefined;
            const status: ReceiverStatus =
              storedStatus === "emergency"
                ? "emergency"
                : computeStatus(
                    data.lastCheckIn,
                    missed,
                    escalation,
                    (data.checkInScheduleType as string) ?? "8h",
                    (data.checkInCustomHour as number) ?? 9,
                    (data.checkInCustomMinute as number) ?? 0,
                  );
            const ts = data.lastCheckIn;
            let lastCheckInStr: string | null = null;
            if (ts) {
              lastCheckInStr =
                typeof ts.toDate === "function"
                  ? ts.toDate().toISOString()
                  : new Date(ts).toISOString();
            }
            // Parse the rolling alert history (newest-first) so the caregiver
            // dashboard can show each alert individually, in real time.
            const rawAlerts = Array.isArray(data.recentAlerts)
              ? data.recentAlerts
              : [];
            const recentAlerts: AlertEntry[] = rawAlerts
              .filter(
                (a: unknown): a is AlertEntry =>
                  !!a &&
                  typeof (a as AlertEntry).at === "string" &&
                  typeof (a as AlertEntry).type === "string",
              )
              .map((a: AlertEntry) => ({ id: a.id, type: a.type, at: a.at }));
            const le = data.lastEmergencyAt;
            let lastEmergencyAt: string | null = null;
            if (le) {
              lastEmergencyAt =
                typeof le.toDate === "function"
                  ? le.toDate().toISOString()
                  : new Date(le).toISOString();
            }
            return {
              id: d.id,
              name: data.name ?? "Unknown",
              email: data.email ?? "",
              phone: data.phone ?? undefined,
              status,
              lastCheckIn: lastCheckInStr,
              location: data.location
                ? { lat: data.location.lat, lng: data.location.lng }
                : undefined,
              missedWindowMin: missed,
              escalationWindowMin: escalation,
              recentAlerts,
              lastEmergencyAt,
              hasHomeCamera: !!(data.reolink && data.reolink.host),
              permittedCaregiverIds: Array.isArray(data.permittedCaregivers)
                ? (data.permittedCaregivers as Array<{ id?: string }>)
                    .map((c) => c?.id)
                    .filter((id): id is string => typeof id === "string")
                : [],
            };
          });
          setCareReceivers(liveReceivers);
          setLoading(false);
        });
        return unsubscribe;
      }
    } else {
      if (user.role === "care-receiver") {
        AsyncStorage.getItem(`${CHECK_IN_KEY}:${user.id}`).then((val) => {
          if (val) setLastCheckIn(val);
        });
        AsyncStorage.getItem(`${HISTORY_KEY}:${user.id}`).then((val) => {
          if (val) setCheckInHistory(JSON.parse(val));
        });
      } else {
        AsyncStorage.getItem(`${RECEIVERS_KEY}:${user.id}`).then((val) => {
          if (val) setCareReceivers(JSON.parse(val));
        });
      }
    }
  }, [user]);

  // ── Care recipient status monitor (alerts caregivers when windows are exceeded)
  useEffect(() => {
    if (!user || user.role !== "care-receiver" || !lastCheckIn) return;

    const check = async () => {
      if (!isFirebaseConfigured || !db) return;

      // Load notification settings from Firestore
      const snap = await getDoc(doc(db, "users", user.id)).catch(() => null);
      if (!snap?.exists()) return;

      const data = snap.data();
      const missed = (data.missedWindowMin ?? DEFAULT_MISSED_MIN) as number;
      const escalation = (data.escalationWindowMin ?? DEFAULT_ESCALATION_MIN) as number;
      const notifEnabled = data.notificationsEnabled ?? false;
      // SMS consent: caregivers only receive SMS backup alerts if the care
      // receiver has explicitly opted in (PHI flows through cellular carriers).
      const smsConsent = data.smsConsent ?? false;
      if (!notifEnabled) return;

      // Alert windows are measured from when the check-in was DUE (last
      // check-in + configured schedule), not from the last check-in itself —
      // otherwise a 24h schedule would false-alarm 15 min after every check-in.
      const ts = new Date(lastCheckIn).getTime();
      const dueTs = computeDueTs(
        ts,
        (data.checkInScheduleType as string) ?? "8h",
        (data.checkInCustomHour as number) ?? 9,
        (data.checkInCustomMinute as number) ?? 0,
      );
      const diffMin = (Date.now() - dueTs) / 60000;

      const caregivers = permittedCaregiversRef.current;
      const receiverName = user.name ?? "Your care recipient";

      // Fetch push tokens + phone numbers in one batch
      const contacts = await getCaregiverContacts(caregivers);
      const cgTokens = contacts.map((c) => c.pushToken).filter(Boolean) as string[];
      const cgPhones = contacts.map((c) => c.phone).filter(Boolean) as string[];

      if (diffMin >= escalation && !notifiedRef.current.emergency) {
        notifiedRef.current.emergency = true;
        // Push notification — generic copy on lock screen, name only in data payload
        if (cgTokens.length > 0) {
          await sendExpoPushNotification(
            cgTokens,
            "🚨 Terra Call — Emergency Alert",
            "A care recipient has not checked in. Open the app for details.",
            { type: "emergency", userId: user.id, receiverName },
            {
              channelId: NOTIFICATION_CHANNELS.emergencies,
              sound: TERRA_CALL_ALERT_SOUND,
              priority: "high",
            }
          );
        }
        // SMS backup via API server (only when receiver has opted in to SMS)
        if (cgPhones.length > 0 && smsConsent) {
          await triggerSmsAlert(cgPhones, receiverName, "emergency", diffMin);
        }
        // Log event for the admin dashboard
        logEvent(user.id, receiverName, "emergency").catch(() => {});
        // HIPAA audit
        logAudit({
          userId: user.id,
          action: "alert_emergency",
          details: `Emergency alert fired — ${receiverName} silent ${Math.round(diffMin)}m`,
        }).catch(() => {});
      } else if (diffMin >= missed && !notifiedRef.current.missed) {
        notifiedRef.current.missed = true;
        // Push notification — generic copy on lock screen, name only in data payload
        if (cgTokens.length > 0) {
          await sendExpoPushNotification(
            cgTokens,
            "⚠️ Terra Call — Missed Check-In",
            "A care recipient missed their scheduled check-in. Open the app for details.",
            { type: "missed", userId: user.id, receiverName },
            { channelId: NOTIFICATION_CHANNELS.alerts, priority: "high" }
          );
        }
        // SMS backup via API server (only when receiver has opted in to SMS)
        if (cgPhones.length > 0 && smsConsent) {
          await triggerSmsAlert(cgPhones, receiverName, "missed", diffMin);
        }
        // Log event for the admin dashboard
        logEvent(user.id, receiverName, "missed").catch(() => {});
        // HIPAA audit
        logAudit({
          userId: user.id,
          action: "alert_missed",
          details: `Missed check-in alert — ${receiverName} silent ${Math.round(diffMin)}m`,
        }).catch(() => {});
      }
    };

    // Run immediately, then every 60 seconds
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [user, lastCheckIn]);

  // ── Check in ──────────────────────────────────────────────────────────────
  const checkIn = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();

    if (isFirebaseConfigured && db) {
      await updateDoc(doc(db, "users", user.id), {
        lastCheckIn: serverTimestamp(),
        status: "checked-in",
      });
    } else {
      await AsyncStorage.setItem(`${CHECK_IN_KEY}:${user.id}`, now);
    }

    setLastCheckIn(now);
    setCheckInHistory((prev) => {
      const updated = [now, ...prev].slice(0, 7);
      AsyncStorage.setItem(`${HISTORY_KEY}:${user.id}`, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    notifiedRef.current = { missed: false, emergency: false };

    // Best-effort location capture (user-approved: only at check-in /
    // emergency, no background tracking). Fire-and-forget so a slow GPS fix
    // never delays the check-in itself.
    captureAndSaveLocation(user.id).catch(() => {});

    // Notify API server scheduler so it resets its counters too
    callNotifyApi("/api/notify/checkin", { userId: user.id, checkedInAt: now }).catch(() => {});

    // Log event for the admin dashboard
    logEvent(user.id, user.name ?? "Care Recipient", "checkin").catch(() => {});

    // HIPAA audit
    logAudit({
      userId: user.id,
      action: "checkin",
      details: "Care recipient recorded a check-in",
    }).catch(() => {});
  }, [user]);

  // I'M NOT OK — manually triggered emergency by care recipient
  // Bypasses check-in timer entirely — immediate alert to caregiver.
  // Routes everything through the API server so that:
  //   1. Push + SMS go out atomically (single source of truth)
  //   2. The server suppresses any pending "missed check-in" alerts that
  //      would otherwise fire moments later and clobber the EMERGENCY notice
  //   3. We have a server-side log of what was actually delivered
  const triggerEmergency = useCallback(async () => {
    if (!user) return;
    const receiverName = user.name ?? "Care Recipient";

    // Mark status in Firestore so caregiver dashboards update in real time.
    // We read the doc first to (a) pull smsConsent for the SMS fallback and
    // (b) read the existing recentAlerts history so we can APPEND this alert
    // (newest-first, capped) rather than overwrite it — that's what makes each
    // "I'M NOT OK" press show up individually on the caregiver dashboard.
    let smsConsent = false;
    if (isFirebaseConfigured && db) {
      const database = db;
      const ref = doc(database, "users", user.id);
      const entry: AlertEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        type: "manual_emergency",
        at: new Date().toISOString(),
      };
      // Append atomically inside a transaction so rapid repeated presses can't
      // lose-update each other (a plain getDoc→updateDoc would let two
      // concurrent presses both read the same array and clobber one entry).
      // The transaction also reads smsConsent for the SMS fallback below.
      try {
        smsConsent = await runTransaction(database, async (tx) => {
          const snap = await tx.get(ref);
          let prevAlerts: AlertEntry[] = [];
          let consent = false;
          if (snap.exists()) {
            const dat = snap.data();
            consent = dat.smsConsent ?? false;
            if (Array.isArray(dat.recentAlerts)) {
              prevAlerts = dat.recentAlerts.filter(
                (a: unknown): a is AlertEntry =>
                  !!a &&
                  typeof (a as AlertEntry).at === "string" &&
                  typeof (a as AlertEntry).type === "string",
              );
            }
          }
          const recentAlerts = [entry, ...prevAlerts].slice(0, 20);
          tx.update(ref, {
            status: "emergency",
            lastEmergencyAt: serverTimestamp(),
            recentAlerts,
          });
          return consent;
        });
      } catch {
        // Transaction failed (offline / contention exhausted). Fall back to a
        // best-effort direct write so the emergency status + this alert still
        // land — the caregiver dashboard updating is more important than a
        // perfectly de-duplicated history in this rare path.
        try {
          await updateDoc(ref, {
            status: "emergency",
            lastEmergencyAt: serverTimestamp(),
            recentAlerts: [entry],
          });
        } catch {
          /* non-fatal — push/SMS fallback below still fires */
        }
      }
    }

    // Suppress local notification flags so we don't fire a missed alert too
    notifiedRef.current = { missed: true, emergency: true };

    // Best-effort location capture so the caregiver map shows where the
    // emergency was raised. Fire-and-forget — must never delay the alert.
    captureAndSaveLocation(user.id).catch(() => {});

    // Log event for the admin dashboard
    logEvent(user.id, receiverName, "manual_emergency").catch(() => {});

    // HIPAA audit
    logAudit({
      userId: user.id,
      action: "alert_im_not_ok",
      details: `Care recipient pressed I'M NOT OK (${receiverName})`,
    }).catch(() => {});

    const contacts = await getCaregiverContacts(permittedCaregiversRef.current);
    const cgTokens = contacts.map((c) => c.pushToken).filter(Boolean) as string[];
    const cgPhones = contacts.map((c) => c.phone).filter(Boolean) as string[];

    // Single atomic call to the server — handles push, SMS, and missed-alert suppression.
    // Server respects smsConsent and skips SMS when false.
    const ok = await callNotifyApi("/api/notify/emergency", {
      userId: user.id,
      receiverName,
      caregiverTokens: cgTokens,
      caregiverPhones: smsConsent ? cgPhones : [],
    });

    // Fallback: if the server is unreachable, send directly from device
    if (!ok) {
      if (cgTokens.length > 0) {
        await sendExpoPushNotification(
          cgTokens,
          "🚨 Terra Call — Emergency Alert",
          "A care recipient needs help immediately. Open the app to respond.",
          { type: "manual_emergency", userId: user.id, receiverName },
          {
            channelId: NOTIFICATION_CHANNELS.emergencies,
            sound: TERRA_CALL_ALERT_SOUND,
            priority: "high",
          }
        );
      }
      if (cgPhones.length > 0 && smsConsent) {
        await triggerSmsAlert(cgPhones, receiverName, "manual_emergency", 0);
      }
    }
  }, [user]);

  const refreshStatus = useCallback(() => {
    if (!user || isFirebaseConfigured) return;
    AsyncStorage.getItem(`${RECEIVERS_KEY}:${user.id}`).then((val) => {
      if (val) setCareReceivers(JSON.parse(val));
    });
  }, [user]);

  return (
    <CareDataContext.Provider
      value={{ careReceivers, lastCheckIn, checkInHistory, checkIn, triggerEmergency, loading, refreshStatus }}
    >
      {children}
    </CareDataContext.Provider>
  );
}

export function useCareData() {
  const ctx = useContext(CareDataContext);
  if (!ctx) throw new Error("useCareData must be used within CareDataProvider");
  return ctx;
}
