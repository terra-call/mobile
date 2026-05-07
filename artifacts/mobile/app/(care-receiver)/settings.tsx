import { Feather } from "@expo/vector-icons";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import {
  arrayRemove,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { auth, db, isFirebaseConfigured } from "@/services/firebase";
import { logAudit } from "@/services/audit";
import { redeemInvite } from "@/services/invites";
import {
  type ScheduleType,
  scheduleCheckInReminders,
  cancelAllReminders,
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
  getCaregiverPhones,
  callNotifyApi,
  getNotificationPermissionStatus,
  requestNotificationPermissions,
  registerForPushNotifications,
  type NotifPermStatus,
} from "@/services/notifications";

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
  const bottomPad = Platform.OS === "web" ? 60 : insets.bottom + 24;

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
  const [inviteCode, setInviteCode] = useState("");
  const [inviting, setInviting] = useState(false);

  // Push notification permission
  const [pushPermStatus, setPushPermStatus] = useState<NotifPermStatus>("undetermined");
  const [pushRequesting, setPushRequesting] = useState(false);

  // SMS consent (HIPAA — caregiver SMS alerts include receiver's name)
  const [smsConsent, setSmsConsent] = useState(false);

  // Notification settings
  const [notifEnabled, setNotifEnabled] = useState(DEFAULT_NOTIFICATION_SETTINGS.enabled);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(DEFAULT_NOTIFICATION_SETTINGS.schedule.type);
  const [customHour, setCustomHour] = useState(DEFAULT_NOTIFICATION_SETTINGS.schedule.customHour);
  const [customMinute, setCustomMinute] = useState(DEFAULT_NOTIFICATION_SETTINGS.schedule.customMinute);
  const [missedWindow, setMissedWindow] = useState(String(DEFAULT_NOTIFICATION_SETTINGS.missedWindowMin));
  const [escalationWindow, setEscalationWindow] = useState(String(DEFAULT_NOTIFICATION_SETTINGS.escalationWindowMin));
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifLoading, setNotifLoading] = useState(true);

  // ── Check push notification permission on mount ────────────────────────────
  useEffect(() => {
    getNotificationPermissionStatus().then(setPushPermStatus);
  }, []);

  const handleEnablePush = async () => {
    if (pushPermStatus === "denied") {
      Alert.alert(
        "Notifications Blocked",
        "Push notifications were previously denied. Please open your device Settings, find Terra Call, and enable Notifications.",
        [
          { text: "OK" },
          {
            text: "Open Settings",
            onPress: () => {
              Linking.openSettings().catch(() => {});
            },
          },
        ]
      );
      return;
    }
    setPushRequesting(true);
    try {
      const granted = await requestNotificationPermissions();
      const newStatus = await getNotificationPermissionStatus();
      setPushPermStatus(newStatus);
      if (granted && user?.id) {
        await registerForPushNotifications(user.id);
        Alert.alert("Enabled", "Push notifications are now active. Your caregiver can reach your device for emergency alerts.");
      }
    } finally {
      setPushRequesting(false);
    }
  };

  // ── Load permitted caregivers + notification settings ─────────────────────
  useEffect(() => {
    if (!user || !isFirebaseConfigured || !db) {
      setCaregiversLoading(false);
      setNotifLoading(false);
      return;
    }
    getDoc(doc(db, "users", user.id))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setCaregivers((data.permittedCaregivers as PermittedCaregiver[]) ?? []);

          // Load notification settings if they exist
          if (data.notificationsEnabled !== undefined) {
            setNotifEnabled(data.notificationsEnabled as boolean);
          }
          if (data.checkInScheduleType) {
            setScheduleType(data.checkInScheduleType as ScheduleType);
          }
          if (data.checkInCustomHour !== undefined) {
            setCustomHour(data.checkInCustomHour as number);
          }
          if (data.checkInCustomMinute !== undefined) {
            setCustomMinute(data.checkInCustomMinute as number);
          }
          if (data.missedWindowMin !== undefined) {
            setMissedWindow(String(data.missedWindowMin));
          }
          if (data.escalationWindowMin !== undefined) {
            setEscalationWindow(String(data.escalationWindowMin));
          }
          if (data.smsConsent !== undefined) {
            setSmsConsent(data.smsConsent as boolean);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setCaregiversLoading(false);
        setNotifLoading(false);
      });
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
      // HIPAA audit
      logAudit({
        userId: user.id,
        action: "profile_updated",
        details: "Care receiver updated name/phone",
      }).catch(() => {});
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

  // ── Redeem caregiver invite code ─────────────────────────────────────────
  const inviteCaregiver = async () => {
    const code = inviteCode.replace(/\D/g, "");
    if (!code) return;
    if (!user) return;

    if (code.length !== 6) {
      Alert.alert("Invalid Code", "Please enter the 6-digit code from your caregiver.");
      return;
    }

    setInviting(true);
    try {
      const result = await redeemInvite(code, {
        id: user.id,
        permittedCaregivers: caregivers,
      });

      if (result.ok) {
        setCaregivers((prev) => [...prev, result.caregiver]);
        setInviteCode("");
        Alert.alert("Linked", `${result.caregiver.name} can now monitor your check-ins.`);
        return;
      }

      const messages: Record<typeof result.reason, string> = {
        "not-found": "We couldn't find that code. Double-check the digits with your caregiver.",
        expired: "That code has expired. Ask your caregiver to generate a new one.",
        redeemed: "That code has already been used. Ask your caregiver for a new one.",
        self: "You can't use your own invite code.",
        duplicate: "That caregiver already has access.",
        error: "Could not link caregiver. Please try again.",
      };
      Alert.alert("Cannot Link", messages[result.reason]);
    } finally {
      setInviting(false);
    }
  };

  // ── Save notification settings ────────────────────────────────────────────
  const saveNotificationSettings = async () => {
    if (!user || !isFirebaseConfigured || !db) return;

    const missedNum = parseInt(missedWindow, 10);
    const escalationNum = parseInt(escalationWindow, 10);

    if (isNaN(missedNum) || missedNum < 1 || missedNum > 480) {
      Alert.alert("Invalid Value", "Missed check-in window must be between 1 and 480 minutes.");
      return;
    }
    if (isNaN(escalationNum) || escalationNum <= missedNum) {
      Alert.alert("Invalid Value", "Escalation window must be greater than the missed check-in window.");
      return;
    }

    if (scheduleType === "custom") {
      if (customHour < 0 || customHour > 23 || customMinute < 0 || customMinute > 59) {
        Alert.alert("Invalid Time", "Enter a valid hour (0–23) and minute (0–59).");
        return;
      }
    }

    setNotifSaving(true);
    try {
      await updateDoc(doc(db, "users", user.id), {
        notificationsEnabled: notifEnabled,
        checkInScheduleType: scheduleType,
        checkInCustomHour: customHour,
        checkInCustomMinute: customMinute,
        missedWindowMin: missedNum,
        escalationWindowMin: escalationNum,
        smsConsent,
      });

      const settings: NotificationSettings = {
        enabled: notifEnabled,
        schedule: { type: scheduleType, customHour, customMinute },
        missedWindowMin: missedNum,
        escalationWindowMin: escalationNum,
      };

      if (notifEnabled) {
        await scheduleCheckInReminders(settings);
      } else {
        await cancelAllReminders();
      }

      // Register schedule with API server so it can send SMS backup alerts
      if (notifEnabled && caregivers.length > 0) {
        try {
          const cgPhones = await getCaregiverPhones(caregivers);
          await callNotifyApi("/notify/schedule", {
            userId: user.id,
            receiverName: user.name ?? "Care Receiver",
            scheduleType: scheduleType,
            customHour,
            customMinute,
            missedWindowMin: missedNum,
            escalationWindowMin: escalationNum,
            caregiverPhones: cgPhones,
          });
        } catch {
          // Non-blocking — SMS backup registration failed but local reminders are set
        }
      }

      Alert.alert(
        "Saved",
        notifEnabled
          ? "Check-in reminders have been scheduled. SMS backup alerts are active."
          : "Notification settings saved. Reminders are disabled."
      );
    } catch {
      Alert.alert("Error", "Could not save notification settings.");
    } finally {
      setNotifSaving(false);
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
      style={[
        styles.root,
        { backgroundColor: colors.background },
        Platform.OS === "web" ? ({ height: "100dvh" } as object) : null,
      ]}
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

        {/* ── Notifications Section ── */}
        <Section title="NOTIFICATIONS" colors={colors}>
          {/* Push notification permission — always visible */}
          <View style={[styles.notifToggleRow, { backgroundColor: pushPermStatus === "granted" ? colors.card : "#1a0a0a", borderColor: pushPermStatus === "granted" ? colors.border : "#FF3B3044" }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.notifToggleLabel, { color: colors.text }]}>
                Push Notifications
              </Text>
              <Text style={[styles.notifToggleSub, { color: pushPermStatus === "granted" ? colors.primary : "#FF6B6B" }]}>
                {pushPermStatus === "granted"
                  ? "Enabled — your caregiver can reach this device"
                  : pushPermStatus === "denied"
                    ? "Blocked — tap to open Settings"
                    : "Not enabled — required for emergency camera alerts"}
              </Text>
            </View>
            {pushPermStatus === "granted" ? (
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + "22", alignItems: "center", justifyContent: "center" }}>
                <Feather name="check" size={20} color={colors.primary} />
              </View>
            ) : (
              <Pressable
                onPress={handleEnablePush}
                disabled={pushRequesting}
                style={{ backgroundColor: "#FF3B30", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, opacity: pushRequesting ? 0.6 : 1 }}
              >
                {pushRequesting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" }}>
                    {pushPermStatus === "denied" ? "Settings" : "Enable"}
                  </Text>
                )}
              </Pressable>
            )}
          </View>

          {notifLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
          ) : (
            <>
              {/* Enable toggle */}
              <View style={[styles.notifToggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.notifToggleLabel, { color: colors.text }]}>Enable check-in reminders</Text>
                  <Text style={[styles.notifToggleSub, { color: colors.mutedForeground }]}>
                    Get reminded to tap I'M OK on a schedule
                  </Text>
                </View>
                <Switch
                  value={notifEnabled}
                  onValueChange={setNotifEnabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#ffffff"
                />
              </View>

              {/* SMS consent toggle (HIPAA) */}
              <View style={[styles.notifToggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.notifToggleLabel, { color: colors.text }]}>SMS backup alerts</Text>
                  <Text style={[styles.notifToggleSub, { color: colors.mutedForeground }]}>
                    Allow caregivers to receive text messages with your name when you miss a check-in or trigger an emergency. SMS travels through your cell carrier and is not end-to-end encrypted.
                  </Text>
                </View>
                <Switch
                  value={smsConsent}
                  onValueChange={setSmsConsent}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#ffffff"
                />
              </View>

              {/* Frequency chips */}
              <Field label="Check-in frequency" colors={colors}>
                <View style={styles.chipRow}>
                  {(["4h", "8h", "12h", "24h", "custom"] as ScheduleType[]).map((opt) => {
                    const active = scheduleType === opt;
                    const label = opt === "custom" ? "Custom time" : `Every ${opt}`;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => setScheduleType(opt)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: active ? colors.primary : colors.card,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              {/* Custom time picker (12-hour with AM/PM) */}
              {scheduleType === "custom" && (
                <Field label="Daily reminder time" colors={colors}>
                  <TimePicker12h
                    hour24={customHour}
                    minute={customMinute}
                    onChange={(h, m) => {
                      setCustomHour(h);
                      setCustomMinute(m);
                    }}
                    colors={colors}
                  />
                </Field>
              )}

              {/* Alert windows */}
              <Field label="Missed check-in alert after (minutes)" colors={colors}>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  value={missedWindow}
                  onChangeText={setMissedWindow}
                  keyboardType="number-pad"
                  placeholder="15"
                  placeholderTextColor={colors.mutedForeground}
                />
              </Field>

              <Field label="Emergency escalation after (minutes)" colors={colors}>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  value={escalationWindow}
                  onChangeText={setEscalationWindow}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor={colors.mutedForeground}
                />
              </Field>

              <Text style={[styles.inviteHint, { color: colors.mutedForeground }]}>
                If you miss a check-in, your caregivers will be alerted after the missed window. The emergency escalation window triggers a higher-priority alert.
              </Text>

              <SaveButton
                label="Save Notification Settings"
                loading={notifSaving}
                onPress={saveNotificationSettings}
                color={colors.primary}
                textColor={colors.primaryForeground}
              />
            </>
          )}
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

          {/* Invite code input */}
          <View style={styles.inviteRow}>
            <TextInput
              style={[styles.input, styles.inviteInput, styles.inviteCodeInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={inviteCode}
              onChangeText={(t) => setInviteCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              maxLength={6}
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
            Ask your caregiver to generate an invite code in their app and share it with you.
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

function TimePicker12h({
  hour24,
  minute,
  onChange,
  colors,
}: {
  hour24: number;
  minute: number;
  onChange: (hour24: number, minute: number) => void;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  // Convert 24h → 12h display
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = ((hour24 + 11) % 12) + 1; // 0→12, 13→1, etc.

  const setFrom12h = (h12: number, m: number, p: "AM" | "PM") => {
    let h24 = h12 % 12; // 12 → 0
    if (p === "PM") h24 += 12;
    onChange(h24, m);
  };

  const stepHour = (delta: number) => {
    const next = ((hour12 - 1 + delta + 12) % 12) + 1;
    setFrom12h(next, minute, period);
  };

  const stepMinute = (delta: number) => {
    // step by 5 minutes, wrap 0..55
    const next = ((minute + delta * 5) % 60 + 60) % 60;
    setFrom12h(hour12, next, period);
  };

  const setPeriod = (p: "AM" | "PM") => {
    if (p === period) return;
    setFrom12h(hour12, minute, p);
  };

  return (
    <View style={styles.timePickerRow}>
      {/* Hour */}
      <View style={[styles.timeUnit, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Pressable
          onPress={() => stepHour(1)}
          hitSlop={8}
          style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.5 }]}
        >
          <Feather name="chevron-up" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.timeValue, { color: colors.text }]}>{String(hour12).padStart(2, "0")}</Text>
        <Pressable
          onPress={() => stepHour(-1)}
          hitSlop={8}
          style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.5 }]}
        >
          <Feather name="chevron-down" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.timeUnitLabel, { color: colors.mutedForeground }]}>HOUR</Text>
      </View>

      <Text style={[styles.timeBigSep, { color: colors.text }]}>:</Text>

      {/* Minute */}
      <View style={[styles.timeUnit, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Pressable
          onPress={() => stepMinute(1)}
          hitSlop={8}
          style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.5 }]}
        >
          <Feather name="chevron-up" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.timeValue, { color: colors.text }]}>{String(minute).padStart(2, "0")}</Text>
        <Pressable
          onPress={() => stepMinute(-1)}
          hitSlop={8}
          style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.5 }]}
        >
          <Feather name="chevron-down" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.timeUnitLabel, { color: colors.mutedForeground }]}>MIN</Text>
      </View>

      {/* AM/PM toggle */}
      <View style={[styles.periodCol, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Pressable
          onPress={() => setPeriod("AM")}
          style={[
            styles.periodBtn,
            period === "AM" && { backgroundColor: colors.primary },
          ]}
        >
          <Text
            style={[
              styles.periodText,
              { color: period === "AM" ? colors.primaryForeground : colors.mutedForeground },
            ]}
          >
            AM
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPeriod("PM")}
          style={[
            styles.periodBtn,
            period === "PM" && { backgroundColor: colors.primary },
          ]}
        >
          <Text
            style={[
              styles.periodText,
              { color: period === "PM" ? colors.primaryForeground : colors.mutedForeground },
            ]}
          >
            PM
          </Text>
        </Pressable>
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

  notifToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    marginBottom: 2,
  },
  notifToggleLabel: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  notifToggleSub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  timeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeInput: { width: 64, textAlign: "center" },
  timeSep: { fontSize: 22, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  timePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 4,
  },
  timeUnit: {
    width: 78,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    gap: 4,
  },
  stepBtn: {
    width: 40,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  timeValue: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    minWidth: 48,
    textAlign: "center",
  },
  timeUnitLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  timeBigSep: {
    fontSize: 30,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginTop: -8,
  },
  periodCol: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginLeft: 4,
  },
  periodBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 56,
  },
  periodText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.0,
    fontFamily: "Inter_700Bold",
  },

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
  inviteCodeInput: {
    fontSize: 22,
    letterSpacing: 6,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    textAlign: "center",
  },
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
