import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { CameraConsentModal } from "@/components/CameraConsentModal";
import { CheckInButton } from "@/components/CheckInButton";
import { NotificationPermissionPrompt } from "@/components/NotificationPermissionPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { useCareData } from "@/contexts/CareDataContext";
import { useColors } from "@/hooks/useColors";
import { logAudit } from "@/services/audit";
import { db, isFirebaseConfigured } from "@/services/firebase";
import { registerForPushNotifications } from "@/services/notifications";
import { buildCallRoomName, initiateReceiverCall } from "@/services/video";
import { formatTimeAgo } from "@/utils/time";

// Color for "Call My Caregiver" button — medium blue, deliberately NOT the
// destructive red used by I'M NOT OK so users understand this is a routine
// call and not an emergency.
const CALL_BLUE = "#5391ce";

// How long to wait for the caregiver to answer before giving up and showing
// "No answer". 45s mirrors typical iOS/Android incoming call ring duration.
const CALL_TIMEOUT_MS = 45_000;

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

type CallState =
  | { phase: "idle" }
  // `docId` is the cameraActivations doc id returned by the server route;
  // we never enter `calling` without it (avoids onSnapshot(doc(db,col,""))
  // throwing on an empty reference).
  | { phase: "calling"; docId: string; roomName: string }
  | { phase: "unavailable"; reason: "declined" | "no_answer" | "error"; message: string };

