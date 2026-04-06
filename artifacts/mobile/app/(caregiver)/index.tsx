import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusCard } from "@/components/StatusCard";
import { useAuth } from "@/contexts/AuthContext";
import type { CareReceiver } from "@/contexts/CareDataContext";
import { useCareData } from "@/contexts/CareDataContext";
import { useColors } from "@/hooks/useColors";

type FilterType = "all" | "safe" | "issues";

export default function CaregiverDashboard() {
  const { user, logout } = useAuth();
  const { careReceivers, loading, refreshStatus } = useCareData();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterType>("all");
  const [refreshing, setRefreshing] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const counts = {
    safe: careReceivers.filter((r) => r.status === "checked-in").length,
    issues: careReceivers.filter((r) => r.status === "missed" || r.status === "emergency").length,
    emergency: careReceivers.filter((r) => r.status === "emergency").length,
    total: careReceivers.length,
  };

  const filtered =
    filter === "all"
      ? careReceivers
      : filter === "safe"
      ? careReceivers.filter((r) => r.status === "checked-in")
      : careReceivers.filter((r) => r.status === "missed" || r.status === "emergency");

  const handleRefresh = async () => {
    setRefreshing(true);
    refreshStatus();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleEmergency = (receiver: CareReceiver) => {
    router.push({ pathname: "/emergency-call", params: { receiverName: receiver.name, receiverId: receiver.id } });
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <View style={styles.headerLeft}>
          <Image
            source={require("@/assets/images/terra_logo.jpg")}
            style={styles.logo}
            contentFit="contain"
          />
          <View>
            <Text style={[styles.appName, { color: colors.primary }]}>TERRA CALL</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {counts.emergency > 0
                ? `${counts.emergency} emergency alert${counts.emergency > 1 ? "s" : ""}`
                : "All systems monitored"}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: counts.emergency > 0 ? colors.destructive : colors.primary },
            ]}
          />
          <Pressable onPress={() => router.push("/caregiver-settings")} hitSlop={10}>
            <Feather name="settings" size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable onPress={handleLogout} hitSlop={10}>
            <Text style={[styles.logOutText, { color: colors.mutedForeground }]}>Log Out</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.statsRow, { borderColor: colors.border }]}>
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: colors.primary }]}>{counts.safe}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Safe</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: colors.warning }]}>{counts.issues}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Issues</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: colors.text }]}>{counts.total}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(["all", "safe", "issues"] as FilterType[]).map((f) => (
          <Pressable
            key={f}
            style={[
              styles.filterTab,
              filter === f && { backgroundColor: colors.primary },
              filter !== f && { backgroundColor: colors.card },
            ]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[
                styles.filterText,
                { color: filter === f ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              {f === "all" ? "All" : f === "safe" ? "Safe" : "Issues"}
              {f !== "all" && (
                <Text style={{ fontWeight: "400" }}>
                  {" "}
                  ({f === "safe" ? counts.safe : counts.issues})
                </Text>
              )}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPadding + 100 }]}
        renderItem={({ item }) => (
          <StatusCard receiver={item} onEmergency={() => handleEmergency(item)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        scrollEnabled={!!filtered.length}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="users" size={42} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No care receivers to show
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 20 },
  appName: { fontSize: 16, fontWeight: "800", letterSpacing: 3, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, marginTop: 2, fontFamily: "Inter_400Regular" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  logOutText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  statsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingVertical: 14,
  },
  stat: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 30, fontWeight: "700", fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, marginTop: 2, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "Inter_500Medium" },
  divider: { width: 1 },
  filterRow: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 14 },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  filterText: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  list: { paddingHorizontal: 20, gap: 12 },
  empty: { alignItems: "center", paddingVertical: 64, gap: 14 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
});
