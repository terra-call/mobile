// AUTO EMERGENCY CAMERA — caregiver-side modal
// ─────────────────────────────────────────────────────────────────────────────
// Surfaces automatically (no recipient interaction required) the moment a care
// recipient enters an emergency / missed state — manual "I'M NOT OK", a missed
// check-in, or a no-response escalation. It renders the recipient's always-on
// Reolink home-camera feed so the caregiver gets immediate eyes on them.
//
// The recipient's phone (Twilio) camera stays available separately from the
// normal dashboard for conscious recipients; THIS modal is the hands-free
// emergency feed that needs no action from the recipient.
//
// Mirrors the global-modal pattern of IncomingCallModal: the parent listener
// (EmergencyCameraListener in app/_layout.tsx) owns the state and renders this
// over whatever caregiver screen is active.

import { Feather } from "@expo/vector-icons";
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
import { HomeCameraFeed } from "@/components/HomeCameraFeed";

export type EmergencyReason = "manual_emergency" | "emergency" | "missed";

export interface EmergencyAlert {
  recipientId: string;
  recipientName: string;
  reason: EmergencyReason;
}

function reasonCopy(reason: EmergencyReason): {
  label: string;
  detail: string;
  color: string;
  icon: keyof typeof Feather.glyphMap;
} {
  switch (reason) {
    case "manual_emergency":
      return {
        label: "EMERGENCY · I'M NOT OK",
        detail: "pressed their emergency button",
        color: "#FF3B30",
        icon: "alert-octagon",
      };
    case "emergency":
      return {
        label: "EMERGENCY · NO RESPONSE",
        detail: "has not responded — escalated to emergency",
        color: "#FF3B30",
        icon: "alert-triangle",
      };
    case "missed":
      return {
        label: "MISSED CHECK-IN",
        detail: "missed their scheduled check-in",
        color: "#FFB020",
        icon: "clock",
      };
  }
}

export function EmergencyCameraModal({
  alert,
  onDismiss,
}: {
  alert: EmergencyAlert | null;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const fadeIn = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 24 : insets.bottom;

  useEffect(() => {
    if (!alert) {
      fadeIn.setValue(0);
      pulse.setValue(1);
      return;
    }

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
    }
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [alert]);

  if (!alert) return null;

  const copy = reasonCopy(alert.reason);

  return (
    <Modal visible animationType="none" statusBarTranslucent transparent={false}>
      <Animated.View style={[styles.container, { opacity: fadeIn }]}>
        <View
          style={[
            styles.content,
            { paddingTop: topPad + 16, paddingBottom: bottomPad + 16 },
          ]}
        >
          {/* Alert banner */}
          <View style={[styles.banner, { backgroundColor: copy.color }]}>
            <Animated.View style={{ opacity: pulse }}>
              <Feather name={copy.icon} size={18} color="#fff" />
            </Animated.View>
            <Text style={styles.bannerText}>{copy.label}</Text>
          </View>

          {/* Recipient identity */}
          <View style={styles.identity}>
            <Text style={styles.name}>{alert.recipientName}</Text>
            <Text style={styles.detail}>{copy.detail}</Text>
          </View>

          {/* Live home-camera feed — continuous polling only for genuine
              emergencies/escalations. A missed check-in shows a single frame
              with a manual Refresh (no ~1.5s loop) to keep bandwidth down. */}
          <View style={styles.feedWrap}>
            <HomeCameraFeed
              targetUserId={alert.recipientId}
              active={
                alert.reason === "emergency" ||
                alert.reason === "manual_emergency"
              }
            />
            <View style={styles.liveTag}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>HOME CAMERA</Text>
            </View>
          </View>

          {/* Actions */}
          <Pressable
            style={styles.dismissBtn}
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
                  () => {},
                );
              }
              onDismiss();
            }}
          >
            <Feather name="x" size={22} color="#fff" />
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#060a18" },
  content: { flex: 1, paddingHorizontal: 16, gap: 14 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12,
    borderRadius: 14,
  },
  bannerText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1.2,
    fontFamily: "Inter_700Bold",
  },
  identity: { alignItems: "center", gap: 4 },
  name: {
    fontSize: 26,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  detail: {
    fontSize: 15,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  feedWrap: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#0a0e1c",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  liveTag: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(6,10,24,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22FF6E",
  },
  liveText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: "Inter_700Bold",
  },
  dismissBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 18,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  dismissText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
});
