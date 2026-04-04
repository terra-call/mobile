import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Alert, Animated, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function EmergencyCallScreen() {
  const { receiverName, receiverId } = useLocalSearchParams<{
    receiverName?: string;
    receiverId?: string;
  }>();
  const insets = useSafeAreaInsets();

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

    Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start();

    const makePulse = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(anim, { toValue: 2.6, duration: 1600, useNativeDriver: true }),
          ]),
          Animated.timing(anim, { toValue: 1, duration: 0, useNativeDriver: true }),
        ])
      );

    const p1 = makePulse(pulse1, 0);
    const p2 = makePulse(pulse2, 533);
    const p3 = makePulse(pulse3, 1066);
    p1.start(); p2.start(); p3.start();

    return () => {
      p1.stop(); p2.stop(); p3.stop();
    };
  }, []);

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

  const callDevice = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert(
      "Calling Device",
      `Initiating VoIP call to ${receiverName ?? "care receiver"}'s device.\n\nFull Twilio integration required for production calling.`
    );
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeIn }]}>
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {[pulse1, pulse2, pulse3].map((anim, i) => (
          <Animated.View
            key={i}
            style={[
              styles.pulseRing,
              {
                opacity: anim.interpolate({ inputRange: [1, 2.6], outputRange: [0.25, 0] }),
                transform: [{ scale: anim }],
              },
            ]}
          />
        ))}
      </View>

      <View style={[styles.content, { paddingTop: topPad + 24, paddingBottom: bottomPad + 24 }]}>
        <View style={styles.topSection}>
          <View style={styles.alertBadge}>
            <Feather name="alert-triangle" size={18} color="#fff" />
            <Text style={styles.alertBadgeText}>EMERGENCY ALERT</Text>
          </View>
        </View>

        <View style={styles.receiverSection}>
          <View style={styles.receiverAvatar}>
            <Feather name="user" size={44} color="#FF3B30" />
          </View>
          <Text style={styles.receiverName}>{receiverName ?? "Care Receiver"}</Text>
          <Text style={styles.receiverStatus}>Requires immediate assistance</Text>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.call911} onPress={call911}>
            <Feather name="phone-call" size={26} color="#fff" />
            <Text style={styles.call911Text}>CALL 911</Text>
          </Pressable>

          <Pressable style={styles.callDevice} onPress={callDevice}>
            <Feather name="smartphone" size={20} color="#FF3B30" />
            <Text style={styles.callDeviceText}>Call Their Device</Text>
          </Pressable>

          <Pressable style={styles.dismiss} onPress={() => router.back()}>
            <Text style={styles.dismissText}>Dismiss Alert</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08020d" },
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
    gap: 10,
    backgroundColor: "#FF3B30",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
  },
  alertBadgeText: { color: "#fff", fontSize: 13, fontWeight: "700", letterSpacing: 1.5 },
  receiverSection: { alignItems: "center", gap: 14 },
  receiverAvatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255, 59, 48, 0.15)",
    borderWidth: 2,
    borderColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
  },
  receiverName: {
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  receiverStatus: { fontSize: 16, color: "#FF3B30", textAlign: "center" },
  actions: { gap: 14 },
  call911: {
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
  call911Text: { fontSize: 24, fontWeight: "900", color: "#fff", letterSpacing: 3 },
  callDevice: {
    backgroundColor: "rgba(255, 59, 48, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 59, 48, 0.4)",
    borderRadius: 16,
    paddingVertical: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  callDeviceText: { fontSize: 16, fontWeight: "600", color: "#FF3B30" },
  dismiss: { alignItems: "center", paddingVertical: 16 },
  dismissText: { color: "rgba(255, 255, 255, 0.35)", fontSize: 15 },
});
