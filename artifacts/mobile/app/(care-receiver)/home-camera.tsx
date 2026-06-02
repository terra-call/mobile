import { Feather } from "@expo/vector-icons";
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
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { CameraConsentModal } from "@/components/CameraConsentModal";
import { getCameraConsent, type CameraConsent } from "@/services/video";
import { logAudit } from "@/services/audit";
import {
  clearReolinkConfig,
  getReolinkStatus,
  saveReolinkConfig,
  testReolinkConnection,
  type ReolinkStatus,
} from "@/services/reolink";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; enc: string }
  | { kind: "error"; message: string };

export default function HomeCameraScreen() {
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 60 : insets.bottom + 24;

  const [consent, setConsent] = useState<CameraConsent | "loading">("loading");
  const [showConsent, setShowConsent] = useState(false);

  const [status, setStatus] = useState<ReolinkStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("443");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // ── Load consent + existing config ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getCameraConsent(user.id)
      .then(setConsent)
      .catch(() => setConsent("unset"));
    getReolinkStatus(user.id)
      .then((s) => {
        setStatus(s);
        if (s) {
          setHost(s.host);
          setPort(String(s.port));
          setUsername(s.username);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingStatus(false));
  }, [user]);

  // Any field change invalidates a prior successful test (creds must match enc).
  const invalidateTest = () => {
    if (test.kind !== "idle") setTest({ kind: "idle" });
  };

  function sanitizeHost(raw: string): string {
    return raw
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
  }

  const handleTest = async () => {
    const cleanHost = sanitizeHost(host);
    if (!cleanHost || /\s/.test(cleanHost) || cleanHost.includes("/")) {
      setTest({ kind: "error", message: "Enter a valid camera web address (no spaces or slashes)." });
      return;
    }
    const portNum = port.trim() === "" ? 443 : parseInt(port, 10);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setTest({ kind: "error", message: "Port must be a number between 1 and 65535." });
      return;
    }
    if (!username.trim()) {
      setTest({ kind: "error", message: "Enter the camera username (usually \"admin\")." });
      return;
    }
    if (!password) {
      setTest({ kind: "error", message: "Enter the camera password." });
      return;
    }

    setHost(cleanHost);
    setTest({ kind: "testing" });
    const result = await testReolinkConnection({
      host: cleanHost,
      port: portNum,
      username: username.trim(),
      password,
    });
    if (result.ok) {
      setTest({ kind: "success", enc: result.enc });
    } else {
      setTest({ kind: "error", message: result.error });
    }
  };

  const handleSave = async () => {
    if (test.kind !== "success" || !user) return;
    setSaving(true);
    try {
      const portNum = port.trim() === "" ? 443 : parseInt(port, 10);
      const ok = await saveReolinkConfig(user.id, {
        host: sanitizeHost(host),
        port: portNum,
        username: username.trim(),
        enc: test.enc,
      });
      if (!ok) {
        Alert.alert("Error", "Could not save the camera. Please try again.");
        return;
      }
      logAudit({
        userId: user.id,
        action: "reolink_camera_configured",
        details: "Care recipient connected a Reolink home camera",
      }).catch(() => {});
      setStatus({
        host: sanitizeHost(host),
        port: portNum,
        username: username.trim(),
        connected: true,
        cloudEnabled: true,
        lastConnected: Date.now(),
        configured: true,
      });
      setPassword("");
      setTest({ kind: "idle" });
      Alert.alert(
        "Home Camera Connected",
        "Your caregiver can now view this camera as a backup feed.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = () => {
    if (!user) return;
    Alert.alert(
      "Remove Home Camera",
      "Your caregiver will no longer be able to view this camera. You can reconnect it any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const ok = await clearReolinkConfig(user.id);
            if (!ok) {
              Alert.alert("Error", "Could not remove the camera. Please try again.");
              return;
            }
            logAudit({
              userId: user.id,
              action: "reolink_camera_removed",
              details: "Care recipient removed their Reolink home camera",
            }).catch(() => {});
            setStatus(null);
            setHost("");
            setPort("443");
            setUsername("admin");
            setPassword("");
            setTest({ kind: "idle" });
          },
        },
      ],
    );
  };

  // ── Header (shared) ─────────────────────────────────────────────────────────
  const Header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
        <Feather name="arrow-left" size={22} color={colors.mutedForeground} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Home Camera</Text>
      <View style={{ width: 34 }} />
    </View>
  );

  // ── Consent gate ────────────────────────────────────────────────────────────
  if (consent === "loading" || loadingStatus) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (consent !== "granted") {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: topPad + 8 }]}>
        {Header}
        <View style={[styles.center, { flex: 1, paddingHorizontal: 24, gap: 16 }]}>
          <View style={[styles.iconCircle, { backgroundColor: "#51aafa22" }]}>
            <Feather name="video" size={32} color="#51aafa" />
          </View>
          <Text style={[styles.gateTitle, { color: colors.text }]}>Camera consent required</Text>
          <Text style={[styles.gateBody, { color: colors.mutedForeground }]}>
            Before connecting a home camera, you need to agree to let your caregiver view
            your camera. You stay in control and can change this any time.
          </Text>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowConsent(true)}
          >
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
              Review Camera Consent
            </Text>
          </Pressable>
        </View>
        {user && (
          <CameraConsentModal
            visible={showConsent}
            userId={user.id}
            onAnswered={(granted) => {
              setShowConsent(false);
              setConsent(granted ? "granted" : "denied");
            }}
          />
        )}
      </View>
    );
  }

  const canSave = test.kind === "success";

  // ── Main setup form ──────────────────────────────────────────────────────────
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
        contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: bottomPad + 40, paddingHorizontal: 20 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {Header}

        {/* Status pill */}
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: status?.connected ? colors.primary + "1A" : colors.card,
              borderColor: status?.connected ? colors.primary + "55" : colors.border,
            },
          ]}
        >
          <Feather
            name={status?.connected ? "check-circle" : "alert-circle"}
            size={18}
            color={status?.connected ? colors.primary : colors.mutedForeground}
          />
          <Text
            style={[
              styles.statusText,
              { color: status?.connected ? colors.primary : colors.mutedForeground },
            ]}
          >
            {status?.connected ? "Connected" : "Not connected"}
          </Text>
        </View>

        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Connect a Reolink camera so your caregiver can check in on your home as a backup
          to your phone camera. Enter the details from your Reolink app below.
        </Text>

        {/* Form */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Camera Web Address (Reolink DDNS)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            value={host}
            onChangeText={(v) => {
              setHost(v);
              invalidateTest();
            }}
            placeholder="e.g. abc123.reolink.com"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Port</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            value={port}
            onChangeText={(v) => {
              setPort(v.replace(/[^0-9]/g, ""));
              invalidateTest();
            }}
            placeholder="443"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Camera Username</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            value={username}
            onChangeText={(v) => {
              setUsername(v);
              invalidateTest();
            }}
            placeholder="admin"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Camera Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                invalidateTest();
              }}
              placeholder={status ? "Re-enter to update" : "Camera password"}
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {/* Help */}
        <Pressable style={styles.helpToggle} onPress={() => setShowHelp((v) => !v)}>
          <Feather name="help-circle" size={16} color="#51aafa" />
          <Text style={[styles.helpToggleText, { color: "#51aafa" }]}>
            Where do I find these details?
          </Text>
          <Feather name={showHelp ? "chevron-up" : "chevron-down"} size={16} color="#51aafa" />
        </Pressable>
        {showHelp && (
          <View style={[styles.helpBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
              1. Open the Reolink app and select your camera.{"\n"}
              2. Go to Settings → Network → Advanced and turn on UID/DDNS.{"\n"}
              3. Copy the DDNS web address (it ends in .reolink.com) into Camera Web Address.{"\n"}
              4. Make sure port forwarding is enabled for the HTTPS port (usually 443).{"\n"}
              5. Use the same username and password you use to log in to the camera.
            </Text>
            <Pressable
              onPress={() => Linking.openURL("https://support.reolink.com/hc/en-us/articles/360007011833").catch(() => {})}
            >
              <Text style={[styles.helpLink, { color: "#51aafa" }]}>Open Reolink setup guide →</Text>
            </Pressable>
          </View>
        )}

        {/* Test result */}
        {test.kind === "error" && (
          <View style={[styles.resultBox, { backgroundColor: "#3a0d0d", borderColor: "#FF3B3055" }]}>
            <Feather name="x-circle" size={18} color="#FF6B6B" />
            <Text style={[styles.resultText, { color: "#FF9B9B" }]}>{test.message}</Text>
          </View>
        )}
        {test.kind === "success" && (
          <View style={[styles.resultBox, { backgroundColor: colors.primary + "1A", borderColor: colors.primary + "55" }]}>
            <Feather name="check-circle" size={18} color={colors.primary} />
            <Text style={[styles.resultText, { color: colors.primary }]}>
              Connection successful! Tap Save to finish.
            </Text>
          </View>
        )}

        {/* Test button */}
        <Pressable
          style={[styles.secondaryBtn, { borderColor: "#51aafa", opacity: test.kind === "testing" ? 0.6 : 1 }]}
          onPress={handleTest}
          disabled={test.kind === "testing"}
        >
          {test.kind === "testing" ? (
            <ActivityIndicator size="small" color="#51aafa" />
          ) : (
            <Text style={[styles.secondaryBtnText, { color: "#51aafa" }]}>Test Connection</Text>
          )}
        </Pressable>

        {/* Save button */}
        <Pressable
          style={[
            styles.primaryBtn,
            { backgroundColor: canSave ? colors.primary : colors.border, opacity: saving ? 0.6 : 1 },
          ]}
          onPress={handleSave}
          disabled={!canSave || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text
              style={[
                styles.primaryBtnText,
                { color: canSave ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              Save Camera
            </Text>
          )}
        </Pressable>

        {/* Remove */}
        {status?.configured && (
          <Pressable style={styles.removeBtn} onPress={handleRemove}>
            <Feather name="trash-2" size={16} color="#FF6B6B" />
            <Text style={styles.removeText}>Remove Home Camera</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  gateTitle: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  gateBody: { fontSize: 14, textAlign: "center", lineHeight: 21 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 16,
  },
  statusText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  intro: { fontSize: 14, lineHeight: 21, marginBottom: 20 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 7, fontFamily: "Inter_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  passwordRow: { flexDirection: "row", alignItems: "center", position: "relative" },
  passwordInput: { flex: 1, paddingRight: 44 },
  eyeBtn: { position: "absolute", right: 12, height: "100%", justifyContent: "center" },
  helpToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, marginBottom: 4 },
  helpToggleText: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  helpBox: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  helpText: { fontSize: 13, lineHeight: 21 },
  helpLink: { fontSize: 13, fontWeight: "600", marginTop: 10, fontFamily: "Inter_600SemiBold" },
  resultBox: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  resultText: { flex: 1, fontSize: 13, lineHeight: 19 },
  primaryBtn: { borderRadius: 12, paddingVertical: 15, alignItems: "center", marginBottom: 12 },
  primaryBtnText: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  secondaryBtn: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  secondaryBtnText: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  removeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, marginTop: 4 },
  removeText: { color: "#FF6B6B", fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
