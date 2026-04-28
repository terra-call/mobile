import React from "react";
import { ScrollView } from "react-native";
import { COLORS, PlaceholderTab } from "./shared";

export default function CareReportsTab() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.BG }}>
      <PlaceholderTab
        title="Care Reports"
        description="Case-manager portal — list of every care receiver with compliance %, alert counts, and last check-in. Drill into any receiver for a full activity report and export to PDF or CSV. Saves report summary to the careReports collection."
      />
    </ScrollView>
  );
}
