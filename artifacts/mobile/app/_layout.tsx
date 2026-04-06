import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CareDataProvider } from "@/contexts/CareDataContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const AUTH_SCREENS = ["login", "register"];

function NavigationGuard() {
  const { user, loading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;

    const currentScreen = segments[0] ?? "index";
    const onAuthScreen = AUTH_SCREENS.includes(currentScreen);
    const onIndexScreen = currentScreen === "index" || currentScreen === "(index)";

    if (!user) {
      // Signed out — go to login unless already on an auth screen
      if (!onAuthScreen) {
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
  }, [user, loading, segments]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <NavigationGuard />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#060a18" },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
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

  if (!fontsLoaded && !fontError) return null;

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
