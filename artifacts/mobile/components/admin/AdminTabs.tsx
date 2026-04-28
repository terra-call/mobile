import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { COLORS } from "./shared";

export type AdminTabId = "overview" | "organizations" | "users" | "care-reports" | "audit-log";

const TABS: { id: AdminTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "organizations", label: "Organizations" },
  { id: "users", label: "Users" },
  { id: "care-reports", label: "Care Reports" },
  { id: "audit-log", label: "Audit Log" },
];

export default function AdminTabs({
  active,
  onChange,
}: {
  active: AdminTabId;
  onChange: (id: AdminTabId) => void;
}) {
  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onChange(tab.id)}
              style={[styles.pill, isActive && styles.pillActive]}
              hitSlop={6}
            >
              <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: COLORS.NAVY,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.TEAL_DARK,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillActive: {
    backgroundColor: "rgba(0, 151, 167, 0.18)",
    borderColor: COLORS.TEAL,
  },
  pillText: {
    color: COLORS.MUTED,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  pillTextActive: {
    color: COLORS.TEXT,
  },
});
