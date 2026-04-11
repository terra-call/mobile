import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
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
} from "@/services/notifications";
import { useAuth } from "./AuthContext";

export type ReceiverStatus = "checked-in" | "missed" | "emergency" | "unknown";

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
}

interface CareDataContextValue {
  careReceivers: CareReceiver[];
  lastCheckIn: string | null;
  checkInHistory: string[];
  checkIn: () => Promise<void>;
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
  },
];

function computeStatus(
  lastCheckIn: any,
  missedWindowMin: number = DEFAULT_MISSED_MIN,
  escalationWindowMin: number = DEFAULT_ESCALATION_MIN
): ReceiverStatus {
  if (!lastCheckIn) return "unknown";
  const ts =
    typeof lastCheckIn.toDate === "function"
      ? lastCheckIn.toDate().getTime()
      : new Date(lastCheckIn).getTime();
  const diffMin = (Date.now() - ts) / 60000;
  if (diffMin < missedWindowMin) return "checked-in";
  if (diffMin < escalationWindowMin) return "missed";
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
            const status = computeStatus(data.lastCheckIn, missed, escalation);
            const ts = data.lastCheckIn;
            let lastCheckInStr: string | null = null;
            if (ts) {
              lastCheckInStr =
                typeof ts.toDate === "function"
                  ? ts.toDate().toISOString()
                  : new Date(ts).toISOString();
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

  // ── Care receiver status monitor (alerts caregivers when windows are exceeded)
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
      if (!notifEnabled) return;

      const ts = new Date(lastCheckIn).getTime();
      const diffMin = (Date.now() - ts) / 60000;

      const caregivers = permittedCaregiversRef.current;
      const receiverName = user.name ?? "Your care receiver";

      // Fetch push tokens + phone numbers in one batch
      const contacts = await getCaregiverContacts(caregivers);
      const cgTokens = contacts.map((c) => c.pushToken).filter(Boolean) as string[];
      const cgPhones = contacts.map((c) => c.phone).filter(Boolean) as string[];

      if (diffMin >= escalation && !notifiedRef.current.emergency) {
        notifiedRef.current.emergency = true;
        // Push notification
        if (cgTokens.length > 0) {
          await sendExpoPushNotification(
            cgTokens,
            `🚨 EMERGENCY — ${receiverName}`,
            `${receiverName} has not checked in for ${Math.round(diffMin)} minutes.`,
            { type: "emergency", userId: user.id }
          );
        }
        // SMS backup via API server
        if (cgPhones.length > 0) {
          await triggerSmsAlert(cgPhones, receiverName, "emergency", diffMin);
        }
      } else if (diffMin >= missed && !notifiedRef.current.missed) {
        notifiedRef.current.missed = true;
        // Push notification
        if (cgTokens.length > 0) {
          await sendExpoPushNotification(
            cgTokens,
            `⚠️ Missed Check-In — ${receiverName}`,
            `${receiverName} missed their scheduled check-in window.`,
            { type: "missed", userId: user.id }
          );
        }
        // SMS backup via API server
        if (cgPhones.length > 0) {
          await triggerSmsAlert(cgPhones, receiverName, "missed", diffMin);
        }
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

    // Notify API server scheduler so it resets its counters too
    callNotifyApi("/notify/checkin", { userId: user.id, checkedInAt: now }).catch(() => {});
  }, [user]);

  const refreshStatus = useCallback(() => {
    if (!user || isFirebaseConfigured) return;
    AsyncStorage.getItem(`${RECEIVERS_KEY}:${user.id}`).then((val) => {
      if (val) setCareReceivers(JSON.parse(val));
    });
  }, [user]);

  return (
    <CareDataContext.Provider
      value={{ careReceivers, lastCheckIn, checkInHistory, checkIn, loading, refreshStatus }}
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
