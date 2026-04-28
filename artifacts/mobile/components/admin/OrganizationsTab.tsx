import React from "react";
import { ScrollView } from "react-native";
import { COLORS, PlaceholderTab } from "./shared";

export default function OrganizationsTab() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.BG }}>
      <PlaceholderTab
        title="Organizations"
        description="B2B account management — list, create, and edit home health agencies, MCOs, hospices, and consumer accounts. View members, contract details, and aggregate stats per organization."
      />
    </ScrollView>
  );
}
