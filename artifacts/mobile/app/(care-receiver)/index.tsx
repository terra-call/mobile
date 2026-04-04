import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckInButton } from "@/components/CheckInButton";
import { useAuth } from "@/contexts/AuthContext";
import { useCareData } from "@/contexts/CareDataContext";
import { useColors } from "@/hooks/useColors";
import { formatTimeAgo } from "@/utils/time";

export default function CareReceiverHome() {
  const { user, logout } = useAuth();
  const { lastCheckIn, checkIn } = useCareData();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [justCheckedIn, setJustCheckedIn] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const handleCheckIn = async () => {
    try {
      await checkIn();
      setJustCheckedIn(true);
      setTimeout(() => setJustCheckedIn(false), 4000);
    } catch {
      Alert.alert("Error", "Could not complete check-in. Please try again.");
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <View style={styles.headerLeft}>
          <Image
            source={require("@/assets/images/terra_logo.jpg")}
            style={styles.headerLogo}
            contentFit="contain"
          />
          <View>
            <Text style={[styles.appName, { color: colors.primary }]}>TERRA CALL</Text>
            <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
              Hi, {user?.name?.split(" ")[0] ?? "Friend"}
            </Text>
          </View>
        </View>
        <Pressable onPress={handleLogout} hitSlop={12}>
          <Feather name="log-out" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {justCheckedIn ? (
          <View style={styles.confirmedBadge}>
            <Feather name="check-circle" size={20} color={colors.primary} />
            <Text style={[styles.confirmedText, { color: colors.primary }]}>Your caregiver has been notified!</Text>
          </View>
        ) : (
          <Text style={[styles.instruction, { color: colors.mutedForeground }]}>
            Tap the button to check in
          </Text>
        )}

        <CheckInButton onPress={handleCheckIn} />

        {lastCheckIn && (
          <View style={styles.lastCheckInRow}>
            <Feather name="clock" size={14} color={colors.mutedForeground} />
            <Text style={[styles.lastCheckInText, { color: colors.mutedForeground }]}>
              Last check-in: {formatTimeAgo(lastCheckIn)}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: bottomPadding + 20 }]}>
        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          Tap I'M OK to let your caregiver know you're safe
        </Text>
        <Pressable
          style={[styles.emergencyHelpButton, { borderColor: colors.destructive + "66" }]}
          onPress={() =>
            Alert.alert("Need Help?", "Call 911 for emergencies, or contact your caregiver directly.")
          }
        >
          <Feather name="phone-call" size={15} color={colors.destructive} />
          <Text style={[styles.emergencyHelpText, { color: colors.destructive }]}>Need Help?</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerLogo: { width: 38, height: 38, borderRadius: 19 },
  appName: { fontSize: 14, fontWeight: "800", letterSpacing: 2, fontFamily: "Inter_700Bold" },
  greeting: { fontSize: 13, marginTop: 1, fontFamily: "Inter_400Regular" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  instruction: { fontSize: 16, fontFamily: "Inter_400Regular" },
  confirmedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "rgba(34, 255, 110, 0.12)",
    borderRadius: 20,
  },
  confirmedText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  lastCheckInRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  lastCheckInText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  footer: {
    alignItems: "center",
    paddingHorizontal: 36,
    gap: 16,
  },
  helpText: { fontSize: 13, textAlign: "center", lineHeight: 20, fontFamily: "Inter_400Regular" },
  emergencyHelpButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  emergencyHelpText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
