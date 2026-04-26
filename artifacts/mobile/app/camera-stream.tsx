// TWILIO VIDEO — Phase 2 camera integration
// ─────────────────────────────────────────────────────────────────────────────
// Single-screen component used by both sides of an emergency video session:
//   • mode=publish  → care-receiver, activates front camera and joins the room
//   • mode=view     → caregiver, joins the room as a subscriber
//
// Until `@twilio/video-react-native-sdk` is installed (requires a custom EAS
// dev build because the SDK ships native iOS/Android code that Expo Go does
// not include) the screen renders a clear placeholder explaining what would
// happen here and provides the "End Stream" button so the rest of the flow
// can be tested. When you're ready to wire up real video:
//   1. Add TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET to server secrets
//   2. `pnpm --filter @workspace/mobile add @twilio/video-react-native-sdk`
//   3. Run `eas build --profile development --platform ios` (or android)
//   4. Replace the <Placeholder /> below with the SDK's <TwilioVideo /> view
//      and call /api/video/token to fetch a JWT, then videoRef.connect(...)
// ─────────────────────────────────────────────────────────────────────────────

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Mode = "publish" | "view";

export default function CameraStreamScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    roomName?: string;
    receiverName?: string;
    caregiverName?: string;
  }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const mode: Mode = params.mode === "publish" ? "publish" : "view";
  const roomName = params.roomName ?? "";
  const otherPartyName =
    mode === "publish"
      ? params.caregiverName ?? "Your caregiver"
      : params.receiverName ?? "Care receiver";

  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

    // TWILIO VIDEO — Phase 2 camera integration
    // When the real SDK is wired up, replace this fake delay with:
    //   const tokenRes = await callNotifyApi("/api/video/token", {
    //     identity: user.id, roomName,
    //   });
    //   videoRef.current.connect({ accessToken: tokenRes.token, roomName });
    const t = setTimeout(() => setConnecting(false), 1500);
    return () => clearTimeout(t);
  }, [roomName]);

  const endStream = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // TWILIO VIDEO — Phase 2: videoRef.current.disconnect();
    router.back();
  };

  return (
    <View style={[styles.root, { paddingTop: topPad + 16, paddingBottom: bottomPad + 16 }]}>
      {mode === "publish" && (
        <View style={styles.banner}>
          <View style={styles.bannerDot} />
          <Text style={styles.bannerText}>CAMERA IS ACTIVE — {otherPartyName} is watching</Text>
        </View>
      )}

      <View style={styles.videoArea}>
        {connecting ? (
          <View style={styles.placeholder}>
            <ActivityIndicator size="large" color="#22FF6E" />
            <Text style={styles.placeholderTitle}>
              {mode === "publish" ? "Activating front camera…" : "Connecting to camera…"}
            </Text>
            <Text style={styles.placeholderSub}>Joining room {roomName.slice(-6) || "—"}</Text>
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Feather
              name={mode === "publish" ? "camera" : "video"}
              size={64}
              color="#22FF6E"
            />
            <Text style={styles.placeholderTitle}>
              {mode === "publish" ? "Front Camera Ready" : "Live Stream Ready"}
            </Text>
            <Text style={styles.placeholderSub}>
              {mode === "publish"
                ? "Your camera will broadcast to your caregiver once a Twilio Video build is installed."
                : `${otherPartyName}'s front camera will appear here once a Twilio Video build is installed.`}
            </Text>
            <Text style={styles.placeholderHint}>
              Phase 2 — install @twilio/video-react-native-sdk and ship a dev build
            </Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable style={[styles.endBtn, mode === "publish" && styles.endBtnReceiver]} onPress={endStream}>
          <Feather name="phone-off" size={20} color="#fff" />
          <Text style={styles.endBtnText}>
            {mode === "publish" ? "Stop Camera" : "End Stream"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", paddingHorizontal: 16 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF3B30",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginBottom: 12,
    alignSelf: "center",
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  bannerText: { color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  videoArea: {
    flex: 1,
    backgroundColor: "#0a0e1c",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(34, 255, 110, 0.15)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: { alignItems: "center", padding: 24, gap: 14 },
  placeholderTitle: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  placeholderSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  placeholderHint: {
    color: "rgba(34, 255, 110, 0.7)",
    fontSize: 11,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 8,
  },
  controls: { paddingTop: 16 },
  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: "#FF3B30",
  },
  endBtnReceiver: { backgroundColor: "#FF3B30" },
  endBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
