// Admin Dashboard — wrapper. Renders the persistent header (TERRA CALL
// brand + logout) and a horizontal tab bar, then mounts whichever tab
// component the user has selected. Each tab owns its own data loading
// and scroll behavior, defined in `components/admin/<Tab>.tsx`.
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AdminTabs, { type AdminTabId } from "@/components/admin/AdminTabs";
import AuditLogTab from "@/components/admin/AuditLogTab";
import CareReportsTab from "@/components/admin/CareReportsTab";
import OrganizationsTab from "@/components/admin/OrganizationsTab";
import OverviewTab from "@/components/admin/OverviewTab";
import { COLORS } from "@/components/admin/shared";
import UsersTab from "@/components/admin/UsersTab";
import { useAuth } from "@/contexts/AuthContext";

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 24 : insets.top + 12;
  const [activeTab, setActiveTab] = useState<AdminTabId>("overview");

  const handleLogout = () => {
    Alert.alert("Log Out", "Sign out of the admin dashboard?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>TERRA CALL</Text>
          <Text style={styles.headerSub}>
            Admin Dashboard · {user?.name ?? "Founder"}
          </Text>
        </View>
        <Pressable onPress={handleLogout} style={styles.logoutBtn} hitSlop={10}>
          <Feather name="log-out" size={20} color={COLORS.MUTED} />
        </Pressable>
      </View>

      <AdminTabs active={activeTab} onChange={setActiveTab} />

      <View style={{ flex: 1 }}>
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "organizations" && <OrganizationsTab />}
        {activeTab === "users" && <UsersTab />}
        {activeTab === "care-reports" && <CareReportsTab />}
        {activeTab === "audit-log" && <AuditLogTab />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.BG },
  header: {
    backgroundColor: COLORS.NAVY,
    paddingHorizontal: 20,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  brand: { color: COLORS.TEXT, fontSize: 22, fontWeight: "800", letterSpacing: 2 },
  headerSub: { color: COLORS.SUB, fontSize: 13, marginTop: 2 },
  logoutBtn: { padding: 6 },
});
