import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, getDocs, query, where } from "firebase/firestore";
import { CheckInButton } from "@/components/CheckInButton";
import { useAuth } from "@/contexts/AuthContext";
import { useCareData } from "@/contexts/CareDataContext";
import { useColors } from "@/hooks/useColors";
import { db, isFirebaseConfigured } from "@/services/firebase";
import { formatTimeAgo } from "@/utils/time";

function EmergencyModal({
  visible,
  caregiverName,
  caregiverPhone,
  onDismiss,
}: {
  visible: boolean;
  caregiverName: string | null;
  caregiverPhone: string | null;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (!visible) {
      fadeIn.setValue(0);
      pulse1.setValue(1);
      pulse2.setValue(1);
      pulse3.setValue(1);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    Animated.timing(fadeIn, { toValue: 1, duration: 350, useNativeDriver: true }).start();

    const makePulse = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 2.6, duration: 1600, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: 0, useNativeDriver: true }),
        ])
      );

    const p1 = makePulse(pulse1, 0);
    const p2 = makePulse(pulse2, 533);
    const p3 = makePulse(pulse3, 1066);
    p1.start(); p2.start(); p3.start();
    return () => { p1.stop(); p2.stop(); p3.stop(); };
  }, [visible]);

  const call911 = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    const url = "tel:911";
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      Linking.openURL(url);
    } else {
      Alert.alert("Call 911", "Please dial 911 manually for immediate emergency assistance.");
    }
  };

  const callCaregiver = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!caregiverPhone) {
      Alert.alert(
        "No Number on File",
        "Your caregiver's phone number hasn't been added yet. Ask them to update their profile."
      );
      return;
    }
    const digits = caregiverPhone.replace(/\D/g, "");
    const url = `tel:${digits}`;
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      Linking.openURL(url);
    } else {
      Alert.alert("Call Caregiver", `Please dial ${caregiverPhone} manually.`);
    }
  };

  return (
    <Modal visible={visible} animationType="none" statusBarTranslucent>
      <Animated.View style={[eStyles.container, { opacity: fadeIn }]}>
        {/* Pulsing rings */}
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {[pulse1, pulse2, pulse3].map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                eStyles.pulseRing,
                {
                  opacity: anim.interpolate({ inputRange: [1, 2.6], outputRange: [0.22, 0] }),
                  transform: [{ scale: anim }],
                },
              ]}
            />
          ))}
        </View>

        <View style={[eStyles.content, { paddingTop: topPad + 32, paddingBottom: bottomPad + 24 }]}>
          {/* Top badge */}
          <View style={eStyles.topSection}>
            <View style={eStyles.alertBadge}>
              <Feather name="alert-triangle" size={16} color="#fff" />
              <Text style={eStyles.alertBadgeText}>EMERGENCY</Text>
            </View>
          </View>

          {/* Centre icon */}
          <View style={eStyles.centerSection}>
            <View style={eStyles.avatar}>
              <Feather name="phone-call" size={44} color="#FF3B30" />
            </View>
            <Text style={eStyles.title}>Need Help?</Text>
            <Text style={eStyles.subtitle}>Choose an option below</Text>
          </View>

          {/* Action buttons */}
          <View style={eStyles.actions}>
            <Pressable style={eStyles.call911Btn} onPress={call911}>
              <Feather name="phone-call" size={26} color="#fff" />
              <Text style={eStyles.call911Text}>CALL 911</Text>
            </Pressable>

            <Pressable style={eStyles.caregiverBtn} onPress={callCaregiver}>
              <Feather name="user" size={20} color="#FF3B30" />
              <View style={{ flex: 1 }}>
                <Text style={eStyles.caregiverBtnText}>Call My Caregiver</Text>
                {caregiverPhone ? (
                  <Text style={eStyles.caregiverPhone}>{caregiverPhone}</Text>
                ) : caregiverName ? (
                  <Text style={eStyles.caregiverPhone}>{caregiverName}</Text>
                ) : (
                  <Text style={eStyles.caregiverPhone}>No number on file</Text>
                )}
              </View>
              <Feather name="chevron-right" size={18} color="rgba(255,59,48,0.5)" />
            </Pressable>

            <Pressable style={eStyles.dismissBtn} onPress={onDismiss}>
              <Text style={eStyles.dismissText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

export default function CareReceiverHome() {
  const { user, logout } = useAuth();
  const { lastCheckIn, checkInHistory, checkIn } = useCareData();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [justCheckedIn, setJustCheckedIn] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [caregiverName, setCaregiverName] = useState<string | null>(null);
  const [caregiverPhone, setCaregiverPhone] = useState<string | null>(null);
  const confirmScale = useRef(new Animated.Value(0)).current;
  const confirmOpacity = useRef(new Animated.Value(0)).current;

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  // Fetch caregiver contact info on mount
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;
    const q = query(collection(db, "users"), where("role", "==", "caregiver"));
    getDocs(q)
      .then((snap) => {
        if (!snap.empty) {
          const data = snap.docs[0].data();
          setCaregiverName(data.name ?? null);
          setCaregiverPhone(data.phone && data.phone.trim() ? data.phone.trim() : null);
        }
      })
      .catch(() => {});
  }, []);

  const handleCheckIn = async () => {
    try {
      await checkIn();
      setJustCheckedIn(true);
      confirmScale.setValue(0.5);
      confirmOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(confirmScale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 6 }),
        Animated.timing(confirmOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        Animated.timing(confirmOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
          setJustCheckedIn(false);
        });
      }, 3500);
    } catch {
      Alert.alert("Error", "Could not complete check-in. Please try again.");
    }
  };

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <EmergencyModal
        visible={showEmergency}
        caregiverName={caregiverName}
        caregiverPhone={caregiverPhone}
        onDismiss={() => setShowEmergency(false)}
      />

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
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push("/(care-receiver)/settings")} hitSlop={10}>
            <Feather name="settings" size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable onPress={handleLogout} hitSlop={10}>
            <Text style={[styles.logOutText, { color: colors.mutedForeground }]}>Log Out</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {justCheckedIn ? (
          <Animated.View
            style={[
              styles.confirmedBadge,
              { transform: [{ scale: confirmScale }], opacity: confirmOpacity },
            ]}
          >
            <Feather name="check-circle" size={22} color={colors.primary} />
            <Text style={[styles.confirmedText, { color: colors.primary }]}>Check-in recorded!</Text>
          </Animated.View>
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

        {checkInHistory.length > 0 && (
          <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.historyHeader}>
              <Feather name="list" size={14} color={colors.accent} />
              <Text style={[styles.historyTitle, { color: colors.mutedForeground }]}>Recent Check-Ins</Text>
            </View>
            {checkInHistory.map((ts, i) => {
              const date = new Date(ts);
              const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
              const timeStr = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
              return (
                <View
                  key={ts}
                  style={[styles.historyRow, i < checkInHistory.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                >
                  <View style={[styles.historyDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.historyDate, { color: colors.text }]}>{dateStr}</Text>
                  <Text style={[styles.historyTime, { color: colors.mutedForeground }]}>{timeStr}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPadding + 20 }]}>
        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          Tap I'M OK to let your caregiver know you're safe
        </Text>
        <Pressable
          style={[styles.emergencyHelpButton, { borderColor: colors.destructive + "66" }]}
          onPress={() => setShowEmergency(true)}
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
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingHorizontal: 24,
    paddingBottom: 24,
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  logOutText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  historyCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  historyTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: "Inter_600SemiBold",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  historyDot: { width: 7, height: 7, borderRadius: 4 },
  historyDate: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  historyTime: { fontSize: 13, fontFamily: "Inter_400Regular" },
});

const eStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#08020d",
  },
  pulseRing: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "#FF3B30",
    alignSelf: "center",
    top: "50%",
    marginTop: -110,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  topSection: { alignItems: "center" },
  alertBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FF3B30",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
  },
  alertBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: "Inter_700Bold",
  },
  centerSection: { alignItems: "center", gap: 16 },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255, 59, 48, 0.12)",
    borderWidth: 2,
    borderColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.3,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 15,
    color: "rgba(255,255,255,0.45)",
    fontFamily: "Inter_400Regular",
  },
  actions: { gap: 14 },
  call911Btn: {
    backgroundColor: "#FF3B30",
    borderRadius: 18,
    paddingVertical: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    shadowColor: "#FF3B30",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 28,
    elevation: 14,
  },
  call911Text: {
    fontSize: 24,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 3,
    fontFamily: "Inter_700Bold",
  },
  caregiverBtn: {
    backgroundColor: "rgba(255, 59, 48, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 59, 48, 0.35)",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  caregiverBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FF3B30",
    fontFamily: "Inter_600SemiBold",
  },
  caregiverPhone: {
    fontSize: 12,
    color: "rgba(255,59,48,0.55)",
    marginTop: 2,
    fontFamily: "Inter_400Regular",
  },
  dismissBtn: {
    alignItems: "center",
    paddingVertical: 18,
  },
  dismissText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
});
