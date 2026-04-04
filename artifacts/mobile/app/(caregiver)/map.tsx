import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MapDisplay } from "@/components/MapDisplay";
import type { ReceiverStatus } from "@/contexts/CareDataContext";
import { useCareData } from "@/contexts/CareDataContext";
import { useColors } from "@/hooks/useColors";

const STATUS_COLORS: Record<ReceiverStatus, string> = {
  "checked-in": "#22FF6E",
  missed: "#FFB347",
  emergency: "#FF3B30",
  unknown: "#8892B0",
};

const STATUS_LABELS: Record<ReceiverStatus, string> = {
  "checked-in": "Safe",
  missed: "Missed",
  emergency: "Emergency",
  unknown: "Unknown",
};

export default function MapScreen() {
  const { careReceivers } = useCareData();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const receiversWithLocation = careReceivers.filter((r) => r.location);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Location Map</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {receiversWithLocation.length} receiver{receiversWithLocation.length !== 1 ? "s" : ""} tracked
        </Text>
      </View>

      <MapDisplay receivers={careReceivers} />

      {Platform.OS !== "web" && (
        <View style={[styles.legend, { backgroundColor: colors.card + "ee", borderColor: colors.border }]}>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <View key={status} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: color }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>
                {STATUS_LABELS[status as ReceiverStatus]}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, marginTop: 4, fontFamily: "Inter_400Regular" },
  legend: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
