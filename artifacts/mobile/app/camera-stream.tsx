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
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { logAudit } from "@/services/audit";
import { useAuth } from "@/contexts/AuthContext";
import {
  markEmergencyEventResolved,
  markEmergencyEventVideoConnected,
} from "@/services/emergencyEventLog";
import { requestVideoToken, VIDEO_TOKEN_ERROR_MESSAGE } from "@/services/video";

type Mode = "publish" | "view";

export default function CameraStreamScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    roomName?: string;
    receiverName?: string;
    caregiverName?: string;
    receiverId?: string;
    eventId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const { user } = useAuth();

  const mode: Mode = params.mode === "publish" ? "publish" : "view";
  const roomName = params.roomName ?? "";
  // EMERGENCY CALL FLOW — eventId is passed by emergency-call.tsx so the
  // events lifecycle row created caregiver-side is the same row patched
  // here on connect/resolve. Empty string means no row to patch (e.g. a
  // direct deep-link into camera-stream, which shouldn't happen in normal
  // operation but we tolerate it gracefully).
  const eventId = params.eventId && params.eventId.length > 0 ? params.eventId : null;
  const receiverId = params.receiverId ?? null;
  const otherPartyName =
    mode === "publish"
      ? params.caregiverName ?? "Your caregiver"
      : params.receiverName ?? "Care receiver";

  const [connecting, setConnecting] = useState(true);
  // TWILIO VIDEO — token minting state. The token itself is held in a ref
  // (not state) so it is never accidentally serialized into render output or
  // the React DevTools tree — JWTs are short-lived bearer credentials.
  const accessTokenRef = useRef<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

    let cancelled = false;
    (async () => {
      // No room name passed in — nothing to mint a token for. Surface the
      // standard error so the caregiver knows to call 911 if needed, AND
      // write an audit-log entry so the failure shows up in the HIPAA trail
      // alongside the failures originating inside requestVideoToken.
      if (!roomName) {
        if (user?.id) {
          logAudit({
            userId: user.id,
            action: "video_token_error",
            details: `Token request aborted — camera-stream opened without a roomName (mode=${mode})`,
          });
        }
        if (!cancelled) {
          setTokenError(VIDEO_TOKEN_ERROR_MESSAGE);
          setConnecting(false);
        }
        return;
      }

      // The same /api/video/token endpoint serves both sides — the caller's
      // identity scopes the token to that user, and the room name scopes it
      // to this single emergency session.
      const identity = user?.id ?? `anon-${mode}`;
      const result = await requestVideoToken({
        identity,
        roomName,
        auditUserId: user?.id,
      });

      if (cancelled) return;

      if (!result.ok) {
        // Failure is already audited inside requestVideoToken (as
        // video_token_error). For the publish-side (care-receiver), this
        // ALSO means the camera could not activate — emit the dedicated
        // camera_activation_failed audit so the admin Care Reports tab
        // can correlate the receiver-side failure to the same room.
        if (mode === "publish" && user?.id) {
          logAudit({
            userId: user.id,
            action: "camera_activation_failed",
            details: `Receiver-side token mint failed (${result.code}) — camera cannot publish to room ${roomName}`,
          });
        }
        // Show the approved plain-English message — never the underlying
        // code/HTTP. For the caregiver (mode=view) this is the same
        // "Camera unavailable / call 911" surface.
        setTokenError(result.message);
        setConnecting(false);
        return;
      }

      // TWILIO VIDEO — Phase 2 camera integration
      // The JWT is now ready. When @twilio/video-react-native-sdk is installed
      // and a custom dev build is shipped, hand it off here:
      //   videoRef.current.connect({ accessToken: accessTokenRef.current, roomName });
      accessTokenRef.current = result.token;
      setConnecting(false);

      // EMERGENCY CALL FLOW — both sides have a valid token in hand and
      // are about to (or just did) join the room. Audit-log the connection
      // and, on the caregiver side, patch the events lifecycle row.
      if (user?.id) {
        logAudit({
          userId: user.id,
          action: "video_stream_connected",
          details: `${mode === "publish" ? "Care-receiver" : "Caregiver"} connected to Twilio Video room ${roomName}`,
          targetUserId: receiverId ?? undefined,
        });
      }
      if (mode === "view") {
        // Only the caregiver patches the events doc — they own it.
        markEmergencyEventVideoConnected(eventId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomName, mode, user?.id]);

  const endStream = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // TWILIO VIDEO — Phase 2: videoRef.current.disconnect();

    // EMERGENCY CALL FLOW — close out the lifecycle. Only the caregiver
    // (mode=view) owns the events doc, so only they patch it here. Both
    // sides write the audit log so we have a record from each device.
    if (user?.id) {
      logAudit({
        userId: user.id,
        action: "emergency_call_resolved",
        details: `${mode === "publish" ? "Care-receiver" : "Caregiver"} ended the live stream (room=${roomName})`,
        targetUserId: receiverId ?? undefined,
      });
    }
    if (mode === "view") {
      markEmergencyEventResolved(eventId);
    }

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
        {tokenError ? (
          // TWILIO VIDEO — token minting failed. Show the approved plain-
          // English message that points the caregiver to 911 as the safe
          // fallback. The detailed reason is in the auditLogs collection.
          <View style={styles.placeholder}>
            <Feather name="alert-triangle" size={56} color="#FF3B30" />
            <Text style={styles.errorTitle}>Video unavailable</Text>
            <Text style={styles.errorSub}>{tokenError}</Text>
          </View>
        ) : connecting ? (
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
  errorTitle: { color: "#FF3B30", fontSize: 22, fontWeight: "700", textAlign: "center" },
  errorSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 320,
  },
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
