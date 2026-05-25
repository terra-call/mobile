// OverviewTab — the original 4-card admin dashboard content, refactored
// out of `app/(admin)/index.tsx` so the index file can host tab navigation.
// Behavior is unchanged from the pre-refactor dashboard.
import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
} from "firebase/firestore";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { db, isFirebaseConfigured } from "@/services/firebase";
import { Card, COLORS, HealthRow, Stat, styles as shared } from "./shared";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

interface UserMetrics {
  total: number;
  caregivers: number;
  careReceivers: number;
  signupsThisWeek: number;
  signupsLastWeek: number;
  active: number;
  inactive: number;
}

interface ActivityMetrics {
  totalCheckIns: number;
  totalMissed: number;
  totalEmergencies: number;
  totalManualEmergencies: number;
}

interface SystemHealth {
  api: "up" | "down" | "unknown";
  firebase: "up" | "down" | "unknown";
  twilioDeliveryRate: number | null;
  twilioSent: number;
  twilioDelivered: number;
  recentErrors: string[];
}

interface FeedEvent {
  id: string;
  type: string;
  userName: string;
  timestamp: Date | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<UserMetrics | null>(null);
  const [activity, setActivity] = useState<ActivityMetrics | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);

  const loadAll = useCallback(async () => {
    if (!isFirebaseConfigured || !db) {
      setLoading(false);
      return;
    }

    try {
      const now = Date.now();
      const startThisWeek = now - (new Date().getDay() * 24 * 60 * 60 * 1000);
      const startLastWeek = startThisWeek - WEEK_MS;
      const sevenDaysAgo = now - WEEK_MS;

      const usersSnap = await getDocs(collection(db, "users"));
      let total = 0,
        caregivers = 0,
        careReceivers = 0,
        signupsThisWeek = 0,
        signupsLastWeek = 0,
        active = 0,
        inactive = 0;

      usersSnap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        total += 1;
        const role = data.role as string | undefined;
        if (role === "care-receiver") careReceivers += 1;
        else if (role === "caregiver" || role === "family") caregivers += 1;

        const createdAt = (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.();
        if (typeof createdAt === "number") {
          if (createdAt >= startThisWeek) signupsThisWeek += 1;
          else if (createdAt >= startLastWeek && createdAt < startThisWeek) signupsLastWeek += 1;
        }

        const lastCheckIn = (data.lastCheckIn as { toMillis?: () => number } | undefined)?.toMillis?.();
        if (typeof lastCheckIn === "number" && lastCheckIn >= sevenDaysAgo) active += 1;
        else if (role === "care-receiver") inactive += 1;
      });

      setUsers({
        total,
        caregivers,
        careReceivers,
        signupsThisWeek,
        signupsLastWeek,
        active,
        inactive,
      });

      let totalCheckIns = 0,
        totalMissed = 0,
        totalEmergencies = 0,
        totalManualEmergencies = 0;
      const feedItems: FeedEvent[] = [];

      try {
        const eventsSnap = await getDocs(collection(db, "events"));
        eventsSnap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const t = data.type as string;
          if (t === "checkin") totalCheckIns += 1;
          else if (t === "missed") totalMissed += 1;
          else if (t === "emergency") totalEmergencies += 1;
          else if (t === "manual_emergency") totalManualEmergencies += 1;
        });

        const recentQuery = query(collection(db, "events"), orderBy("createdAt", "desc"), fbLimit(10));
        const recentSnap = await getDocs(recentQuery);
        recentSnap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const ts = (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null;
          feedItems.push({
            id: d.id,
            type: (data.type as string) ?? "unknown",
            userName: (data.userName as string) ?? "Unknown",
            timestamp: ts,
          });
        });
      } catch {
        // events collection may be empty or rule-restricted — counts stay at zero
      }

      setActivity({ totalCheckIns, totalMissed, totalEmergencies, totalManualEmergencies });
      setFeed(feedItems);

      let apiStatus: "up" | "down" | "unknown" = "unknown";
      let twilioRate: number | null = null;
      let twilioSent = 0;
      let twilioDelivered = 0;
      const errors: string[] = [];

      if (API_BASE) {
        try {
          const healthRes = await fetch(`${API_BASE}/api/healthz`);
          apiStatus = healthRes.ok ? "up" : "down";
        } catch {
          apiStatus = "down";
          errors.push("API server unreachable");
        }

        try {
          const twilioRes = await fetch(`${API_BASE}/api/admin/health`);
          if (twilioRes.ok) {
            const j = (await twilioRes.json()) as {
              twilio?: { sent?: number; delivered?: number; rate?: number | null };
              recentErrors?: string[];
            };
            twilioSent = j.twilio?.sent ?? 0;
            twilioDelivered = j.twilio?.delivered ?? 0;
            twilioRate = j.twilio?.rate ?? null;
            for (const e of j.recentErrors ?? []) errors.push(e);
          }
        } catch {
          // best-effort
        }
      }

      setHealth({
        api: apiStatus,
        firebase: "up",
        twilioDeliveryRate: twilioRate,
        twilioSent,
        twilioDelivered,
        recentErrors: errors,
      });
    } catch (err) {
      console.warn("[admin] load failed", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = () => {
    setRefreshing(true);
    loadAll();
  };

  if (loading) {
    return (
      <View style={[localStyles.center, { flex: 1 }]}>
        <ActivityIndicator size="large" color={COLORS.TEAL} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.BG }}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.TEAL} />}
    >
      <Card icon="users" title="User Metrics">
        <View style={shared.row}>
          <Stat value={users?.total ?? 0} label="Total Users" />
          <Stat value={users?.careReceivers ?? 0} label="Care Recipients" />
          <Stat value={users?.caregivers ?? 0} label="Caregivers" />
        </View>
        <View style={shared.row}>
          <Stat value={users?.signupsThisWeek ?? 0} label="New This Week" small />
          <Stat value={users?.signupsLastWeek ?? 0} label="New Last Week" small />
        </View>
        <View style={shared.row}>
          <Stat value={users?.active ?? 0} label="Active (7d)" small />
          <Stat value={users?.inactive ?? 0} label="Inactive Receivers" small />
        </View>
      </Card>

      <Card icon="activity" title="Activity Metrics">
        <View style={shared.row}>
          <Stat value={activity?.totalCheckIns ?? 0} label="Total Check-Ins" />
          <Stat value={activity?.totalMissed ?? 0} label="Missed Alerts" />
        </View>
        <View style={shared.row}>
          <Stat value={activity?.totalEmergencies ?? 0} label="Emergency Alerts" />
          <Stat value={activity?.totalManualEmergencies ?? 0} label={"I'M NOT OK Alerts"} />
        </View>
        {activity && activity.totalCheckIns + activity.totalMissed + activity.totalEmergencies + activity.totalManualEmergencies === 0 ? (
          <Text style={shared.note}>
            Event logging started this week. Counts will populate as users check in and alerts fire.
          </Text>
        ) : null}
      </Card>

      <Card icon="shield" title="System Health">
        <HealthRow label="API Server" status={health?.api ?? "unknown"} />
        <HealthRow label="Firebase" status={health?.firebase ?? "unknown"} />
        <View style={shared.healthRow}>
          <Text style={shared.healthLabel}>Twilio SMS Delivery</Text>
          <Text style={shared.healthValue}>
            {health?.twilioDeliveryRate !== null && health?.twilioDeliveryRate !== undefined
              ? `${Math.round(health.twilioDeliveryRate * 100)}% (${health.twilioDelivered}/${health.twilioSent})`
              : "—"}
          </Text>
        </View>
        {health?.recentErrors && health.recentErrors.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <Text style={shared.errorLabel}>Recent Errors</Text>
            {health.recentErrors.slice(0, 3).map((e, i) => (
              <Text key={i} style={shared.errorText}>· {e}</Text>
            ))}
          </View>
        ) : null}
      </Card>

      <Card icon="list" title="Recent Activity">
        {feed.length === 0 ? (
          <Text style={shared.note}>No events yet. Activity will appear here as users interact with the app.</Text>
        ) : (
          feed.map((ev) => (
            <View key={ev.id} style={localStyles.feedRow}>
              <View style={[localStyles.feedDot, { backgroundColor: dotColor(ev.type) }]} />
              <View style={{ flex: 1 }}>
                <Text style={localStyles.feedTitle}>
                  {labelFor(ev.type)} · <Text style={localStyles.feedUser}>{ev.userName}</Text>
                </Text>
                <Text style={localStyles.feedTime}>{formatRelative(ev.timestamp)}</Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function labelFor(type: string): string {
  switch (type) {
    case "checkin": return "Check-In";
    case "missed": return "Missed Alert";
    case "emergency": return "Emergency";
    case "manual_emergency": return "I'M NOT OK";
    default: return type;
  }
}

function dotColor(type: string): string {
  switch (type) {
    case "checkin": return COLORS.GREEN;
    case "missed": return COLORS.ORANGE;
    case "emergency":
    case "manual_emergency": return COLORS.RED;
    default: return COLORS.MUTED;
  }
}

function formatRelative(date: Date | null): string {
  if (!date) return "just now";
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const localStyles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  feedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.PANEL_BORDER,
  },
  feedDot: { width: 10, height: 10, borderRadius: 5 },
  feedTitle: { color: COLORS.TEXT, fontSize: 14, fontWeight: "600" },
  feedUser: { color: COLORS.SUB, fontWeight: "400" },
  feedTime: { color: COLORS.MUTED, fontSize: 11, marginTop: 2 },
});
