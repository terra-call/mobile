import { Feather } from "@expo/vector-icons";
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
  const { register } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("role");
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setStep("details");
  };

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password || !selectedRole) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await register({ email: email.trim(), password, name: name.trim(), role: selectedRole, phone: phone.trim() });
    } catch (err: unknown) {
      Alert.alert("Registration Failed", err instanceof Error ? err.message : "Could not create account");
    } finally {
      setLoading(false);
    }
  };

  const selectedOption = ROLE_OPTIONS.find((o) => o.role === selectedRole);

  if (step === "role") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPadding + 20 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.mutedForeground} />
        </Pressable>

        <Text style={[styles.stepTitle, { color: colors.text }]}>Who are you?</Text>
        <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
          Select your role to set up the right experience
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

        <Text style={[styles.stepTitle, { color: colors.text }]}>Create account</Text>
        <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
          Your information is kept private and secure
        </Text>

        <View style={styles.form}>
          {[
            { label: "Full Name *", value: name, setter: setName, placeholder: "Margaret Johnson", next: emailRef, keyboard: "default" as const, secure: false },
          ].map(({ label, value, setter, placeholder, next, keyboard, secure }) => (
            <View key={label}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                placeholder={placeholder}
                placeholderTextColor={colors.mutedForeground}
                value={value}
                onChangeText={setter}
                keyboardType={keyboard}
                returnKeyType="next"
                onSubmitEditing={() => (next as React.RefObject<TextInput>).current?.focus()}
                secureTextEntry={secure}
              />
            </View>
          ))}

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
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>

          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Password *</Text>
            <TextInput
              ref={passwordRef}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder="Minimum 6 characters"
              placeholderTextColor={colors.mutedForeground}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleRegister}
            />
          </View>

          <Pressable
            style={[
              styles.registerButton,
              { backgroundColor: loading ? colors.muted : colors.primary, shadowColor: colors.primary },
            ]}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={[styles.registerButtonText, { color: colors.primaryForeground }]}>
              {loading ? "Creating Account..." : "Create Account"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.loginLink}>
          <Text style={[styles.loginLinkText, { color: colors.mutedForeground }]}>Already have an account? </Text>
          <Pressable onPress={() => router.replace("/login")}>
            <Text style={[styles.loginLinkAction, { color: colors.accent }]}>Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  detailsScroll: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { marginBottom: 24, alignSelf: "flex-start" },
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
  loginLink: { flexDirection: "row", justifyContent: "center", marginTop: 24 },
  loginLinkText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  loginLinkAction: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
