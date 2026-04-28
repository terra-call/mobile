import React from "react";
import { ScrollView } from "react-native";
import { COLORS, PlaceholderTab } from "./shared";

export default function AuditLogTab() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.BG }}>
      <PlaceholderTab
        title="Audit Log"
        description="HIPAA-required audit trail viewer — every login, logout, check-in, alert, profile update, and data access. Filter by date range, action type, or user. Export to CSV. Admin-only."
      />
    </ScrollView>
  );
}
