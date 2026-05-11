import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
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
import type { UserRole } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type Step = "role" | "details";

interface RoleOption {
  role: UserRole;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  accentColor: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: "caregiver",
    title: "Caregiver",
    description: "I monitor someone and respond to alerts",
    icon: "shield",
    accentColor: "#00C8FF",
  },
  {
    role: "care-receiver",
    title: "Care Receiver",
    description: "I check in so my caregiver knows I'm safe",
    icon: "heart",
    accentColor: "#22FF6E",
  },
  {
    role: "family",
    title: "Family Member",
    description: "I receive secondary alerts only",
    icon: "users",
    accentColor: "#FFB347",
  },
];

export default function RegisterScreen() {
  const { register, recoverProfile, pendingRecovery, user } = useAuth();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isRecovery = mode === "recover";
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("role");
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  // If already logged in (recovery completed), navigate away
  React.useEffect(() => {
    if (user) {
      if (user.role === "care-receiver") {
        router.replace("/(care-receiver)/");
      } else {
        router.replace("/(caregiver)/");
      }
    }
  }, [user]);

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setStep("details");
  };

  const handleSubmit = async () => {
    if (!name.trim() || !selectedRole) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    if (!isRecovery && (!email.trim() || !password)) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    if (!isRecovery && password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    // A2P 10DLC — block submit if a phone number is provided but the user
    // has not explicitly checked the SMS consent box. This is the documented
    // opt-in CTA referenced in the Twilio A2P campaign description.
    if (phone.trim() && !smsConsent) {
      Alert.alert(
        "SMS Consent Required",
        "Please check the SMS consent box below to confirm you agree to receive emergency alert text messages, or remove your phone number to skip SMS.",
      );
      return;
    }

    setLoading(true);
    try {
      if (isRecovery) {
        await recoverProfile({ name: name.trim(), role: selectedRole, phone: phone.trim() });
      } else {
        await register({
          email: email.trim(),
          password,
          name: name.trim(),
          role: selectedRole,
          phone: phone.trim(),
          smsConsent,
        });
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      let message = isRecovery
        ? "Could not save your profile. Please try again."
        : "Could not create account. Please try again.";
      if (code === "auth/email-already-in-use") message = "That email is already registered. Try signing in instead.";
      else if (code === "auth/invalid-email") message = "Please enter a valid email address.";
      else if (code === "auth/weak-password") message = "Password must be at least 6 characters.";
      else if (code === "auth/network-request-failed") message = "Network error — check your connection and try again.";
      else if (code === "auth/too-many-requests") message = "Too many attempts. Please wait a moment and try again.";
      else if (err instanceof Error && err.message) message = err.message;
      Alert.alert(isRecovery ? "Setup Failed" : "Registration Failed", message);
    } finally {
      setLoading(false);
    }
  };

  const selectedOption = ROLE_OPTIONS.find((o) => o.role === selectedRole);

  if (step === "role") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPadding + 20 }]}>
        <Pressable
          onPress={() => (isRecovery ? router.replace("/login") : router.back())}
          style={styles.backBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.mutedForeground} />
        </Pressable>

        {isRecovery && pendingRecovery && (
          <View style={[styles.recoveryBanner, { backgroundColor: "#00C8FF18", borderColor: "#00C8FF44" }]}>
            <Feather name="info" size={15} color="#00C8FF" />
            <Text style={[styles.recoveryBannerText, { color: "#00C8FF" }]}>
              Completing setup for {pendingRecovery.email}
            </Text>
          </View>
        )}

        <Text style={[styles.stepTitle, { color: colors.text }]}>
          {isRecovery ? "Complete Your Profile" : "Who are you?"}
        </Text>
        <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
          {isRecovery
            ? "Select your role to finish setting up your account"
            : "Select your role to set up the right experience"}
        </Text>

        <View style={[styles.roleList, { paddingBottom: bottomPadding + 24 }]}>
          {ROLE_OPTIONS.map((option) => (
            <Pressable
              key={option.role}
              style={[
                styles.roleCard,
                { backgroundColor: colors.card, borderColor: option.accentColor + "44" },
              ]}
              onPress={() => handleRoleSelect(option.role)}
            >
              <View style={[styles.roleIcon, { backgroundColor: option.accentColor + "22" }]}>
                <Feather name={option.icon} size={28} color={option.accentColor} />
              </View>
              <View style={styles.roleText}>
                <Text style={[styles.roleTitle, { color: colors.text }]}>{option.title}</Text>
                <Text style={[styles.roleDesc, { color: colors.mutedForeground }]}>{option.description}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.border} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ backgroundColor: "#060a18" }}
        contentContainerStyle={[
          styles.detailsScroll,
          { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => setStep("role")} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.mutedForeground} />
        </Pressable>

        {selectedOption && (
          <View style={styles.roleBadge}>
            <View style={[styles.roleBadgeIcon, { backgroundColor: selectedOption.accentColor + "22" }]}>
              <Feather name={selectedOption.icon} size={18} color={selectedOption.accentColor} />
            </View>
            <Text style={[styles.roleBadgeText, { color: selectedOption.accentColor }]}>
              {selectedOption.title}
            </Text>
          </View>
        )}

        <Text style={[styles.stepTitle, { color: colors.text }]}>
          {isRecovery ? "Your Details" : "Create Account"}
        </Text>
        <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
          {isRecovery
            ? "Enter your name and we'll save your profile"
            : "Your information is kept private and secure"}
        </Text>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Full Name *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder="Margaret Johnson"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
              returnKeyType={isRecovery ? "next" : "next"}
              onSubmitEditing={() => phoneRef.current?.focus()}
            />
          </View>

          {/* Email/Password only for new accounts, not recovery */}
          {!isRecovery && (
            <>
              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Email Address *</Text>
                <TextInput
                  ref={emailRef}
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  placeholder="your@email.com"
                  placeholderTextColor={colors.mutedForeground}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                />
              </View>
            </>
          )}

          {/* Show account email as read-only in recovery mode */}
          {isRecovery && pendingRecovery && (
            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Account Email</Text>
              <View style={[styles.input, styles.readOnlyInput, { backgroundColor: colors.card + "80", borderColor: colors.border }]}>
                <Text style={[styles.readOnlyText, { color: colors.mutedForeground }]}>
                  {pendingRecovery.email}
                </Text>
              </View>
            </View>
          )}

          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Phone Number</Text>
            <TextInput
              ref={phoneRef}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder="+1 (555) 000-0000"
              placeholderTextColor={colors.mutedForeground}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              returnKeyType={isRecovery ? "done" : "next"}
              onSubmitEditing={isRecovery ? handleSubmit : () => passwordRef.current?.focus()}
            />
          </View>

          {!isRecovery && (
            <Pressable
              onPress={() => setSmsConsent((v) => !v)}
              style={[
                styles.consentRow,
                {
                  backgroundColor: colors.card,
                  borderColor: smsConsent ? colors.primary : colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.consentBox,
                  {
                    backgroundColor: smsConsent ? colors.primary : "transparent",
                    borderColor: smsConsent ? colors.primary : colors.border,
                  },
                ]}
              >
                {smsConsent && (
                  <Feather name="check" size={14} color={colors.primaryForeground} />
                )}
              </View>
              <Text style={[styles.consentText, { color: colors.text }]}>
                I agree to receive SMS alerts from Terra Call for missed check-ins and
                emergencies. Msg frequency varies. Msg &amp; data rates may apply. Reply
                STOP to cancel, HELP for help. See our{" "}
                <Text style={{ color: colors.accent }}>Privacy Policy</Text> and{" "}
                <Text style={{ color: colors.accent }}>Terms</Text>.
              </Text>
            </Pressable>
          )}

          {!isRecovery && (
            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Password *</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, styles.passwordInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  placeholder="Minimum 6 characters"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  style={[styles.eyeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>
          )}

          <Pressable
            style={[
              styles.registerButton,
              { backgroundColor: loading ? colors.muted : colors.primary, shadowColor: colors.primary },
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={[styles.registerButtonText, { color: colors.primaryForeground }]}>
              {loading
                ? isRecovery ? "Saving Profile..." : "Creating Account..."
                : isRecovery ? "Save Profile" : "Create Account"}
            </Text>
          </Pressable>
        </View>

        {!isRecovery && (
          <View style={styles.loginLink}>
            <Text style={[styles.loginLinkText, { color: colors.mutedForeground }]}>Already have an account? </Text>
            <Pressable onPress={() => router.replace("/login")}>
              <Text style={[styles.loginLinkAction, { color: colors.accent }]}>Sign In</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  detailsScroll: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { marginBottom: 24, alignSelf: "flex-start" },
  recoveryBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
  },
  recoveryBannerText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  stepTitle: { fontSize: 28, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 8 },
  stepSubtitle: { fontSize: 14, lineHeight: 22, marginBottom: 32, fontFamily: "Inter_400Regular" },
  roleList: { gap: 14, flex: 1, justifyContent: "center" },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
  },
  roleIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  roleText: { flex: 1, gap: 4 },
  roleTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  roleDesc: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" },
  roleBadge: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  roleBadgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  roleBadgeText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  form: { gap: 16 },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 15 : 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  readOnlyInput: {
    justifyContent: "center",
  },
  readOnlyText: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  registerButton: {
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 8,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 8,
  },
  registerButtonText: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  eyeButton: {
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 14,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  consentBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  consentText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  loginLink: { flexDirection: "row", justifyContent: "center", marginTop: 24 },
  loginLinkText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  loginLinkAction: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
