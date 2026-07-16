import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { CareReceiver, ReceiverStatus } from "@/contexts/CareDataContext";
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

interface MapFallbackListProps {
  receivers: CareReceiver[];
  notice: string;
}

// Shared coordinate-list fallback used wherever the native Google/Apple map
// cannot render: web (no react-native-maps) and Android (no Google Maps API
// key configured yet — rendering MapView without one hard-crashes the app).
export function MapFallbackList({ receivers, notice }: MapFallbackListProps) {
  const colors = useColors();
  const withLocation = receivers.filter((r) => r.location);

  return (
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {withLocation.map((r) => {
        const color = STATUS_COLORS[r.status];
        return (
          <View
            key={r.id}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: color }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: color + "22" }]}>
              <Feather name="map-pin" size={20} color={color} />
            </View>
            <View style={styles.info}>
              <Text style={[styles.name, { color: colors.text }]}>{r.name}</Text>
              <Text style={[styles.coords, { color: colors.mutedForeground }]}>
                {r.location!.lat.toFixed(5)}°N, {Math.abs(r.location!.lng).toFixed(5)}°W
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: color + "22" }]}>
              <Text style={[styles.badgeText, { color }]}>{STATUS_LABELS[r.status]}</Text>
            </View>
          </View>
        );
      })}
      {withLocation.length === 0 && (
        <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="map-pin" size={15} color={colors.accent} />
          <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
            No locations shared yet. Locations appear here when care recipients check in with
            location sharing enabled.
          </Text>
        </View>
      )}
      <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="info" size={15} color={colors.accent} />
        <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>{notice}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, gap: 12, paddingBottom: 40 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderLeftWidth: 3,
    gap: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  coords: { fontSize: 11, marginTop: 3, fontFamily: "Inter_400Regular" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  notice: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
    marginTop: 4,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
});
