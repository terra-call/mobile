import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/services/firebase";
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
}

interface CareDataContextValue {
  careReceivers: CareReceiver[];
  lastCheckIn: string | null;
  checkIn: () => Promise<void>;
  loading: boolean;
  refreshStatus: () => void;
}

const CareDataContext = createContext<CareDataContextValue | null>(null);

const CHECK_IN_KEY = "@terra:checkIn";
const RECEIVERS_KEY = "@terra:receivers";

const DEMO_RECEIVERS: CareReceiver[] = [
  {
    id: "demo1",
    name: "Margaret Johnson",
    email: "margaret@demo.com",
    phone: "+1 (555) 010-1001",
    status: "checked-in",
    lastCheckIn: new Date(Date.now() - 12 * 60000).toISOString(),
    location: { lat: 37.7749, lng: -122.4194 },
  },
  {
    id: "demo2",
    name: "Robert Williams",
    email: "robert@demo.com",
    phone: "+1 (555) 010-1002",
    status: "missed",
    lastCheckIn: new Date(Date.now() - 47 * 60000).toISOString(),
    location: { lat: 37.7761, lng: -122.4186 },
  },
  {
    id: "demo3",
    name: "Eleanor Davis",
    email: "eleanor@demo.com",
    phone: "+1 (555) 010-1003",
    status: "emergency",
    lastCheckIn: new Date(Date.now() - 130 * 60000).toISOString(),
    location: { lat: 37.7739, lng: -122.421 },
  },
];

function computeStatus(lastCheckIn: any): ReceiverStatus {
  if (!lastCheckIn) return "unknown";
  const ts =
    typeof lastCheckIn.toDate === "function"
      ? lastCheckIn.toDate().getTime()
      : new Date(lastCheckIn).getTime();
  const diffMin = (Date.now() - ts) / 60000;
  if (diffMin < 30) return "checked-in";
  if (diffMin < 120) return "missed";
  return "emergency";
}

export function CareDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [careReceivers, setCareReceivers] = useState<CareReceiver[]>([]);
  const [lastCheckIn, setLastCheckIn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setCareReceivers([]);
      setLastCheckIn(null);
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
            }
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
            const status = computeStatus(data.lastCheckIn);
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
            };
          });
          setCareReceivers(
            liveReceivers.length > 0
              ? liveReceivers
              : DEMO_RECEIVERS
          );
          setLoading(false);
        });
        return unsubscribe;
      }
    } else {
      if (user.role === "care-receiver") {
        AsyncStorage.getItem(`${CHECK_IN_KEY}:${user.id}`).then((val) => {
          if (val) setLastCheckIn(val);
        });
      } else {
        AsyncStorage.getItem(`${RECEIVERS_KEY}:${user.id}`).then((val) => {
          if (val) {
            setCareReceivers(JSON.parse(val));
          } else {
            setCareReceivers(DEMO_RECEIVERS);
            AsyncStorage.setItem(
              `${RECEIVERS_KEY}:${user.id}`,
              JSON.stringify(DEMO_RECEIVERS)
            );
          }
        });
      }
    }
  }, [user]);

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
  }, [user]);

  const refreshStatus = useCallback(() => {
    if (!user || isFirebaseConfigured) return;
    AsyncStorage.getItem(`${RECEIVERS_KEY}:${user.id}`).then((val) => {
      if (val) setCareReceivers(JSON.parse(val));
    });
  }, [user]);

  return (
    <CareDataContext.Provider
      value={{ careReceivers, lastCheckIn, checkIn, loading, refreshStatus }}
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
