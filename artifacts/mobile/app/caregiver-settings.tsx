import { Feather } from "@expo/vector-icons";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import {
  arrayRemove,
  collection,
  doc,
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
import { createInvite, sendInviteSms } from "@/services/invites";

interface LinkedReceiver {
  id: string;
  name: string;
  email: string;
  permittedCaregivers: Array<{ id: string; name: string; email: string }>;
}

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

  // Linked care receivers
  const [receivers, setReceivers] = useState<LinkedReceiver[]>([]);
  const [receiversLoading, setReceiversLoading] = useState(true);

  // Invite flow
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteSmsSending, setInviteSmsSending] = useState(false);

  const generateInviteCode = async () => {
    if (!user) return;
    setInviteGenerating(true);
    try {
      const result = await createInvite({
        id: user.id,
        name: user.name ?? "Caregiver",
        email: user.email,
      });
      setInviteCode(result.code);
      setInviteExpiresAt(result.expiresAt);
    } catch (err) {
      const msg = (err as Error)?.message ?? "Could not generate an invite code.";
      Alert.alert("Could Not Generate Code", msg);
    } finally {
      setInviteGenerating(false);
    }
  };

  const textInviteCode = async () => {
    if (!user || !inviteCode) return;
    const phone = invitePhone.trim();
    if (phone.length < 7) {
      Alert.alert("Phone Required", "Enter the care receiver's phone number to text them the code.");
      return;
    }
    setInviteSmsSending(true);
    try {
      const result = await sendInviteSms(phone, inviteCode, user.name ?? "Your caregiver");
      if (result.ok) {
        Alert.alert("Code Sent", `The invite code was texted to ${phone}.`);
        setInvitePhone("");
        return;
      }
      const messages = {
        "rate-limited": "You've sent too many invite texts in the last hour. Try again later or share the code manually.",
        invalid: "That phone number doesn't look right. Please check and try again.",
        "send-failed": "We couldn't deliver the SMS. Double-check the number or share the code manually.",
        network: "Couldn't reach the server. Check your connection and try again.",
      } as const;
      Alert.alert("Could Not Send", messages[result.reason]);
    } finally {
      setInviteSmsSending(false);
    }
  };

  // ── Load care receivers that have this caregiver in their permittedCaregivers ──
  useEffect(() => {
    if (!user || !isFirebaseConfigured || !db) {
      setReceiversLoading(false);
      return;
    }
    const q = query(collection(db, "users"), where("role", "==", "care-receiver"));
    getDocs(q)
      .then((snap) => {
        const linked: LinkedReceiver[] = [];
        snap.docs.forEach((d) => {
          const data = d.data();
          const permitted: Array<{ id: string; name: string; email: string }> =
            data.permittedCaregivers ?? [];
          if (permitted.some((cg) => cg.id === user.id)) {
            linked.push({
              id: d.id,
              name: data.name ?? "Care Receiver",
              email: data.email ?? "",
              permittedCaregivers: permitted,
            });
          }
        });
        setReceivers(linked);
      })
      .catch(() => {})
      .finally(() => setReceiversLoading(false));
  }, [user]);

  // ── Remove self from a care receiver's permitted list ─────────────────────
  const removeSelf = (receiver: LinkedReceiver) => {
    Alert.alert(
      "Stop Monitoring",
      `Remove yourself from monitoring ${receiver.name}? You will no longer see their check-ins.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!user || !isFirebaseConfigured || !db) return;
            const cgEntry = receiver.permittedCaregivers.find((cg) => cg.id === user.id);
            if (!cgEntry) return;
            try {
              await updateDoc(doc(db, "users", receiver.id), {
                permittedCaregivers: arrayRemove(cgEntry),
              });
              setReceivers((prev) => prev.filter((r) => r.id !== receiver.id));
            } catch {
              Alert.alert("Error", "Could not remove you. Please try again.");
            }
          },
        },
      ]
    );
  };

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
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") msg = "Incorrect current password.";
      else if (code === "auth/email-already-in-use") msg = "That email is already in use by another account.";
      else if (code === "auth/requires-recent-login") msg = "Please log out and log back in before changing credentials.";
      Alert.alert("Error", msg);
    } finally {
      setCredSaving(false);
    }
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      logout();
    } else {
      Alert.alert("Log Out", "Are you sure you want to log out?", [
        { text: "Cancel", style: "cancel" },
        { text: "Log Out", style: "destructive", onPress: logout },
      ]);
    }
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

        {/* ── Profile ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PROFILE</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
            <ActionButton label="Save Profile" loading={profileSaving} onPress={saveProfile} bg={colors.primary} fg={colors.primaryForeground} />
          </View>
        </View>

        {/* ── Security ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SECURITY</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
              <PasswordField value={newPassword} onChange={setNewPassword} show={showNewPass} onToggle={() => setShowNewPass(v => !v)} placeholder="Leave blank to keep current" colors={colors} />
            </View>
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Current Password (required to save changes)</Text>
              <PasswordField value={currentPassword} onChange={setCurrentPassword} show={showCurrentPass} onToggle={() => setShowCurrentPass(v => !v)} placeholder="Confirm your current password" colors={colors} />
            </View>
            <ActionButton label="Update Credentials" loading={credSaving} onPress={saveCredentials} bg="#00C8FF" fg="#060a18" />
          </View>
        </View>

        {/* ── Invite a Care Receiver ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INVITE A CARE RECEIVER</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionNote, { color: colors.mutedForeground }]}>
              Generate a 6-digit code, then share it with the person you want to monitor. They enter it in their app to link with you. The code expires in 24 hours.
            </Text>

            {inviteCode ? (
              <View style={[styles.codeBox, { backgroundColor: colors.background, borderColor: "#22FF6E55" }]}>
                <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>YOUR INVITE CODE</Text>
                <Text style={styles.codeText}>{inviteCode}</Text>
                {inviteExpiresAt && (
                  <Text style={[styles.codeExpiry, { color: colors.mutedForeground }]}>
                    Expires {new Date(inviteExpiresAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </Text>
                )}
              </View>
            ) : null}

            <ActionButton
              label={inviteCode ? "Generate Another Code" : "Generate Invite Code"}
              loading={inviteGenerating}
              onPress={generateInviteCode}
              bg="#22FF6E"
              fg="#060a18"
            />

            {inviteCode ? (
              <>
                <Text style={[styles.codeNote, { color: colors.mutedForeground }]}>
                  Any previously generated codes also remain valid until they expire.
                </Text>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>OR TEXT THE CODE TO THEM</Text>
                <View style={styles.field}>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                    value={invitePhone}
                    onChangeText={setInvitePhone}
                    placeholder="+1 (555) 000-0000"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="phone-pad"
                  />
                </View>
                <ActionButton
                  label="Text This Code"
                  loading={inviteSmsSending}
                  onPress={textInviteCode}
                  bg="#00C8FF"
                  fg="#060a18"
                />
              </>
            ) : null}
          </View>
        </View>

        {/* ── My Care Receivers ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MY CARE RECEIVERS</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionNote, { color: colors.mutedForeground }]}>
              These are the people whose check-ins you are monitoring.
            </Text>

            {receiversLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : receivers.length === 0 ? (
              <View style={[styles.emptyCard, { borderColor: colors.border }]}>
                <Feather name="user-x" size={22} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Not linked to any care receivers yet
                </Text>
              </View>
            ) : (
              receivers.map((r) => (
                <View key={r.id} style={[styles.receiverRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={[styles.receiverAvatar, { backgroundColor: "#00C8FF18" }]}>
                    <Feather name="user" size={18} color="#00C8FF" />
                  </View>
                  <View style={styles.receiverInfo}>
                    <Text style={[styles.receiverName, { color: colors.text }]}>{r.name}</Text>
                    <Text style={[styles.receiverEmail, { color: colors.mutedForeground }]}>{r.email}</Text>
                  </View>
                  <Pressable
                    onPress={() => removeSelf(r)}
                    hitSlop={10}
                    style={[styles.removeBtn, { borderColor: "#FF3B3044" }]}
                  >
                    <Feather name="x" size={14} color="#FF3B30" />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </View>

        {/* ── Account / Log Out ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACCOUNT</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
              <Text style={[styles.logoutText, { color: colors.destructive }]}>Log Out</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function PasswordField({
  value, onChange, show, onToggle, placeholder, colors,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={styles.passwordRow}>
      <TextInput
        style={[styles.input, styles.passwordInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry={!show}
        autoCapitalize="none"
      />
      <Pressable onPress={onToggle} style={[styles.eyeBtn, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Feather name={show ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function ActionButton({
  label, loading, onPress, bg, fg,
}: {
  label: string; loading: boolean; onPress: () => void; bg: string; fg: string;
}) {
  return (
    <Pressable style={[styles.saveBtn, { backgroundColor: loading ? "#1a2640" : bg }]} onPress={onPress} disabled={loading}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={[styles.saveBtnText, { color: fg }]}>{label}</Text>
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
  headerTitle: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.3 },

  section: { marginBottom: 28 },
  sectionLabel: {
    fontSize: 11, fontWeight: "700", letterSpacing: 1.4,
    fontFamily: "Inter_700Bold", marginBottom: 10, marginLeft: 4,
  },
  sectionNote: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 16 },

  field: { gap: 8 },
  fieldLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, fontFamily: "Inter_600SemiBold" },
  input: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 11,
    fontSize: 15, fontFamily: "Inter_400Regular",
  },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 11,
    borderTopRightRadius: 12, borderBottomRightRadius: 12,
    borderWidth: 1, borderLeftWidth: 0,
  },

  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  saveBtnText: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.3 },

  emptyCard: {
    borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
    padding: 24, alignItems: "center", gap: 10,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },

  receiverRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 12, borderWidth: 1, padding: 14, gap: 12,
  },
  receiverAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  receiverInfo: { flex: 1, gap: 3 },
  receiverName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  receiverEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  removeBtn: {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 1, alignItems: "center", justifyContent: "center",
  },

  accountRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  accountAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  accountName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  accountEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  roleBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  roleText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.5 },

  separator: { height: 1, marginHorizontal: -4 },
  divider: { height: 1, marginVertical: 4 },
  codeBox: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 6,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: "Inter_700Bold",
  },
  codeText: {
    color: "#22FF6E",
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: 8,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  codeExpiry: {
    fontSize: 12,
    marginTop: 4,
    fontFamily: "Inter_400Regular",
  },
  codeNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: -4,
  },
  logoutRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  logoutText: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