export default function CareReceiverHome() {
  const { user, logout } = useAuth();
  const { lastCheckIn, checkInHistory, checkIn, triggerEmergency } = useCareData();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [justCheckedIn, setJustCheckedIn] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [caregiverName, setCaregiverName] = useState<string | null>(null);
  const [caregiverPhone, setCaregiverPhone] = useState<string | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  // `resolvingCaregiver` is true while we read the recipient's own user doc
  // to find their linked caregiver. Used to disable the call button so a
  // user can't tap it during the brief async window and see a spurious "No
  // Caregiver Linked" alert when one actually exists.
  const [resolvingCaregiver, setResolvingCaregiver] = useState(true);
  const confirmScale = useRef(new Animated.Value(0)).current;
  const confirmOpacity = useRef(new Animated.Value(0)).current;
  const [emergencySending, setEmergencySending] = useState(false);
  const [callState, setCallState] = useState<CallState>({ phase: "idle" });

  // TWILIO VIDEO — Phase 2 camera integration: one-time consent prompt
  const [consentNeeded, setConsentNeeded] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  // Resolve THIS recipient's linked caregiver (not "any caregiver in the
  // system"). We read from the recipient's own user doc:
  //   • permittedCaregivers[]  → {id, name, email} of caregivers the
  //                              recipient has invited & accepted.
  //   • permittedCaregiverIds[] → denormalized id list used by security rules.
  // For the "Call My Caregiver" button (single-target call) we use the first
  // permitted caregiver. Multi-caregiver selection UI is future work.
  useEffect(() => {
    if (!isFirebaseConfigured || !db || !user?.id) {
      setResolvingCaregiver(false);
      return;
    }
    let cancelled = false;
    setResolvingCaregiver(true);
    (async () => {
      try {
        const meSnap = await getDoc(doc(db, "users", user.id));
        if (cancelled || !meSnap.exists()) return;
        const me = meSnap.data() as {
          permittedCaregivers?: Array<{ id: string; name?: string; email?: string }>;
        };
        const first = me.permittedCaregivers?.[0];
        if (!first?.id) return;
        setCaregiverId(first.id);
        setCaregiverName(first.name ?? null);
        // Pull phone from the caregiver's own user doc (not denormalized).
        const cgSnap = await getDoc(doc(db, "users", first.id));
        if (cancelled || !cgSnap.exists()) return;
        const cg = cgSnap.data() as { name?: string; phone?: string };
        if (cg.name) setCaregiverName(cg.name);
        setCaregiverPhone(cg.phone && cg.phone.trim() ? cg.phone.trim() : null);
      } catch {
        // Silent: recipient just won't see caregiver name/phone; the call
        // button will remain disabled (caregiverId stays null).
      } finally {
        if (!cancelled) setResolvingCaregiver(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // RECIPIENT-INITIATED CALL — subscribe to the cameraActivations doc we just
  // wrote so we can react to caregiver's Answer / Decline / timeout.
  useEffect(() => {
    if (callState.phase !== "calling") return;
    if (!isFirebaseConfigured || !db) return;
    // Guard: TypeScript can't statically prove docId is non-empty in the
    // discriminated union, but our state machine never enters `calling`
    // without a server-returned docId. Belt-and-suspenders check so we
    // never call doc(db, col, "") which throws.
    if (!callState.docId) return;

    const ref = doc(db, "cameraActivations", callState.docId);
    const { roomName, docId } = callState;

    const timeoutHandle = setTimeout(() => {
      // No answer within CALL_TIMEOUT_MS — mark the doc cancelled (best-effort)
      // and surface "No answer" to the recipient.
      updateDoc(ref, { status: "cancelled", cancelledAt: serverTimestamp() }).catch(() => {});
      if (user) {
        logAudit({
          userId: user.id,
          action: "recipient_call_unavailable",
          details: `Caregiver did not answer within ${CALL_TIMEOUT_MS / 1000}s (room=${roomName})`,
        }).catch(() => {});
      }
      setCallState({
        phase: "unavailable",
        reason: "no_answer",
        message: "No answer. Your caregiver may be unavailable right now.",
      });
    }, CALL_TIMEOUT_MS);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as { status?: string } | undefined;
        if (!data) return;
        if (data.status === "answered") {
          clearTimeout(timeoutHandle);
          router.push({
            pathname: "/camera-stream",
            params: {
              mode: "publish",
              roomName,
              caregiverName: caregiverName ?? "Caregiver",
              // Forward the activation docId so the publisher's token mint
              // can pass /api/video/token's tc-call activation-doc binding
              // check (server requires it for tc-call-* rooms).
              activationDocId: docId,
            },
          });
          setCallState({ phase: "idle" });
        } else if (data.status === "declined") {
          clearTimeout(timeoutHandle);
          if (user) {
            logAudit({
              userId: user.id,
              action: "recipient_call_declined",
              details: `Caregiver declined incoming call (room=${roomName}, docId=${docId})`,
            }).catch(() => {});
          }
          setCallState({
            phase: "unavailable",
            reason: "declined",
            message: "Caregiver unavailable right now.",
          });
        }
      },
      () => {
        // Read denied / network — silent; rely on timeout to bail out.
      },
    );

    return () => {
      clearTimeout(timeoutHandle);
      unsub();
    };
  }, [callState, user, caregiverName]);

  const handleCallCaregiver = async () => {
    if (!user || !caregiverId) {
      Alert.alert(
        "No Caregiver Linked",
        "You don't have a caregiver linked to your account yet. Ask them to invite you, or add their email in Settings."
      );
      return;
    }

    const roomName = buildCallRoomName(user.id);

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }

    // No optimistic state transition: we must wait for the server-returned
    // signalDocId before entering `calling`, otherwise the subscribe effect
    // would call doc(db, col, "") and throw "invalid reference". The brief
    // delay (one HTTP round trip) is acceptable — the button still shows
    // immediate haptic feedback above.
    const result = await initiateReceiverCall({
      caregiverId,
      roomName,
      recipientName: user.name ?? "Care recipient",
      caregiverName: caregiverName ?? "Caregiver",
    });

    if (!result.ok || !result.signalDocId) {
      setCallState({
        phase: "unavailable",
        reason: "error",
        message: result.error ?? "Could not reach your caregiver. Please try again.",
      });
      return;
    }

    setCallState({ phase: "calling", docId: result.signalDocId, roomName });
    logAudit({
      userId: user.id,
      action: "recipient_initiated_call",
      details: `Care recipient initiated call to caregiver (room=${roomName}, caregiverId=${caregiverId}, docId=${result.signalDocId})`,
      targetUserId: caregiverId,
    }).catch(() => {});
  };

  const handleCancelCall = async () => {
    if (callState.phase !== "calling") return;
    const { docId, roomName } = callState;
    setCallState({ phase: "idle" });
    if (db && docId) {
      try {
        await updateDoc(doc(db, "cameraActivations", docId), {
          status: "cancelled",
          cancelledAt: serverTimestamp(),
        });
      } catch {
        // Best-effort.
      }
    }
    if (user) {
      logAudit({
        userId: user.id,
        action: "recipient_call_cancelled",
        details: `Care recipient cancelled outgoing call (room=${roomName})`,
      }).catch(() => {});
    }
  };

  // TWILIO VIDEO — Phase 2 camera integration
  // Check if the care-recipient has answered the camera-consent prompt yet.
  // Shows the modal once if cameraConsent is missing on their user doc.
  // If the doc itself is missing (edge case: user created via auth but never
  // had a profile written), still show the modal — answering it will create
  // the field via setDoc(merge:true).
  useEffect(() => {
    if (!user || !isFirebaseConfigured || !db) return;
    getDoc(doc(db, "users", user.id))
      .then((snap) => {
        if (!snap.exists()) {
          setConsentNeeded(true);
          return;
        }
        const v = snap.data().cameraConsent;
        if (v === undefined || v === null) setConsentNeeded(true);
      })
      .catch(() => {});
  }, [user]);

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

  // I'M NOT OK — manually triggered emergency by care recipient
  // Bypasses check-in timer entirely — immediate alert to caregiver
  const handleEmergencyAlert = () => {
    Alert.alert(
      "Send Emergency Alert?",
      "This will immediately notify your caregiver that you need help. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, I Need Help",
          style: "destructive",
          onPress: async () => {
            setEmergencySending(true);
            try {
              await triggerEmergency();
              if (Platform.OS !== "web") {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
              }
              Alert.alert(
                "Alert Sent",
                "Your caregiver has been notified immediately. Stay safe — help is on the way."
              );
            } catch {
              Alert.alert("Error", "Could not send alert. Please try again or call for help directly.");
            } finally {
              setEmergencySending(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      // Alert.alert's multi-button form is unreliable on react-native-web
      // (button order gets inverted in the underlying window.confirm).
      const ok = typeof window !== "undefined" ? window.confirm("Log out of Terra Call?") : true;
      if (ok) logout();
      return;
    }
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {user && (
        <CameraConsentModal
          visible={consentNeeded}
          userId={user.id}
          onAnswered={() => setConsentNeeded(false)}
        />
      )}

      <EmergencyModal
        visible={showEmergency}
        caregiverName={caregiverName}
        caregiverPhone={caregiverPhone}
        onDismiss={() => setShowEmergency(false)}
      />

      {/* RECIPIENT-INITIATED CALL — outgoing "Calling caregiver..." overlay */}
      <Modal
        visible={callState.phase === "calling"}
        animationType="fade"
        transparent
        onRequestClose={handleCancelCall}
      >
        <View style={styles.callingBackdrop}>
          <View style={styles.callingCard}>
            <View style={styles.callingIcon}>
              <Feather name="video" size={40} color={CALL_BLUE} />
            </View>
            <Text style={styles.callingTitle}>Calling caregiver…</Text>
            <Text style={styles.callingSubtitle}>
              {caregiverName ? `Ringing ${caregiverName}` : "Waiting for an answer"}
            </Text>
            <ActivityIndicator size="small" color={CALL_BLUE} style={{ marginTop: 6 }} />
            <Pressable style={styles.callingCancel} onPress={handleCancelCall}>
              <Feather name="phone-off" size={16} color="#fff" />
              <Text style={styles.callingCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* RECIPIENT-INITIATED CALL — outcome (declined / no answer / error) */}
      <Modal
        visible={callState.phase === "unavailable"}
        animationType="fade"
        transparent
        onRequestClose={() => setCallState({ phase: "idle" })}
      >
        <View style={styles.callingBackdrop}>
          <View style={styles.callingCard}>
            <View style={[styles.callingIcon, { backgroundColor: "rgba(255, 59, 48, 0.12)" }]}>
              <Feather name="phone-off" size={36} color="#FF3B30" />
            </View>
            <Text style={styles.callingTitle}>Caregiver unavailable</Text>
            <Text style={styles.callingSubtitle}>
              {callState.phase === "unavailable" ? callState.message : ""}
            </Text>
            <Pressable
              style={[styles.callingCancel, { backgroundColor: CALL_BLUE }]}
              onPress={() => setCallState({ phase: "idle" })}
            >
              <Text style={styles.callingCancelText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {!showEmergency && (
        <NotificationPermissionPrompt
          onGranted={() => {
            if (user?.id) registerForPushNotifications(user.id);
          }}
        />
      )}

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

        <Pressable
          style={[styles.notOkButton, { borderColor: colors.destructive + "55" }]}
          onPress={handleEmergencyAlert}
          disabled={emergencySending}
        >
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <Text style={[styles.notOkText, { color: colors.destructive }]}>
            {emergencySending ? "Sending Alert..." : "I'M NOT OK"}
          </Text>
        </Pressable>

        {/* Recipient-initiated video call — distinct blue color signals this
            is a routine "call my caregiver" action, not an emergency. */}
        {(() => {
          // Disabled when: still resolving caregiver from Firestore, no
          // caregiver is linked, or a call is already in flight. We dim the
          // border/text in those cases so the affordance matches behavior.
          const callDisabled =
            resolvingCaregiver || !caregiverId || callState.phase === "calling";
          const tint = callDisabled ? colors.mutedForeground : CALL_BLUE;
          return (
            <Pressable
              style={[styles.callCaregiverButton, { borderColor: tint + "55" }]}
              onPress={handleCallCaregiver}
              disabled={callDisabled}
            >
              <Feather name="video" size={16} color={tint} />
              <Text style={[styles.callCaregiverText, { color: tint }]}>
                {resolvingCaregiver
                  ? "Loading caregiver..."
                  : !caregiverId
                    ? "No Caregiver Linked"
                    : "Call My Caregiver"}
              </Text>
            </Pressable>
          );
        })()}

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
  notOkButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 36,
  },
  callCaregiverButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 36,
  },
  callCaregiverText: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  callingBackdrop: {
    flex: 1,
    backgroundColor: "rgba(6, 10, 24, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  callingCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#121a30",
    borderRadius: 22,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  callingIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(83, 145, 206, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  callingTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  callingSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  callingCancel: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF3B30",
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 32,
    minWidth: 140,
  },
  callingCancelText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  notOkText: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 1.2,
    fontFamily: "Inter_700Bold",
  },
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
