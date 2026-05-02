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
import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CareDataProvider } from "@/contexts/CareDataContext";
import { STORAGE_KEYS } from "@/constants/storage";
import { logAudit } from "@/services/audit";
import { registerForPushNotifications } from "@/services/notifications";

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

// Register for push notifications when a care receiver logs in
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
// Listens for camera_activate push notifications. When the care-receiver's
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

  useEffect(() => {
    if (Platform.OS === "web") return;

    const handle = (notification: Notifications.Notification) => {
      const data = notification.request?.content?.data as
        | { type?: string; roomName?: string; caregiverName?: string }
        | undefined;
      if (data?.type !== "camera_activate" || !data.roomName) return;

      // AUDIT — record receipt on the receiver's device. Use the userId
      // ref so a logout/login mid-call doesn't write to the wrong uid.
      const uid = userIdRef.current;
      if (uid) {
        logAudit({
          userId: uid,
          action: "camera_activation_received",
          details: `Care-receiver device received camera_activate push (room=${data.roomName}, from=${data.caregiverName ?? "?"})`,
        });
      }

      router.push({
        pathname: "/camera-stream",
        params: {
          mode: "publish",
          roomName: data.roomName,
          caregiverName: data.caregiverName ?? "Caregiver",
        },
      });
    };

    const recvSub = Notifications.addNotificationReceivedListener(handle);
    const respSub = Notifications.addNotificationResponseReceivedListener((response) =>
      handle(response.notification)
    );
    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, []);

  return null;
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
