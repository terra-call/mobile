// TWILIO VIDEO — Phase 2 camera integration
// ─────────────────────────────────────────────────────────────────────────────
// One-time consent dialog shown to a care-recipient before their front camera
// can be activated remotely during an emergency. Their answer is persisted
// to Firestore on the user doc as `cameraConsent: boolean`. If they decline,
// the caregiver will see "Care recipient has not consented" instead of a
// camera stream, and the modal will re-prompt on a future launch (we treat
// "unset" as "ask again" but never re-prompt once the user has answered).
// ─────────────────────────────────────────────────────────────────────────────

import { Feather } from "@expo/vector-icons";
import { doc, setDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db, isFirebaseConfigured } from "@/services/firebase";
import { logAudit } from "@/services/audit";

// PHASE B — silent permission warm-up.
// After the user grants in-app camera consent, we eagerly request the OS
// camera + microphone permissions so the native dialog appears here, during
// onboarding — not in the middle of a real emergency 15 seconds after the
// caregiver has tried to call. expo-camera's request* helpers trigger the
// OS prompt without ever opening a preview surface or capturing frames, so
// nothing flickers on screen. Loaded lazily so Expo Go / web (which don't
// have the native module) never crash on import.
async function warmUpCameraPermissions(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Camera } = require("expo-camera") as typeof import("expo-camera");
    const camRes = await Camera.requestCameraPermissionsAsync();
    const micRes = await Camera.requestMicrophonePermissionsAsync();
    logAudit({
      userId,
      action: "camera_permission_warmup",
      details: `Camera permission warm-up after consent — camera=${camRes.status}, microphone=${micRes.status}`,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    logAudit({
      userId,
      action: "camera_permission_warmup",
      details: `Camera permission warm-up skipped — ${reason}`,
    });
  }
}

interface Props {
  visible: boolean;
  userId: string;
  onAnswered: (granted: boolean) => void;
}

export function CameraConsentModal({ visible, userId, onAnswered }: Props) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const [saving, setSaving] = useState<"yes" | "no" | null>(null);

  const persist = async (granted: boolean) => {
    if (saving) return;
    setSaving(granted ? "yes" : "no");
    try {
      if (isFirebaseConfigured && db) {
        // Use setDoc with merge so this works even if the user doc somehow
        // doesn't exist yet (updateDoc would throw "no-document").
        await setDoc(doc(db, "users", userId), { cameraConsent: granted }, { merge: true });
      }
      // PHASE B — warm up the OS-level camera + microphone permissions so the
      // native prompts fire here (during onboarding) instead of in the middle
      // of an emergency. Only do this when the user actually consented; if they
      // declined, asking the OS for permission would be wrong UX.
      //
      // Dismiss the consent modal FIRST, then fire the OS permission prompt on
      // the next tick — on some Android versions, triggering a permission
      // dialog while a Modal is still mounted causes the modal to "freeze"
      // until the dialog is resolved, leading to an awkward stacked-UI moment.
      onAnswered(granted);
      if (granted) {
        setTimeout(() => {
          void warmUpCameraPermissions(userId);
        }, 150);
      }
    } catch {
      // If Firestore write fails we still let the user proceed; they'll be
      // re-prompted on next launch since the value isn't yet persisted.
      onAnswered(granted);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={[styles.root, { paddingTop: topPad + 24, paddingBottom: bottomPad + 24 }]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconWrap}>
            <Feather name="video" size={42} color="#22FF6E" />
          </View>

          <Text style={styles.title}>Camera Activation Consent</Text>

          <Text style={styles.body}>
            Terra Call has an emergency safety feature: if your caregiver tries to call
            your device and you don't answer within 15 seconds, your front-facing camera
            can be turned on automatically so they can see whether you are okay.
          </Text>

          <View style={styles.bullets}>
            <Bullet text="Camera only activates after an unanswered emergency call" />
            <Bullet text="Your caregiver sees a live video — nothing is recorded" />
            <Bullet text="A red banner appears on your screen while the camera is on" />
            <Bullet text="You can stop the stream from your device at any time" />
            <Bullet text="You can change this answer later in Settings" />
          </View>

          <Text style={styles.legal}>
            By choosing "I Consent" you authorize Terra Call to activate your front camera
            during emergency situations as described above. Choose "I Do Not Consent" to
            disable this feature — your caregiver will still receive all other alerts.
          </Text>
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.btnPrimary, saving === "yes" && styles.btnDisabled]}
            onPress={() => persist(true)}
            disabled={saving !== null}
          >
            {saving === "yes" ? (
              <ActivityIndicator color="#060a18" />
            ) : (
              <Text style={styles.btnPrimaryText}>I Consent</Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnSecondary, saving === "no" && styles.btnDisabled]}
            onPress={() => persist(false)}
            disabled={saving !== null}
          >
            {saving === "no" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnSecondaryText}>I Do Not Consent</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Feather name="check" size={16} color="#22FF6E" />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#060a18",
    paddingHorizontal: 24,
  },
  scroll: { paddingBottom: 16 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(34, 255, 110, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(34, 255, 110, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    marginBottom: 14,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.78)",
    textAlign: "center",
    marginBottom: 22,
  },
  bullets: { gap: 12, marginBottom: 22 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bulletText: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 20 },
  legal: {
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
    fontStyle: "italic",
  },
  actions: { gap: 12, paddingTop: 12 },
  btn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    backgroundColor: "#22FF6E",
    shadowColor: "#22FF6E",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  btnPrimaryText: { fontSize: 17, fontWeight: "800", color: "#060a18", letterSpacing: 0.3 },
  btnSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  btnSecondaryText: { fontSize: 16, fontWeight: "600", color: "rgba(255,255,255,0.9)" },
  btnDisabled: { opacity: 0.5 },
});
