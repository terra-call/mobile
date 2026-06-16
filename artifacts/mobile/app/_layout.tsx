import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  IncomingCallModal,
  navigateToCallSubscribe,
  type IncomingCall,
} from "@/components/IncomingCallModal";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CareDataProvider } from "@/contexts/CareDataContext";
import { STORAGE_KEYS } from "@/constants/storage";
import { logAudit } from "@/services/audit";
import { registerForPushNotifications } from "@/services/notifications";
import { db, isFirebaseConfigured } from "@/services/firebase";

// Module-level dedupe so the push handler and the Firestore handler
// don't both navigate for the same activation. First handler to claim a
// roomName wins; the other no-ops. Auto-evicts after 60s.
const handledActivations = new Set<string>();
function claimActivation(roomName: string): boolean {
  if (handledActivations.has(roomName)) return false;
  handledActivations.add(roomName);
  setTimeout(() => handledActivations.delete(roomName), 60_000);
  return true;
}

// COLD START — when the app is fully killed and the user taps a push, the OS
// LAUNCHES the app to handle it. expo-notifications' response listener does
// NOT fire for that launching notification, so each direction's listener must
// consult Notifications.getLastNotificationResponseAsync() exactly once per
// process. These module-level flags guarantee "once per launch" even though
// the listener effects can re-run when the auth user loads.
let recipientColdStartHandled = false;
let caregiverColdStartHandled = false;

// On a cold start the NavigationGuard performs its own initial router.replace
// to land the user on their role dashboard. If we navigate to the camera
// screen at the same instant, that replace can clobber it. Defer the
// cold-start navigation slightly so the guard settles first, then push the
// camera modal on top of the dashboard.
const COLD_START_NAV_DELAY_MS = 1200;

const ONBOARDING_KEY = STORAGE_KEYS.ONBOARDING_SEEN;

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#060a18",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  name: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 5,
  },
  line: {
    width: 36,
    height: 2,
    backgroundColor: "#22FF6E",
    borderRadius: 1,
  },
  tagline: {
    color: "#8892B0",
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});

const AUTH_SCREENS = ["login", "register", "onboarding"];

// Register for push notifications when a care recipient logs in
function NotificationInitializer() {
  const { user } = useAuth();
  const registeredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== "care-receiver") return;
    if (registeredRef.current === user.id) return;
    registeredRef.current = user.id;
    registerForPushNotifications(user.id);
  }, [user]);

  return null;
}

// TWILIO VIDEO — Phase 2 camera integration
// Listens for camera_activate push notifications. When the care-recipient's
// device receives one (either while app is foregrounded, or when the user
// taps the notification), navigate them into the camera-publish screen.
//
// EMERGENCY CALL FLOW (Prompt 2 / Task 1) — every receipt of a
// camera_activate push is audit-logged so the admin Care Reports tab can
// see exactly when the receiver's device was woken up and what room it
// was directed into. The roomName acts as the cross-device correlator
// against the caregiver's `events` doc + audit rows.
function CameraActivationListener() {
  const { user } = useAuth();
  const userIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  const handle = useCallback(
    (notification: Notifications.Notification, opts?: { coldStart?: boolean }) => {
      const data = notification.request?.content?.data as
        | {
            type?: string;
            roomName?: string;
            caregiverName?: string;
            receiverUid?: string;
          }
        | undefined;
      if (data?.type !== "camera_activate" || !data.roomName) return;

      // DEFENSIVE — if the push includes the intended receiver UID, ignore
      // it when the currently logged-in user doesn't match. This guards
      // against the stale-push-token routing bug where a caregiver's old
      // device still holds the receiver's expoPushToken in Firestore.
      const uid = userIdRef.current;
      if (data.receiverUid && uid && data.receiverUid !== uid) {
        logAudit({
          userId: uid,
          action: "camera_activation_ignored",
          details: `Ignored camera_activate push intended for ${data.receiverUid} (this device is logged in as ${uid}, room=${data.roomName})`,
        });
        return;
      }

      // AUDIT — record receipt on the receiver's device. Use the userId
      // ref so a logout/login mid-call doesn't write to the wrong uid.
      if (uid) {
        logAudit({
          userId: uid,
          action: "camera_activation_received",
          details: `Care-recipient device received camera_activate push (room=${data.roomName}, from=${data.caregiverName ?? "?"}${opts?.coldStart ? ", cold-start tap" : ""})`,
        });
      }

      if (!claimActivation(data.roomName)) return;

      const roomName = data.roomName;
      const caregiverName = data.caregiverName ?? "Caregiver";
      // Navigate immediately. Any cold-start settle delay is owned by the
      // cold-start effect below (so it can be cancelled if auth/role changes
      // during the window) — never by a fire-and-forget timer in here.
      router.push({
        pathname: "/camera-stream",
        params: { mode: "publish", roomName, caregiverName },
      });
    },
    [],
  );

  // WARM PATH — foreground receipt + tap while the app is already running or
  // backgrounded (not killed).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const recvSub = Notifications.addNotificationReceivedListener((n) => handle(n));
    const respSub = Notifications.addNotificationResponseReceivedListener((response) =>
      handle(response.notification)
    );
    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, [handle]);

  // COLD START — app launched from a killed state by tapping the push. Gate on
  // the receiver role so we don't burn the once-per-process flag while a
  // caregiver account happens to be active first (their account can log in
  // later in the same process and still get handled). The settle delay lets
  // the NavigationGuard land on the dashboard before we push the camera modal
  // on top; it is cancelled if the user/role changes during the window
  // (logout, role redirect) so a stale launch tap can never navigate.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!user?.id || user.role !== "care-receiver") return;
    if (recipientColdStartHandled) return;
    recipientColdStartHandled = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled || !response) return;
        timer = setTimeout(() => {
          handle(response.notification, { coldStart: true });
        }, COLD_START_NAV_DELAY_MS);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user?.id, user?.role, handle]);

  return null;
}

