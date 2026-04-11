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
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CareDataProvider } from "@/contexts/CareDataContext";
import { STORAGE_KEYS } from "@/constants/storage";
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
      // Signed in — leave auth screens and go to the correct dashboard
      if (onAuthScreen || onIndexScreen) {
        if (user.role === "care-receiver") {
          router.replace("/(care-receiver)/");
        } else {
          router.replace("/(caregiver)/");
        }
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
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="emergency-call"
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
