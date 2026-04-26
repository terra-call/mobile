import { Feather } from "@expo/vector-icons";
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
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { db, isFirebaseConfigured } from "@/services/firebase";

const NAVY = "#0A1F3D";
const TEAL = "#0097A7";
const TEAL_DARK = "#00727B";
const CARD_BG = "#0c1628";
const CARD_BORDER = "#1f2b45";
const TEXT = "#FFFFFF";
const MUTED = "#8892B0";
const SUB = "#B5C0D8";

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

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 24 : insets.top + 12;
  const bottomPadding = Platform.OS === "web" ? 24 : insets.bottom + 12;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<UserMetrics | null>(null);
  const [activity, setActivity] = useState<ActivityMetrics | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);

  const handleLogout = () => {
    Alert.alert("Log Out", "Sign out of the admin dashboard?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: logout },
    ]);
  };

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

      // ── Users ─────────────────────────────────────────────────────────
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

      // ── Activity & feed (events collection) ───────────────────────────
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
        // events collection may not exist yet — counts stay at zero
      }

      setActivity({ totalCheckIns, totalMissed, totalEmergencies, totalManualEmergencies });
      setFeed(feedItems);

      // ── System health (api server, twilio, firebase) ─────────────────
      let apiStatus: "up" | "down" | "unknown" = "unknown";
      let twilioRate: number | null = null;
      let twilioSent = 0;
      let twilioDelivered = 0;
      const errors: string[] = [];

      if (API_BASE) {
        try {
          const healthRes = await fetch(`${API_BASE}/healthz`);
          apiStatus = healthRes.ok ? "up" : "down";
        } catch {
          apiStatus = "down";
          errors.push("API server unreachable");
        }

        try {
          const twilioRes = await fetch(`${API_BASE}/admin/health`);
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
        firebase: "up", // we just successfully read users — Firebase is up
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
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={TEAL} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: bottomPadding + 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>TERRA CALL</Text>
          <Text style={styles.headerSub}>Admin Dashboard · {user?.name ?? "Founder"}</Text>
        </View>
        <Pressable onPress={handleLogout} style={styles.logoutBtn} hitSlop={10}>
          <Feather name="log-out" size={20} color={MUTED} />
        </Pressable>
      </View>

      {/* User Metrics */}
      <Card icon="users" title="User Metrics">
        <View style={styles.row}>
          <Stat value={users?.total ?? 0} label="Total Users" />
          <Stat value={users?.careReceivers ?? 0} label="Care Receivers" />
          <Stat value={users?.caregivers ?? 0} label="Caregivers" />
        </View>
        <View style={styles.row}>
          <Stat value={users?.signupsThisWeek ?? 0} label="New This Week" small />
          <Stat value={users?.signupsLastWeek ?? 0} label="New Last Week" small />
        </View>
        <View style={styles.row}>
          <Stat value={users?.active ?? 0} label="Active (7d)" small />
          <Stat value={users?.inactive ?? 0} label="Inactive Receivers" small />
        </View>
      </Card>

      {/* Activity Metrics */}
      <Card icon="activity" title="Activity Metrics">
        <View style={styles.row}>
          <Stat value={activity?.totalCheckIns ?? 0} label="Total Check-Ins" />
          <Stat value={activity?.totalMissed ?? 0} label="Missed Alerts" />
        </View>
        <View style={styles.row}>
          <Stat value={activity?.totalEmergencies ?? 0} label="Emergency Alerts" />
          <Stat value={activity?.totalManualEmergencies ?? 0} label={"I'M NOT OK Alerts"} />
        </View>
        {activity && activity.totalCheckIns + activity.totalMissed + activity.totalEmergencies + activity.totalManualEmergencies === 0 ? (
          <Text style={styles.note}>
            Event logging started this week. Counts will populate as users check in and alerts fire.
          </Text>
        ) : null}
      </Card>

      {/* System Health */}
      <Card icon="shield" title="System Health">
        <HealthRow label="API Server" status={health?.api ?? "unknown"} />
        <HealthRow label="Firebase" status={health?.firebase ?? "unknown"} />
        <View style={styles.healthRow}>
          <Text style={styles.healthLabel}>Twilio SMS Delivery</Text>
          <Text style={styles.healthValue}>
            {health?.twilioDeliveryRate !== null && health?.twilioDeliveryRate !== undefined
              ? `${Math.round(health.twilioDeliveryRate * 100)}% (${health.twilioDelivered}/${health.twilioSent})`
              : "—"}
          </Text>
        </View>
        {health?.recentErrors && health.recentErrors.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.errorLabel}>Recent Errors</Text>
            {health.recentErrors.slice(0, 3).map((e, i) => (
              <Text key={i} style={styles.errorText}>· {e}</Text>
            ))}
          </View>
        ) : null}
      </Card>

      {/* Top Activity Feed */}
      <Card icon="list" title="Recent Activity">
        {feed.length === 0 ? (
          <Text style={styles.note}>No events yet. Activity will appear here as users interact with the app.</Text>
        ) : (
          feed.map((ev) => (
            <View key={ev.id} style={styles.feedRow}>
              <View style={[styles.feedDot, { backgroundColor: dotColor(ev.type) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.feedTitle}>
                  {labelFor(ev.type)} · <Text style={styles.feedUser}>{ev.userName}</Text>
                </Text>
                <Text style={styles.feedTime}>{formatRelative(ev.timestamp)}</Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Card({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Feather name={icon} size={18} color={TEAL} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Stat({ value, label, small = false }: { value: number; label: string; small?: boolean }) {
  return (
    <View style={[styles.stat, small && styles.statSmall]}>
      <Text style={[styles.statValue, small && styles.statValueSmall]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HealthRow({ label, status }: { label: string; status: "up" | "down" | "unknown" }) {
  const color = status === "up" ? "#22FF6E" : status === "down" ? "#FF4D6D" : MUTED;
  const text = status === "up" ? "Operational" : status === "down" ? "Down" : "Unknown";
  return (
    <View style={styles.healthRow}>
      <Text style={styles.healthLabel}>{label}</Text>
      <View style={styles.healthValueWrap}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.healthValue, { color }]}>{text}</Text>
      </View>
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    case "checkin": return "#22FF6E";
    case "missed": return "#FFAA33";
    case "emergency":
    case "manual_emergency": return "#FF4D6D";
    default: return MUTED;
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

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#060a18" },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: NAVY,
    paddingHorizontal: 20,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: TEAL_DARK,
    marginBottom: 16,
  },
  brand: { color: TEXT, fontSize: 22, fontWeight: "800", letterSpacing: 2 },
  headerSub: { color: SUB, fontSize: 13, marginTop: 2 },
  logoutBtn: { padding: 6 },

  card: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 18,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  cardTitle: { color: TEXT, fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },

  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 10,
  },
  stat: {
    flex: 1,
    minWidth: 90,
    backgroundColor: "#0a1426",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#16213a",
  },
  statSmall: { paddingVertical: 10 },
  statValue: { color: TEAL, fontSize: 28, fontWeight: "800", letterSpacing: 0.5 },
  statValueSmall: { fontSize: 22 },
  statLabel: { color: MUTED, fontSize: 11, marginTop: 4, letterSpacing: 0.4, textTransform: "uppercase" },

  healthRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#16213a",
  },
  healthLabel: { color: SUB, fontSize: 14 },
  healthValue: { color: TEXT, fontSize: 14, fontWeight: "600" },
  healthValueWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  errorLabel: { color: "#FF4D6D", fontSize: 12, fontWeight: "600", marginBottom: 4 },
  errorText: { color: "#FFB0BD", fontSize: 12, lineHeight: 18 },

  note: { color: MUTED, fontSize: 12, fontStyle: "italic", marginTop: 6, lineHeight: 18 },

  feedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#16213a",
  },
  feedDot: { width: 10, height: 10, borderRadius: 5 },
  feedTitle: { color: TEXT, fontSize: 14, fontWeight: "600" },
  feedUser: { color: SUB, fontWeight: "400" },
  feedTime: { color: MUTED, fontSize: 11, marginTop: 2 },
});