// FIRESTORE SIGNALING FALLBACK — primary delivery path for camera activation.
// Subscribes to `cameraActivations` docs targeting the current care-recipient
// and triggers the same publish-mode navigation as the push handler. Works on
// every platform regardless of push-token state (FCM-blocked Android, missing
// APNs, silent mode, low power, etc) as long as the app is foregrounded or
// recently backgrounded — Firestore listeners run on a persistent connection.
function CameraActivationFirestoreListener() {
  const { user } = useAuth();
  const sessionStartRef = useRef<number>(Date.now());
  const userIdRef = useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
    sessionStartRef.current = Date.now();
  }, [user?.id]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!user || user.role !== "care-receiver") return;
    if (!isFirebaseConfigured || !db) return;

    const q = query(
      collection(db, "cameraActivations"),
      where("receiverUid", "==", user.id),
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const data = change.doc.data() as {
            receiverUid?: string;
            callerName?: string;
            roomName?: string;
            status?: string;
            createdAt?: Timestamp;
          };

          if (data.status !== "pending") return;
          const roomName = data.roomName;
          if (!roomName) return;

          // Skip docs older than this session - 5s slack. Prevents replaying
          // historical activations on app reopen / re-listen.
          const createdAtMs = data.createdAt?.toMillis?.() ?? 0;
          if (createdAtMs && createdAtMs < sessionStartRef.current - 5000) return;

          // Defensive — ignore if for a different uid (shouldn't happen given
          // the where() filter, but match the push-handler defense).
          const uid = userIdRef.current;
          if (uid && data.receiverUid && data.receiverUid !== uid) return;

          if (!claimActivation(roomName)) return;

          if (uid) {
            logAudit({
              userId: uid,
              action: "camera_activation_received",
              details: `Care-recipient device received cameraActivations doc (room=${roomName}, from=${data.callerName ?? "?"})`,
            }).catch(() => {});
          }

          // Best-effort: mark the doc processed so other devices logged into
          // the same account (rare but possible) don't re-trigger.
          updateDoc(change.doc.ref, {
            status: "processed",
            processedAt: serverTimestamp(),
          }).catch(() => {});

          router.push({
            pathname: "/camera-stream",
            params: {
              mode: "publish",
              roomName,
              caregiverName: data.callerName ?? "Caregiver",
            },
          });
        });
      },
      () => {
        // Permission errors / network errors — silent. Push still works.
      },
    );

    return () => unsub();
  }, [user?.id, user?.role]);

  return null;
}

