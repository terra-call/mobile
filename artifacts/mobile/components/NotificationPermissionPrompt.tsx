import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { STORAGE_KEYS } from "@/constants/storage";
import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
} from "@/services/notifications";

interface Props {
  onGranted?: () => void;
}

export function NotificationPermissionPrompt({ onGranted }: Props) {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      const seen = await AsyncStorage.getItem(STORAGE_KEYS.NOTIF_PROMPT_SEEN);
      if (seen === "true" || cancelled) return;
      const status = await getNotificationPermissionStatus();
      if (cancelled) return;
      // Only show pre-prompt when the OS hasn't been asked yet.
      if (status === "undetermined") {
        setVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markSeen = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.NOTIF_PROMPT_SEEN, "true");
    } catch {
      // ignore
    }
  };

  const handleEnable = async () => {
    setRequesting(true);
    try {
      const granted = await requestNotificationPermissions();
      await markSeen();
      setVisible(false);
      if (granted) {
        onGranted?.();
      } else {
        // User said no on the OS dialog — quick reassurance, no scolding
        Alert.alert(
          "No Problem",
          "You can turn notifications on later from your device's Settings under Terra Call.",
        );
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleNotNow = async () => {
    await markSeen();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Feather name="bell" size={36} color="#22FF6E" />
          </View>

          <Text style={styles.title}>Stay Connected</Text>

          <Text style={styles.body}>
            Terra Call sends a friendly reminder when it's time to check in, so you never miss it.
          </Text>
          <Text style={styles.body}>
            We also alert your caregivers right away if something seems wrong.
          </Text>

          <View style={styles.bullets}>
            <BulletRow icon="clock" text="Daily check-in reminders" />
            <BulletRow icon="shield" text="Instant alerts for your loved ones" />
            <BulletRow icon="lock" text="Your data stays private" />
          </View>

          <Pressable
            style={[styles.primaryBtn, requesting && styles.btnDisabled]}
            onPress={handleEnable}
            disabled={requesting}
          >
            {requesting ? (
              <ActivityIndicator size="small" color="#060a18" />
            ) : (
              <Text style={styles.primaryBtnText}>Enable Notifications</Text>
            )}
          </Pressable>

          <Pressable style={styles.secondaryBtn} onPress={handleNotNow} disabled={requesting}>
            <Text style={styles.secondaryBtnText}>Maybe Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function BulletRow({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletIcon}>
        <Feather name={icon} size={14} color="#00C8FF" />
      </View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(6, 10, 24, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#0c1628",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1f2b45",
    padding: 24,
    alignItems: "center",
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#22FF6E18",
    borderWidth: 1,
    borderColor: "#22FF6E55",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    color: "#B5C0D8",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 8,
  },
  bullets: {
    width: "100%",
    marginTop: 18,
    marginBottom: 22,
    gap: 10,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bulletIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#00C8FF18",
    alignItems: "center",
    justifyContent: "center",
  },
  bulletText: {
    color: "#E6ECF8",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    flex: 1,
  },
  primaryBtn: {
    width: "100%",
    backgroundColor: "#22FF6E",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryBtnText: {
    color: "#060a18",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  secondaryBtnText: {
    color: "#8892B0",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  btnDisabled: {
    opacity: 0.7,
  },
});
