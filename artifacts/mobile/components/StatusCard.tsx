import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CareReceiver, ReceiverStatus } from "@/contexts/CareDataContext";
import { useColors } from "@/hooks/useColors";
import { formatTimeAgo } from "@/utils/time";

interface StatusCardProps {
  receiver: CareReceiver;
  onEmergency: () => void;
}

const STATUS_CONFIG: Record<
  ReceiverStatus,
  { label: string; color: string; icon: keyof typeof Feather.glyphMap }
> = {
  "checked-in": { label: "Safe", color: "#22FF6E", icon: "check-circle" },
  missed: { label: "Missed", color: "#FFB347", icon: "clock" },
  emergency: { label: "EMERGENCY", color: "#FF3B30", icon: "alert-triangle" },
  unknown: { label: "Unknown", color: "#8892B0", icon: "help-circle" },
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export function StatusCard({ receiver, onEmergency }: StatusCardProps) {
  const colors = useColors();
  const config = STATUS_CONFIG[receiver.status];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: config.color,
        },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: config.color + "22" }]}>
        <Text style={[styles.initials, { color: config.color }]}>{getInitials(receiver.name)}</Text>
      </View>

      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {receiver.name}
        </Text>
        <View style={styles.statusRow}>
          <Feather name={config.icon} size={12} color={config.color} />
          <Text style={[styles.statusLabel, { color: config.color }]}>{config.label}</Text>
          {receiver.lastCheckIn && (
            <Text style={[styles.time, { color: colors.mutedForeground }]}>
              · {formatTimeAgo(receiver.lastCheckIn)}
            </Text>
          )}
        </View>
        {receiver.phone && (
          <Text style={[styles.phone, { color: colors.mutedForeground }]}>{receiver.phone}</Text>
        )}
      </View>

      <Pressable
        style={[
          styles.emergencyBtn,
          { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "55" },
        ]}
        onPress={onEmergency}
        hitSlop={4}
      >
        <Feather name="phone-call" size={18} color={colors.destructive} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 3,
    borderWidth: 1,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusLabel: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 12, fontFamily: "Inter_400Regular" },
  phone: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  emergencyBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
});
