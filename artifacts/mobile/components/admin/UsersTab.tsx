import React from "react";
import { ScrollView } from "react-native";
import { COLORS, PlaceholderTab } from "./shared";

export default function UsersTab() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.BG }}>
      <PlaceholderTab
        title="Users"
        description="Searchable directory of every user with filters by role and organization. Detail pages for each user with check-in history, alert history, and admin actions: assign to org, change role, suspend, delete, send password reset."
      />
    </ScrollView>
  );
}
