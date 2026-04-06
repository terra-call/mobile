import { Feather } from "@expo/vector-icons";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
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
import { auth, db, isFirebaseConfigured } from "@/services/firebase";

export default function CaregiverSettingsScreen() {
  const { user, logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Profile fields
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [profileSaving, setProfileSaving] = useState(false);

  // Credential fields
  const [newEmail, setNewEmail] = useState(user?.email ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [credSaving, setCredSaving] = useState(false);
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // ── Save profile ──────────────────────────────────────────────────────────
  const saveProfile = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Name cannot be empty.");
      return;
    }
    if (!user || !isFirebaseConfigured || !db) return;
    setProfileSaving(true);
    try {
      await updateDoc(doc(db, "users", user.id), {
        name: name.trim(),
        phone: phone.trim(),
      });
      Alert.alert("Saved", "Your profile has been updated.");
    } catch {
      Alert.alert("Error", "Could not save profile. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  };

  // ── Update credentials ────────────────────────────────────────────────────
  const saveCredentials = async () => {
    if (!user || !auth?.currentUser) return;

    const emailChanged = newEmail.trim() !== user.email;
    const passwordChanged = newPassword.length > 0;

    if (!emailChanged && !passwordChanged) {
      Alert.alert("No Changes", "Enter a new email or password to update.");
      return;
    }
    if (passwordChanged && newPassword.length < 6) {
      Alert.alert("Error", "New password must be at least 6 characters.");
      return;
    }
    if (!currentPassword) {
      Alert.alert("Required", "Enter your current password to make security changes.");
      return;
    }

    setCredSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);

      if (emailChanged && isFirebaseConfigured && db) {
        await updateEmail(auth.currentUser, newEmail.trim());
        await updateDoc(doc(db, "users", user.id), { email: newEmail.trim() });
      }
      if (passwordChanged) {
        await updatePassword(auth.currentUser, newPassword);
      }

      setCurrentPassword("");
      setNewPassword("");
      Alert.alert("Updated", "Your credentials have been updated.");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      let msg = "Could not update credentials.";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        msg = "Incorrect current password.";
      } else if (code === "auth/email-already-in-use") {
        msg = "That email is already in use by another account.";
      } else if (code === "auth/requires-recent-login") {
        msg = "Please log out and log back in before changing credentials.";
      }
      Alert.alert("Error", msg);
    } finally {
      setCredSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 8, paddingBottom: bottomPad + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.mutedForeground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
          <View style={{ width: 34 }} />
        </View>

        {/* ── Profile Section ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PROFILE</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Full Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.mutedForeground}
                autoCorrect={false}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Phone Number</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 (555) 000-0000"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
              />
            </View>

            <Pressable
              style={[styles.saveBtn, { backgroundColor: profileSaving ? colors.muted : colors.primary }]}
              onPress={saveProfile}
              disabled={profileSaving}
            >
              {profileSaving ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Profile</Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* ── Security Section ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SECURITY</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>New Email Address</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder={user?.email}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>New Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Leave blank to keep current"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showNewPass}
                  autoCapitalize="none"
                />
                <Pressable
                  onPress={() => setShowNewPass((v) => !v)}
                  style={[styles.eyeBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                >
                  <Feather name={showNewPass ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                Current Password (required to save changes)
              </Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Confirm your current password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showCurrentPass}
                  autoCapitalize="none"
                />
                <Pressable
                  onPress={() => setShowCurrentPass((v) => !v)}
                  style={[styles.eyeBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                >
                  <Feather name={showCurrentPass ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>

            <Pressable
              style={[styles.saveBtn, { backgroundColor: credSaving ? colors.muted : "#00C8FF" }]}
              onPress={saveCredentials}
              disabled={credSaving}
            >
              {credSaving ? (
                <ActivityIndicator size="small" color="#060a18" />
              ) : (
                <Text style={[styles.saveBtnText, { color: "#060a18" }]}>Update Credentials</Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* ── Account Section ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.accountRow}>
              <View style={[styles.accountAvatar, { backgroundColor: "#22FF6E18" }]}>
                <Feather name="shield" size={20} color="#22FF6E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.accountName, { color: colors.text }]}>{user?.name ?? "Caregiver"}</Text>
                <Text style={[styles.accountEmail, { color: colors.mutedForeground }]}>{user?.email ?? ""}</Text>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: "#22FF6E18", borderColor: "#22FF6E44" }]}>
                <Text style={[styles.roleText, { color: "#22FF6E" }]}>Caregiver</Text>
              </View>
            </View>

            <View style={[styles.separator, { backgroundColor: colors.border }]} />

            <Pressable style={styles.logoutRow} onPress={handleLogout}>
              <Feather name="log-out" size={18} color={colors.destructive} />
              <Text style={[styles.logoutText, { color: colors.destructive }]}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },

  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    fontFamily: "Inter_700Bold",
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },

  field: { gap: 8 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    fontFamily: "Inter_600SemiBold",
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 11,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 0,
  },

  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },

  accountRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  accountName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  accountEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  roleBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roleText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.5 },

  separator: { height: 1, marginHorizontal: -4 },

  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  logoutText: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
