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
  markEmergencyEventUnanswered,
} from "@/services/emergencyEventLog";
import {
  buildVideoRoomName,
  getCameraConsent,
  getReceiverPushToken,
  initiateCameraActivation,
  type CameraConsent,
} from "@/services/video";

export default function EmergencyCallScreen() {
  const { receiverName, receiverId, autoStart } = useLocalSearchParams<{
    receiverName?: string;
    receiverId?: string;
    autoStart?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  // TWILIO VIDEO — Phase 2 camera integration
  const [callState, setCallState] = useState<"idle" | "activating" | "no_consent">("idle");
  // EMERGENCY CALL FLOW — events doc id from createEmergencyEvent. We carry
  // it through the lifecycle so each subsequent state change patches the
  // SAME row instead of writing a new one.
  const eventIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  // True once the call reaches a terminal state (resolved/dismissed) so we
  // don't double-log dismissal on unmount after a successful resolve.
  const lifecycleClosedRef = useRef(false);
  // Synchronous re-entry guard for startVideoCall. `callState` is React state
  // and won't flip until the next render, so two rapid taps could both pass an
  // idle check and create duplicate events/activations before the first await
  // resolves. This ref blocks the second tap immediately.
  const startingRef = useRef(false);

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

  // TWILIO VIDEO — Phase 2 camera integration
  // 15 seconds elapsed without an answer — read the receiver's stored consent
  // and either notify them to activate their camera, or show "not consented".
  const attemptCameraActivation = async () => {
    setCallState("activating");

    if (!receiverId) {
      Alert.alert("Cannot activate camera", "Receiver information is missing.");
      setCallState("idle");
      startingRef.current = false;
      return;
    }

    // Push token is now optional — the server writes a Firestore signal doc
    // that the receiver subscribes to via onSnapshot, which works even when
    // the device has no valid push token (Android FCM blocked, missing APNs,
    // app force-killed, etc). Push remains as a best-effort wakeup.
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
      // EVENTS — close out the lifecycle row: no activation happened because
      // consent wasn't granted.
      markEmergencyEventUnanswered(eventIdRef.current, {
        cameraActivated: false,
        consentStatus: consent,
      });
      lifecycleClosedRef.current = true;
      startingRef.current = false;
      return;
    }

    const roomName = roomNameRef.current ?? buildVideoRoomName(receiverId);
    roomNameRef.current = roomName;

    const result = await initiateCameraActivation({
      // Pass token if we have one (push wakeup) — server tolerates absence
      // and falls back to Firestore signaling, which always works.
      receiverPushToken: pushToken ?? undefined,
      receiverName: receiverName ?? "Care recipient",
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
      startingRef.current = false;
      return;
    }

    // AUDIT + EVENTS — activation signaled. The Firestore signal is always
    // written on success; the push is a best-effort wakeup. Record which path
    // actually carried the wakeup so the trail shows token-missing fallbacks.
    if (user?.id) {
      logAudit({
        userId: user.id,
        action: "camera_activation_push_sent",
        details: `Camera activation signaled to ${receiverName ?? receiverId} — push wakeup ${result.pushSent ? "dispatched via Expo" : "skipped (no valid token) — relying on Firestore signal"} (room=${roomName})`,
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
        receiverName: receiverName ?? "Care recipient",
        receiverId,
        eventId: eventIdRef.current ?? "",
      },
    });
  };

  // TWILIO VIDEO — the in-app video session IS the communication channel.
  // Tapping the button opens the emergency lifecycle and asks the server to
  // activate the care recipient's camera (gated by their stored consent). NO
  // native phone dialer is triggered: a `tel:` call would launch the OS dialer
  // overlay on top of the live video and block the feed. 911 remains a real
  // phone call via the separate CALL 911 button.
  const startVideoCall = async () => {
    // Block rapid double-taps synchronously (see startingRef above).
    if (startingRef.current) return;
    startingRef.current = true;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (!receiverId) {
      Alert.alert("Cannot start video call", "Care recipient information is missing.");
      startingRef.current = false;
      return;
    }

    // Flip to "activating" immediately so the button disables on the next
    // render too (belt-and-suspenders with startingRef).
    setCallState("activating");

    // EMERGENCY CALL FLOW — open the lifecycle BEFORE activating the camera:
    //   1. AUDIT log "emergency_call_initiated"
    //   2. Create the `events` row that later state changes patch
    //      (unanswered → video_connected → resolved/dismissed).
    // Await the event creation so eventIdRef is set before
    // attemptCameraActivation patches the same row.
    if (user?.id) {
      const roomName = buildVideoRoomName(receiverId);
      roomNameRef.current = roomName;
      lifecycleClosedRef.current = false;

      logAudit({
        userId: user.id,
        action: "emergency_call_initiated",
        details: `Caregiver started a video call with ${receiverName ?? receiverId} (room=${roomName})`,
        targetUserId: receiverId,
      });

      try {
        eventIdRef.current = await createEmergencyEvent({
          caregiverId: user.id,
          careReceiverId: receiverId,
          roomName,
        });
      } catch {
        /* non-fatal — proceed with activation even if the event row fails */
      }
    }

    await attemptCameraActivation();
  };

  // AUTO-START — when launched from the emergency modal's one-tap "Connect Phone
  // Camera" action (autoStart=1), kick off the video call immediately so the
  // caregiver lands straight in the two-way feed without a second tap. Runs once.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStart === "1" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void startVideoCall();
    }
    // startVideoCall is intentionally not in deps — we fire this exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

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
          <Text style={styles.receiverName}>{receiverName ?? "Care Recipient"}</Text>
          <Text style={styles.receiverStatus}>Requires immediate assistance</Text>

          {/* TWILIO VIDEO — Phase 2 camera integration: state banners */}
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
                {receiverName ?? "This care recipient"} has not consented to camera activation
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
            style={[styles.callDevice, callState === "activating" && styles.callDeviceActive]}
            onPress={startVideoCall}
            disabled={callState === "activating"}
          >
            <Feather name="video" size={20} color="#FF3B30" />
            <Text style={styles.callDeviceText}>
              {callState === "activating" ? "Starting…" : "Start Video Call"}
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
