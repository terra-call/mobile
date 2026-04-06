import { Feather } from "@expo/vector-icons";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
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

interface PermittedCaregiver {
  id: string;
  name: string;
  email: string;
}

export default function SettingsScreen() {
  const { user } = useAuth();
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

  // Caregivers
  const [caregivers, setCaregivers] = useState<PermittedCaregiver[]>([]);
  const [caregiversLoading, setCaregiversLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  // ── Load permitted caregivers ─────────────────────────────────────────────
  useEffect(() => {
    if (!user || !isFirebaseConfigured || !db) {
      setCaregiversLoading(false);
      return;
    }
    getDoc(doc(db, "users", user.id))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setCaregivers((data.permittedCaregivers as PermittedCaregiver[]) ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setCaregiversLoading(false));
  }, [user]);

  // ── Save profile (name + phone) ───────────────────────────────────────────
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

  // ── Reauthenticate then update credentials ────────────────────────────────
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
      // Reauthenticate first
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

  // ── Invite caregiver ──────────────────────────────────────────────────────
  const inviteCaregiver = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (!user || !isFirebaseConfigured || !db) return;

    if (caregivers.some((c) => c.email.toLowerCase() === email)) {
      Alert.alert("Already Added", "That caregiver already has access.");
      return;
    }

    setInviting(true);
    try {
      // Look up the caregiver by email
      const q = query(
        collection(db, "users"),
        where("email", "==", email),
        where("role", "==", "caregiver")
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        Alert.alert(
          "Not Found",
          "No caregiver account was found with that email. Make sure they have registered as a Caregiver."
        );
        return;
      }

      const cgDoc = snap.docs[0];
      const cgData = cgDoc.data();
      const newCaregiver: PermittedCaregiver = {
        id: cgDoc.id,
        name: cgData.name ?? "Caregiver",
        email: cgData.email ?? email,
      };

      await updateDoc(doc(db, "users", user.id), {
        permittedCaregivers: arrayUnion(newCaregiver),
      });

      setCaregivers((prev) => [...prev, newCaregiver]);
      setInviteEmail("");
      Alert.alert("Added", `${newCaregiver.name} can now monitor your check-ins.`);
    } catch {
      Alert.alert("Error", "Could not add caregiver. Please try again.");
    } finally {
      setInviting(false);
    }
  };

  // ── Remove caregiver ──────────────────────────────────────────────────────
  const removeCaregiver = (cg: PermittedCaregiver) => {
    Alert.alert(
      "Remove Caregiver",
      `Remove ${cg.name}? They will no longer be able to see your check-ins.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!user || !isFirebaseConfigured || !db) return;
            try {
              await updateDoc(doc(db, "users", user.id), {
                permittedCaregivers: arrayRemove(cg),
              });
              setCaregivers((prev) => prev.filter((c) => c.id !== cg.id));
            } catch {
              Alert.alert("Error", "Could not remove caregiver. Please try again.");
            }
          },
        },
      ]
    );
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
        <Section title="PROFILE" colors={colors}>
          <Field label="Full Name" colors={colors}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
            />
          </Field>

          <Field label="Phone Number" colors={colors}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 (555) 000-0000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
            />
          </Field>

          <SaveButton
            label="Save Profile"
            loading={profileSaving}
            onPress={saveProfile}
            color={colors.primary}
            textColor={colors.primaryForeground}
          />
        </Section>

        {/* ── Security Section ── */}
        <Section title="SECURITY" colors={colors}>
          <Field label="New Email Address" colors={colors}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder={user?.email}
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          <Field label="New Password" colors={colors}>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Leave blank to keep current"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showNewPass}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowNewPass((v) => !v)} style={styles.eyeBtn}>
                <Feather name={showNewPass ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </Field>

          <Field label="Current Password (required to change email or password)" colors={colors}>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="Confirm your current password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showCurrentPass}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowCurrentPass((v) => !v)} style={styles.eyeBtn}>
                <Feather name={showCurrentPass ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </Field>

          <SaveButton
            label="Update Credentials"
            loading={credSaving}
            onPress={saveCredentials}
            color="#00C8FF"
            textColor="#060a18"
          />
        </Section>

        {/* ── My Caregivers Section ── */}
        <Section title="MY CAREGIVERS" colors={colors}>
          <Text style={[styles.sectionNote, { color: colors.mutedForeground }]}>
            These people can see your check-in status and location.
          </Text>

          {caregiversLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
          ) : caregivers.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="users" size={22} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No caregivers added yet
              </Text>
            </View>
          ) : (
            caregivers.map((cg) => (
              <View key={cg.id} style={[styles.caregiverRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.caregiverAvatar, { backgroundColor: "#00C8FF18" }]}>
                  <Feather name="shield" size={18} color="#00C8FF" />
                </View>
                <View style={styles.caregiverInfo}>
                  <Text style={[styles.caregiverName, { color: colors.text }]}>{cg.name}</Text>
                  <Text style={[styles.caregiverEmail, { color: colors.mutedForeground }]}>{cg.email}</Text>
                </View>
                <Pressable
                  onPress={() => removeCaregiver(cg)}
                  hitSlop={10}
                  style={[styles.removeBtn, { borderColor: "#FF3B3044" }]}
                >
                  <Feather name="x" size={14} color="#FF3B30" />
                </Pressable>
              </View>
            ))
          )}

          {/* Invite input */}
          <View style={styles.inviteRow}>
            <TextInput
              style={[styles.input, styles.inviteInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="Caregiver's email address"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={inviteCaregiver}
            />
            <Pressable
              style={[styles.inviteBtn, { backgroundColor: inviting ? colors.muted : "#00C8FF22", borderColor: "#00C8FF55" }]}
              onPress={inviteCaregiver}
              disabled={inviting}
            >
              {inviting ? (
                <ActivityIndicator size="small" color="#00C8FF" />
              ) : (
                <Feather name="user-plus" size={18} color="#00C8FF" />
              )}
            </Pressable>
          </View>
          <Text style={[styles.inviteHint, { color: colors.mutedForeground }]}>
            The caregiver must already have a Terra Call account.
          </Text>
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────

function Section({
  title,
  colors,
  children,
}: {
  title: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function Field({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
    </View>
  );
}

function SaveButton({
  label,
  loading,
  onPress,
  color,
  textColor,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
  color: string;
  textColor: string;
}) {
  return (
    <Pressable
      style={[styles.saveBtn, { backgroundColor: loading ? "#334" : color }]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text style={[styles.saveBtnText, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
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
  sectionNote: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
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
    borderColor: "transparent",
    backgroundColor: "transparent",
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

  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },

  caregiverRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  caregiverAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  caregiverInfo: { flex: 1, gap: 3 },
  caregiverName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  caregiverEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  removeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  inviteRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  inviteInput: { flex: 1 },
  inviteBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  inviteHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