// RECIPIENT-INITIATED CALL FLOW — caregiver-side listener
// Subscribes to cameraActivations docs where caregiverId == this caregiver's
// uid and initiatedBy == "recipient" and status == "pending". Shows the
// IncomingCallModal globally so it surfaces over any caregiver screen.
//
// NOT an emergency: no countdown, no SMS, no escalation. Pure call-and-answer.
function IncomingCallListener() {
  const { user } = useAuth();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const handledRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    sessionStartRef.current = Date.now();
    handledRef.current = new Set();
  }, [user?.id]);

  // PUSH WAKEUP — caregiver side. The Firestore listener below only fires
  // while the app is foregrounded (onSnapshot pauses in background), so a push
  // is what surfaces the incoming-call modal when the caregiver's app is
  // backgrounded or was killed. Deduped against the Firestore path via the
  // shared handledRef (keyed on the cameraActivations docId / signalDocId).
  const handlePush = useCallback((notification: Notifications.Notification) => {
    const data = notification.request?.content?.data as
      | {
          type?: string;
          roomName?: string;
          recipientId?: string;
          recipientName?: string;
          signalDocId?: string;
          caregiverUid?: string;
        }
      | undefined;
    if (data?.type !== "incoming_call") return;

    const u = userRef.current;
    if (!u || u.role !== "caregiver") return;
    // DEFENSIVE — ignore a push routed to the wrong account (stale token).
    if (data.caregiverUid && data.caregiverUid !== u.id) return;

    const docId = data.signalDocId;
    if (!docId || !data.roomName || !data.recipientId) return;
    if (handledRef.current.has(docId)) return;
    handledRef.current.add(docId);

    logAudit({
      userId: u.id,
      action: "recipient_call_received",
      details: `Caregiver device woken by incoming-call push (room=${data.roomName}, from=${data.recipientName ?? "?"})`,
      targetUserId: data.recipientId,
    }).catch(() => {});

    setIncoming({
      docId,
      recipientId: data.recipientId,
      recipientName: data.recipientName ?? "Care recipient",
      roomName: data.roomName,
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!user || user.role !== "caregiver") return;

    const recvSub = Notifications.addNotificationReceivedListener(handlePush);
    const respSub = Notifications.addNotificationResponseReceivedListener((r) =>
      handlePush(r.notification),
    );

    // COLD START — app launched by tapping the push from a killed state.
    // The response listener does NOT fire for the launching notification, so
    // consult the last response once per process.
    if (!caregiverColdStartHandled) {
      caregiverColdStartHandled = true;
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response) handlePush(response.notification);
        })
        .catch(() => {});
    }

    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, [user?.id, user?.role, handlePush]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!user || user.role !== "caregiver") return;
    if (!isFirebaseConfigured || !db) return;

    const q = query(
      collection(db, "cameraActivations"),
      where("caregiverId", "==", user.id),
      where("initiatedBy", "==", "recipient"),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === "removed") return;
          const data = change.doc.data() as {
            status?: string;
            roomName?: string;
            recipientId?: string;
            recipientName?: string;
            callerName?: string;
            createdAt?: Timestamp;
          };
          // Drop the modal if the caregiver dismissed elsewhere or doc no
          // longer pending (answered/declined/cancelled).
          if (data.status !== "pending") {
            setIncoming((cur) => (cur?.docId === change.doc.id ? null : cur));
            return;
          }
          if (handledRef.current.has(change.doc.id)) return;

          // Skip docs whose ring window has already elapsed. We use the
          // doc's own age (vs. the recipient's 45s CALL_TIMEOUT_MS plus 15s
          // slack for clock skew / network), NOT app-session start —
          // otherwise a legitimate in-flight call started while the caregiver
          // was on another screen would be dropped on reopen and the
          // recipient would falsely see "No answer".
          const createdAtMs = data.createdAt?.toMillis?.() ?? 0;
          const STALE_AFTER_MS = 60_000;
          if (createdAtMs && Date.now() - createdAtMs > STALE_AFTER_MS) {
            handledRef.current.add(change.doc.id);
            return;
          }
          if (!data.roomName || !data.recipientId) return;

          handledRef.current.add(change.doc.id);
          // AUDIT — caregiver receipt via the Firestore path (push skipped or
          // app foregrounded). Deduped with the push path via handledRef, so
          // exactly one receipt row is written per incoming call.
          logAudit({
            userId: user.id,
            action: "recipient_call_received",
            details: `Caregiver device surfaced incoming call via Firestore signal (room=${data.roomName}, from=${data.recipientName ?? data.callerName ?? "?"})`,
            targetUserId: data.recipientId,
          }).catch(() => {});
          setIncoming({
            docId: change.doc.id,
            recipientId: data.recipientId,
            recipientName: data.recipientName ?? data.callerName ?? "Care recipient",
            roomName: data.roomName,
          });
        });
      },
      () => {
        // Silent failure — permissions errors etc. Caregiver simply won't see
        // the incoming call modal; the recipient will time out and surface
        // "Caregiver unavailable".
      },
    );

    return () => unsub();
  }, [user?.id, user?.role]);

  const handleAnswer = async (call: IncomingCall) => {
    if (!isFirebaseConfigured || !db) return;
    setIncoming(null);
    try {
      const { doc, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "cameraActivations", call.docId), {
        status: "answered",
        respondedAt: serverTimestamp(),
      });
    } catch {
      // Best-effort: still navigate the caregiver into the room even if the
      // status write failed — the recipient will time out and bail if needed.
    }
    if (user) {
      logAudit({
        userId: user.id,
        action: "recipient_call_answered",
        details: `Caregiver answered recipient-initiated call (room=${call.roomName}, from=${call.recipientName})`,
        targetUserId: call.recipientId,
      }).catch(() => {});
    }
    // Forward the cameraActivations docId so camera-stream's token request
    // can satisfy /api/video/token's tc-call binding check (server verifies
    // caller is the signaled caregiverId on this exact activation doc).
    navigateToCallSubscribe({ ...call, activationDocId: call.docId });
  };

  const handleDecline = async (call: IncomingCall) => {
    if (!isFirebaseConfigured || !db) return;
    setIncoming(null);
    try {
      const { doc, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "cameraActivations", call.docId), {
        status: "declined",
        respondedAt: serverTimestamp(),
      });
    } catch {
      // Best-effort.
    }
    if (user) {
      logAudit({
        userId: user.id,
        action: "recipient_call_declined",
        details: `Caregiver declined recipient-initiated call (room=${call.roomName}, from=${call.recipientName})`,
        targetUserId: call.recipientId,
      }).catch(() => {});
    }
  };

  return (
    <IncomingCallModal
      call={incoming}
      onAnswer={handleAnswer}
      onDecline={handleDecline}
    />
  );
}

