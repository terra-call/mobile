import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Animated, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/services/audit";
import {
  createEmergencyEvent,
  markEmergencyEventDismissed,
  markEmergencyEventUnanswered,
} from "@/services/emergencyEventLog";
import {
  buildVideoRoomName,
  getCameraConsent,
  getReceiverPushToken,
  initiateCameraActivation,
  type CameraConsent,
} from "@/services/video";

// TWILIO VIDEO — Phase 2 camera integration
// If the caregiver presses "Call Their Device" and there is no answer within
// this many milliseconds, the app checks the receiver's stored consent and,
// if granted, asks the server to activate the receiver's front camera.
const UNANSWERED_THRESHOLD_MS = 15_000;

export default function EmergencyCallScreen() {
  const { receiverName, receiverId, receiverPhone } = useLocalSearchParams<{
    receiverName?: string;
    receiverId?: string;
    receiverPhone?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  // TWILIO VIDEO — Phase 2 camera integration
  const [callState, setCallState] = useState<"idle" | "calling" | "activating" | "no_consent">("idle");
  const [secondsRemaining, setSecondsRemaining] = useState(15);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activationStartedRef = useRef(false);
  // EMERGENCY CALL FLOW — events doc id from createEmergencyEvent. We carry
  // it through the lifecycle so each subsequent state change patches the
  // SAME row instead of writing a new one.
  const eventIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  // True once the call reaches a terminal state (resolved/dismissed) so we
  // don't double-log dismissal on unmount after a successful resolve.
  const lifecycleClosedRef = useRef(false);

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
      if (timerRef.current) clearInterval(timerRef.current);
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

  // TWILIO VIDEO — Phase 2 camera integration
  // After the caregiver dials the receiver's device, start a 15-second
  // unanswered-call timer. When it expires, check the receiver's consent and
  // either activate the camera or surface a "no consent" state.
  const startUnansweredTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCallState("calling");
    setSecondsRemaining(15);

    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += 1;
      const remaining = Math.max(0, 15 - elapsed);
      setSecondsRemaining(remaining);

      if (elapsed >= UNANSWERED_THRESHOLD_MS / 1000) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (!activationStartedRef.current) {
          activationStartedRef.current = true;
          attemptCameraActivation();
        }
      }
    }, 1000);
  };

  // TWILIO VIDEO — Phase 2 camera integration
  // 15 seconds elapsed without an answer — read the receiver's stored consent
  // and either notify them to activate their camera, or show "not consented".
  const attemptCameraActivation = async () => {
    setCallState("activating");

    if (!receiverId) {
      Alert.alert("Cannot activate camera", "Receiver information is missing.");
      setCallState("idle");
      return;
    }

    const [consent, pushToken]: [CameraConsent, string | null] = await Promise.all([
      getCameraConsent(receiverId),
      getReceiverPushToken(receiverId),
    ]);

    // AUDIT — record what the receiver's stored consent flag was at the
    // moment the 15s timer expired. This is HIPAA-relevant because the flag
    // governs whether the caregiver was permitted to activate the camera.
    if (user?.id) {
      logAudit({
        userId: user.id,
        action: "camera_consent_checked",
        details: `Camera consent for ${receiverName ?? "receiver"} = "${consent}" at unanswered-call escalation`,
        targetUserId: receiverId,
      });
    }

    if (consent !== "granted") {
      setCallState("no_consent");
      // EVENTS — close out the lifecycle row: timer hit zero, no activation
      // happened because consent wasn't granted.
      markEmergencyEventUnanswered(eventIdRef.current, {
        cameraActivated: false,
        consentStatus: consent,
      });
      lifecycleClosedRef.current = true;
      return;
    }

    if (!pushToken) {
      Alert.alert(
        "Cannot reach device",
        `${receiverName ?? "The care receiver"} has consented to camera activation, but their device hasn't registered for push notifications yet. Ask them to open the app and enable notifications.`
      );
      // AUDIT — failed before we even tried to send the push.
      if (user?.id) {
        logAudit({
          userId: user.id,
          action: "camera_activation_failed",
          details: `Receiver ${receiverName ?? receiverId} has no Expo push token registered`,
          targetUserId: receiverId,
        });
      }
      markEmergencyEventUnanswered(eventIdRef.current, {
        cameraActivated: false,
        consentStatus: consent,
      });
      lifecycleClosedRef.current = true;
      setCallState("idle");
      return;
    }

    const roomName = roomNameRef.current ?? buildVideoRoomName(receiverId);
    roomNameRef.current = roomName;

    const result = await initiateCameraActivation({
      receiverPushToken: pushToken,
      receiverName: receiverName ?? "Care receiver",
      caregiverName: user?.name ?? "Caregiver",
      roomName,
      // Pass receiver uid so the server can verify caller has permission.
      targetUserId: receiverId,
    });

    if (!result.ok) {
      Alert.alert(
        "Camera unavailable",
        result.error ??
          "We couldn't reach the camera-activation service. Try again or call 911 if this is an emergency."
      );
      // AUDIT — server refused or push dispatch failed.
      if (user?.id) {
        logAudit({
          userId: user.id,
          action: "camera_activation_failed",
          details: `Camera activation push failed: ${result.error ?? "unknown error"} (room=${roomName})`,
          targetUserId: receiverId,
        });
      }
      markEmergencyEventUnanswered(eventIdRef.current, {
        cameraActivated: false,
        consentStatus: consent,
      });
      lifecycleClosedRef.current = true;
      setCallState("idle");
      activationStartedRef.current = false;
      return;
    }

    // AUDIT + EVENTS — push successfully dispatched to receiver.
    if (user?.id) {
      logAudit({
        userId: user.id,
        action: "camera_activation_push_sent",
        details: `Camera activation push dispatched to ${receiverName ?? receiverId} (room=${roomName})`,
        targetUserId: receiverId,
      });
    }
    markEmergencyEventUnanswered(eventIdRef.current, {
      cameraActivated: true,
      consentStatus: consent,
    });
    // The events doc isn't "closed" here — camera-stream.tsx will continue
    // patching it through video_connected → resolved.

    // Navigate the caregiver into the live-stream viewer screen joining the
    // same Twilio Video room. Pass the eventId so camera-stream.tsx can
    // patch the same Firestore row when video connects / is resolved.
    router.replace({
      pathname: "/camera-stream",
      params: {
        mode: "view",
        roomName,
        receiverName: receiverName ?? "Care receiver",
        receiverId,
        eventId: eventIdRef.current ?? "",
      },
    });
  };

  // TWILIO VIDEO — Phase 2 camera integration
  // Wraps the existing tel: dialer call so we can also start the unanswered
  // timer in parallel. Native dialer takes over the screen, so when the
  // caregiver returns to this screen the timer may have already elapsed.
  // The timer is only started AFTER the dialer successfully opens, so a
  // failed dial does not silently trigger a camera activation.
  const callDevice = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (!receiverPhone || !receiverPhone.trim()) {
      Alert.alert(
        "No Phone Number",
        `${receiverName ?? "This care receiver"} hasn't added a phone number to their profile yet.`
      );
      return;
    }

    const digits = receiverPhone.replace(/\D/g, "");
    const url = `tel:${digits}`;
    const canOpen = await Linking.canOpenURL(url).catch(() => false);

    if (!canOpen) {
      Alert.alert("Call Device", `Please dial ${receiverPhone} manually.`);
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Call Device", `Could not open dialer. Please dial ${receiverPhone} manually.`);
      return;
    }

    // EMERGENCY CALL FLOW — open the lifecycle:
    //   1. AUDIT log "emergency_call_initiated"
    //   2. Create the `events` collection row that subsequent state changes
    //      will patch (unanswered → video_connected → resolved/dismissed).
    // Both are fire-and-forget — they MUST NOT block the dialer or timer.
    if (user?.id && receiverId) {
      const roomName = buildVideoRoomName(receiverId);
      roomNameRef.current = roomName;
      lifecycleClosedRef.current = false;

      logAudit({
        userId: user.id,
        action: "emergency_call_initiated",
        details: `Caregiver tapped "Call Their Device" for ${receiverName ?? receiverId} (room=${roomName})`,
        targetUserId: receiverId,
      });

      createEmergencyEvent({
        caregiverId: user.id,
        careReceiverId: receiverId,
        roomName,
      }).then((id) => {
        eventIdRef.current = id;
      });
    }

    // Dialer opened successfully — only NOW start the 15s unanswered timer.
    activationStartedRef.current = false;
    startUnansweredTimer();
  };

  const cancelTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // EMERGENCY CALL FLOW — caregiver dismissed BEFORE the 15s timer
    // elapsed. Patch the events doc + write an audit row so the trail
    // shows the call ended cleanly without escalation.
    if (!lifecycleClosedRef.current && eventIdRef.current && user?.id) {
      logAudit({
        userId: user.id,
        action: "emergency_call_dismissed",
        details: `Caregiver cancelled the unanswered-call timer before camera activation (room=${roomNameRef.current ?? "?"})`,
        targetUserId: receiverId,
      });
      markEmergencyEventDismissed(eventIdRef.current);
      lifecycleClosedRef.current = true;
    }
    activationStartedRef.current = false;
    setCallState("idle");
    setSecondsRemaining(15);
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

          {/* TWILIO VIDEO — Phase 2 camera integration: state banners */}
          {callState === "calling" && (
            <>
              {/* Prominent countdown — large circular ring with the seconds
                  remaining. Mirrors the audit/event lifecycle: when the
                  number hits zero, attemptCameraActivation fires. The ring
                  changes from green → amber → red as time runs out so the
                  caregiver gets an unmistakable visual cue. */}
              <View
                style={[
                  styles.countdownRing,
                  secondsRemaining <= 5 && styles.countdownRingUrgent,
                  secondsRemaining > 5 && secondsRemaining <= 10 && styles.countdownRingWarn,
                ]}
                accessibilityRole="timer"
                accessibilityLabel={`Camera will activate in ${secondsRemaining} seconds`}
                accessibilityLiveRegion="polite"
              >
                <Text
                  style={[
                    styles.countdownNumber,
                    secondsRemaining <= 5 && styles.countdownNumberUrgent,
                    secondsRemaining > 5 && secondsRemaining <= 10 && styles.countdownNumberWarn,
                  ]}
                >
                  {secondsRemaining}
                </Text>
                <Text style={styles.countdownLabel}>SECONDS</Text>
              </View>

              <View style={styles.timerBanner}>
                <Feather name="phone-call" size={14} color="#22FF6E" />
                <Text style={styles.timerText}>
                  Calling — activating camera if no answer
                </Text>
                <Pressable onPress={cancelTimer} hitSlop={8}>
                  <Text style={styles.timerCancel}>Cancel</Text>
                </Pressable>
              </View>
            </>
          )}
          {callState === "activating" && (
            <View style={styles.timerBanner}>
              <Feather name="video" size={14} color="#22FF6E" />
              <Text style={styles.timerText}>Activating front camera…</Text>
            </View>
          )}
          {callState === "no_consent" && (
            <View style={styles.noConsentBanner}>
              <Feather name="x-circle" size={14} color="#FFB347" />
              <Text style={styles.noConsentText}>
                {receiverName ?? "This care receiver"} has not consented to camera activation
              </Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.call911} onPress={call911}>
            <Feather name="phone-call" size={26} color="#fff" />
            <Text style={styles.call911Text}>CALL 911</Text>
          </Pressable>

          <Pressable
            style={[styles.callDevice, callState === "calling" && styles.callDeviceActive]}
            onPress={callDevice}
            disabled={callState === "calling" || callState === "activating"}
          >
            <Feather name="smartphone" size={20} color="#FF3B30" />
            <Text style={styles.callDeviceText}>
              {callState === "calling" ? "Calling…" : "Call Their Device"}
            </Text>
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
  // Prominent countdown ring — tracks the 15s unanswered window. Default is
  // the green Terra Call accent. countdownRingWarn (≤10s) shifts to amber,
  // countdownRingUrgent (≤5s) shifts to the same red as CALL 911 so the
  // caregiver instinctively understands time is almost up.
  countdownRing: {
    alignSelf: "center",
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 4,
    borderColor: "#22FF6E",
    backgroundColor: "rgba(34, 255, 110, 0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    shadowColor: "#22FF6E",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 10,
  },
  countdownRingWarn: {
    borderColor: "#FFB347",
    backgroundColor: "rgba(255, 179, 71, 0.08)",
    shadowColor: "#FFB347",
  },
  countdownRingUrgent: {
    borderColor: "#FF3B30",
    backgroundColor: "rgba(255, 59, 48, 0.1)",
    shadowColor: "#FF3B30",
  },
  countdownNumber: {
    fontSize: 56,
    fontWeight: "900",
    color: "#22FF6E",
    lineHeight: 60,
    fontVariant: ["tabular-nums"],
  },
  countdownNumberWarn: { color: "#FFB347" },
  countdownNumberUrgent: { color: "#FF3B30" },
  countdownLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2,
    color: "rgba(255,255,255,0.55)",
    marginTop: 2,
  },
  timerBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(34, 255, 110, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(34, 255, 110, 0.35)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 6,
  },
  timerText: {
    flex: 1,
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "500",
  },
  timerCancel: {
    color: "#22FF6E",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  noConsentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255, 179, 71, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 179, 71, 0.35)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 6,
  },
  noConsentText: {
    flex: 1,
    color: "#FFB347",
    fontSize: 12,
    fontWeight: "500",
  },
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
  callDeviceActive: { opacity: 0.55 },
  callDeviceText: { fontSize: 16, fontWeight: "600", color: "#FF3B30" },
  dismiss: { alignItems: "center", paddingVertical: 16 },
  dismissText: { color: "rgba(255, 255, 255, 0.35)", fontSize: 15 },
});
