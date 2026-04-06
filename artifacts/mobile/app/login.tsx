import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const { user, login } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // Navigate as soon as user state is populated (works for both direct login
  // and the async onAuthStateChanged path that fires after signInWithEmailAndPassword)
  React.useEffect(() => {
    if (user) {
      if (user.role === "care-receiver") {
        router.replace("/(care-receiver)/");
      } else {
        router.replace("/(caregiver)/");
      }
    }
  }, [user]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Error", "Please enter your email and password");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";

      if (code === "terra/profile-missing") {
        // Firebase Auth succeeded but profile is missing — route to recovery
        Alert.alert(
          "Profile Setup Required",
          "Your account was found but your profile wasn't saved. Tap 'Complete Setup' to finish creating your profile.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Complete Setup",
              onPress: () => router.push("/register?mode=recover"),
            },
          ]
        );
        return;
      }

      let message = "Could not sign in. Please try again.";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        message = "Incorrect email or password.";
      } else if (code === "auth/invalid-email") {
        message = "Please enter a valid email address.";
      } else if (code === "auth/network-request-failed") {
        message = "Network error — check your connection and try again.";
      } else if (code === "auth/too-many-requests") {
        message = "Too many attempts. Please wait a moment and try again.";
      } else if (code === "auth/user-disabled") {
        message = "This account has been disabled. Please contact support.";
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }
      Alert.alert("Login Failed", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.container,
          { paddingTop: topPadding + 32, paddingBottom: bottomPadding + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoSection}>
          <Image
            source={require("@/assets/images/terra_logo.jpg")}
            style={styles.logo}
            contentFit="contain"
          />
          <Text style={[styles.appName, { color: colors.text }]}>TERRA CALL</Text>
          <View style={[styles.accentLine, { backgroundColor: colors.primary }]} />
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Emergency Caregiver Monitoring
          </Text>
        </View>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Email Address</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
              ]}
              placeholder="your@email.com"
              placeholderTextColor={colors.mutedForeground}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>

          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
            <TextInput
              ref={passwordRef}
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
              ]}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
          </View>

          <Pressable
            style={[
              styles.signInButton,
              {
                backgroundColor: loading ? colors.muted : colors.primary,
                shadowColor: colors.primary,
              },
            ]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={[styles.signInText, { color: colors.primaryForeground }]}>
              {loading ? "Signing In..." : "Sign In"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Don't have an account?{" "}
          </Text>
          <Pressable onPress={() => router.push("/register")}>
            <Text style={[styles.registerLink, { color: colors.accent }]}>Register</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
    minHeight: "100%" as any,
  },
  logoSection: { alignItems: "center", gap: 10 },
  logo: { width: 130, height: 130, borderRadius: 65, marginBottom: 8 },
  appName: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 5,
    fontFamily: "Inter_700Bold",
  },
  accentLine: { width: 40, height: 2, borderRadius: 1 },
  subtitle: { fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase" },
  form: { gap: 18 },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 15 : 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  signInButton: {
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 8,
  },
  signInText: { fontSize: 17, fontWeight: "700", letterSpacing: 0.5, fontFamily: "Inter_700Bold" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  registerLink: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
