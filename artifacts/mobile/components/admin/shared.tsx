// Shared color tokens, layout primitives, and reusable cards for the
// Admin Dashboard tabs. Keep all admin-screen styling derived from these
// constants so the navy/teal aesthetic stays consistent across tabs.
import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export const COLORS = {
  NAVY: "#0A1F3D",
  TEAL: "#0097A7",
  TEAL_DARK: "#00727B",
  CARD_BG: "#0c1628",
  CARD_BORDER: "#1f2b45",
  TEXT: "#FFFFFF",
  MUTED: "#8892B0",
  SUB: "#B5C0D8",
  BG: "#060a18",
  GREEN: "#22FF6E",
  RED: "#FF4D6D",
  ORANGE: "#FFAA33",
  PANEL_DARK: "#0a1426",
  PANEL_BORDER: "#16213a",
};

export function Card({
  icon,
  title,
  children,
  action,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Feather name={icon} size={18} color={COLORS.TEAL} />
        <Text style={styles.cardTitle}>{title}</Text>
        {action ? <View style={{ marginLeft: "auto" }}>{action}</View> : null}
      </View>
      {children}
    </View>
  );
}

export function Stat({
  value,
  label,
  small = false,
}: {
  value: number | string;
  label: string;
  small?: boolean;
}) {
  return (
    <View style={[styles.stat, small && styles.statSmall]}>
      <Text style={[styles.statValue, small && styles.statValueSmall]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function HealthRow({
  label,
  status,
}: {
  label: string;
  status: "up" | "down" | "unknown";
}) {
  const color = status === "up" ? COLORS.GREEN : status === "down" ? COLORS.RED : COLORS.MUTED;
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

export function PlaceholderTab({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={styles.placeholderWrap}>
      <View style={styles.placeholderCard}>
        <Text style={styles.placeholderTitle}>{title}</Text>
        <Text style={styles.placeholderText}>{description}</Text>
        <View style={styles.placeholderBadge}>
          <Text style={styles.placeholderBadgeText}>Building next</Text>
        </View>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
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
  cardTitle: { color: COLORS.TEXT, fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },

  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 10,
  },
  stat: {
    flex: 1,
    minWidth: 90,
    backgroundColor: COLORS.PANEL_DARK,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
  },
  statSmall: { paddingVertical: 10 },
  statValue: { color: COLORS.TEAL, fontSize: 28, fontWeight: "800", letterSpacing: 0.5 },
  statValueSmall: { fontSize: 22 },
  statLabel: { color: COLORS.MUTED, fontSize: 11, marginTop: 4, letterSpacing: 0.4, textTransform: "uppercase" },

  healthRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.PANEL_BORDER,
  },
  healthLabel: { color: COLORS.SUB, fontSize: 14 },
  healthValue: { color: COLORS.TEXT, fontSize: 14, fontWeight: "600" },
  healthValueWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  errorLabel: { color: COLORS.RED, fontSize: 12, fontWeight: "600", marginBottom: 4 },
  errorText: { color: "#FFB0BD", fontSize: 12, lineHeight: 18 },

  note: { color: COLORS.MUTED, fontSize: 12, fontStyle: "italic", marginTop: 6, lineHeight: 18 },

  placeholderWrap: { padding: 24, alignItems: "stretch" },
  placeholderCard: {
    backgroundColor: COLORS.CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    padding: 28,
    alignItems: "center",
  },
  placeholderTitle: {
    color: COLORS.TEXT,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 12,
    textAlign: "center",
  },
  placeholderText: {
    color: COLORS.SUB,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 18,
  },
  placeholderBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.TEAL,
    backgroundColor: "rgba(0, 151, 167, 0.12)",
  },
  placeholderBadgeText: {
    color: COLORS.TEAL,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});
