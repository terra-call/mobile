// Caregiver-side modal that appears when a care recipient taps "Call My
// Caregiver". Subscribes (via the parent listener) to cameraActivations docs
// where initiatedBy=="recipient" && caregiverId==self.uid && status=="pending".
//
// NOT an emergency — no countdown timer, no SMS, no escalation. The caregiver
// can Answer (joins the Twilio Video room as subscriber) or Decline (writes
// status:"declined" so the recipient sees "Caregiver unavailable").

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

export interface IncomingCall {
  docId: string;
  recipientId: string;
  recipientName: string;
  roomName: string;
}

export function IncomingCallModal({
  call,
  onAnswer,
  onDecline,
}: {
  call: IncomingCall | null;
  onAnswer: (call: IncomingCall) => void;
  onDecline: (call: IncomingCall) => void;
}) {
  const insets = useSafeAreaInsets();
  const fadeIn = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (!call) {
      fadeIn.setValue(0);
      pulse.setValue(1);
      return;
    }

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    Animated.timing(fadeIn, { toValue: 1, duration: 250, useNativeDriver: true }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [call]);

  if (!call) return null;

  return (
    <Modal visible animationType="none" statusBarTranslucent transparent={false}>
      <Animated.View style={[styles.container, { opacity: fadeIn }]}>
        <View style={[styles.content, { paddingTop: topPad + 32, paddingBottom: bottomPad + 24 }]}>
          {/* Top label */}
          <View style={styles.topSection}>
            <View style={styles.badge}>
              <Feather name="video" size={14} color="#fff" />
              <Text style={styles.badgeText}>INCOMING VIDEO CALL</Text>
            </View>
          </View>

          {/* Avatar + name */}
          <View style={styles.centerSection}>
            <Animated.View style={[styles.avatar, { transform: [{ scale: pulse }] }]}>
              <Feather name="user" size={56} color="#5391ce" />
            </Animated.View>
            <Text style={styles.name}>{call.recipientName}</Text>
            <Text style={styles.subtitle}>is calling you</Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              style={styles.declineBtn}
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                }
                onDecline(call);
              }}
            >
              <Feather name="phone-off" size={26} color="#fff" />
              <Text style={styles.btnText}>Decline</Text>
            </Pressable>

            <Pressable
              style={styles.answerBtn}
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                }
                onAnswer(call);
              }}
            >
              <Feather name="video" size={26} color="#060a18" />
              <Text style={[styles.btnText, { color: "#060a18" }]}>Answer</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

/**
 * Navigate the caregiver into the camera-stream subscribe view after
 * answering. Exported so the listener that owns the modal state can call it
 * once the Firestore status update has been written.
 *
 * IMPORTANT — camera-stream's param contract uses `mode: "view"` for the
 * subscriber side (NOT "subscribe") and reads the room's care-recipient uid
 * from `receiverId` (NOT `targetUserId`). The `activationDocId` is forwarded
 * so /api/video/token can bind the token mint to the signaled caregiverId
 * (defense against other permitted caregivers smuggling into a 1:1 call).
 */
export function navigateToCallSubscribe(
  call: IncomingCall & { activationDocId?: string },
): void {
  router.push({
    pathname: "/camera-stream",
    params: {
      mode: "view",
      roomName: call.roomName,
      receiverId: call.recipientId,
      receiverName: call.recipientName,
      ...(call.activationDocId ? { activationDocId: call.activationDocId } : {}),
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#060a18",
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  topSection: { alignItems: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#5391ce",
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 24,
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: "Inter_700Bold",
  },
  centerSection: { alignItems: "center", gap: 18 },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(83, 145, 206, 0.14)",
    borderWidth: 2,
    borderColor: "#5391ce",
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 30,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_400Regular",
  },
  actions: { flexDirection: "row", gap: 14 },
  declineBtn: {
    flex: 1,
    backgroundColor: "#FF3B30",
    borderRadius: 18,
    paddingVertical: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  answerBtn: {
    flex: 1,
    backgroundColor: "#22FF6E",
    borderRadius: 18,
    paddingVertical: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  btnText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
});