function NavigationGuard() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((val) => {
      setOnboardingSeen(val === "true");
      setOnboardingChecked(true);
    });
  }, []);

  useEffect(() => {
    if (loading || !onboardingChecked) return;

    const currentScreen = segments[0] ?? "index";
    const onAuthScreen = AUTH_SCREENS.includes(currentScreen);
    const onIndexScreen = currentScreen === "index" || currentScreen === "(index)";

    if (!user) {
      if (!onboardingSeen && !onAuthScreen) {
        // First ever launch — show onboarding
        router.replace("/onboarding");
      } else if (onboardingSeen && !onAuthScreen) {
        // Returning user, not logged in — go to login
        router.replace("/login");
      }
    } else {
      // Signed in — leave auth screens and go to the correct dashboard.
      // Also enforce role-route consistency so a non-admin can't deep-link
      // into /(admin)/ and admins don't get stranded on caregiver screens.
      const onAdminGroup = currentScreen === "(admin)";
      const onCaregiverGroup = currentScreen === "(caregiver)";
      const onReceiverGroup = currentScreen === "(care-receiver)";

      if (onAuthScreen || onIndexScreen) {
        if (user.role === "admin") {
          router.replace("/(admin)/");
        } else if (user.role === "care-receiver") {
          router.replace("/(care-receiver)/");
        } else {
          router.replace("/(caregiver)/");
        }
      } else if (user.role !== "admin" && onAdminGroup) {
        // Block non-admins from the admin group
        if (user.role === "care-receiver") router.replace("/(care-receiver)/");
        else router.replace("/(caregiver)/");
      } else if (user.role === "admin" && (onCaregiverGroup || onReceiverGroup)) {
        // Keep admin in the admin group if their role was promoted mid-session
        router.replace("/(admin)/");
      }
    }
  }, [user, loading, segments, onboardingChecked, onboardingSeen]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <NavigationGuard />
      <NotificationInitializer />
      <CameraActivationListener />
      <CameraActivationFirestoreListener />
      <IncomingCallListener />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#060a18" },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="(care-receiver)" />
        <Stack.Screen name="(caregiver)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="emergency-call"
          options={{ presentation: "fullScreenModal", animation: "fade" }}
        />
        <Stack.Screen
          name="camera-stream"
          options={{ presentation: "fullScreenModal", animation: "fade" }}
        />
        <Stack.Screen
          name="caregiver-settings"
          options={{ animation: "slide_from_right" }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Web only: make the default scrollbar visible against the dark background
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const id = "terra-scrollbar-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      html, body, * { scrollbar-color: #22FF6Eaa #0c1628 !important; scrollbar-width: auto !important; }
      *::-webkit-scrollbar { width: 12px !important; height: 12px !important; display: block !important; }
      *::-webkit-scrollbar-track { background: #0c1628 !important; }
      *::-webkit-scrollbar-thumb {
        background: #22FF6Eaa !important;
        border-radius: 6px !important;
        border: 2px solid #0c1628 !important;
        min-height: 40px !important;
      }
      *::-webkit-scrollbar-thumb:hover { background: #22FF6E !important; }
      *::-webkit-scrollbar-corner { background: #0c1628 !important; }
    `;
    document.head.appendChild(style);
  }, []);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={splashStyles.container}>
        <Text style={splashStyles.name}>TERRA CALL</Text>
        <View style={splashStyles.line} />
        <Text style={splashStyles.tagline}>Emergency Caregiver Monitoring</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#060a18" }}>
            <KeyboardProvider>
              <AuthProvider>
                <CareDataProvider>
                  <RootLayoutNav />
                </CareDataProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
