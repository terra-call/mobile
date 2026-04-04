import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
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
    location: { lat: 37.7739, lng: -122.4210 },
  },
];

export function CareDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [careReceivers, setCareReceivers] = useState<CareReceiver[]>([]);
  const [lastCheckIn, setLastCheckIn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (user.role === "care-receiver") {
      AsyncStorage.getItem(`${CHECK_IN_KEY}:${user.id}`).then((val) => {
        if (val) setLastCheckIn(val);
      });
    } else if (user.role === "caregiver" || user.role === "family") {
      AsyncStorage.getItem(`${RECEIVERS_KEY}:${user.id}`).then((val) => {
        if (val) {
          setCareReceivers(JSON.parse(val));
        } else {
          setCareReceivers(DEMO_RECEIVERS);
          AsyncStorage.setItem(`${RECEIVERS_KEY}:${user.id}`, JSON.stringify(DEMO_RECEIVERS));
        }
      });
    }
  }, [user]);

  const checkIn = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    await AsyncStorage.setItem(`${CHECK_IN_KEY}:${user.id}`, now);
    setLastCheckIn(now);
  }, [user]);

  const refreshStatus = useCallback(() => {
    if (!user) return;
    AsyncStorage.getItem(`${RECEIVERS_KEY}:${user.id}`).then((val) => {
      if (val) setCareReceivers(JSON.parse(val));
    });
  }, [user]);

  return (
    <CareDataContext.Provider value={{ careReceivers, lastCheckIn, checkIn, loading, refreshStatus }}>
      {children}
    </CareDataContext.Provider>
  );
}

export function useCareData() {
  const ctx = useContext(CareDataContext);
  if (!ctx) throw new Error("useCareData must be used within CareDataProvider");
  return ctx;
}
