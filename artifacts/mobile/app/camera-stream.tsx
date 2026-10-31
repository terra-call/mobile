// TWILIO VIDEO — Phase 2 camera integration (LIVE)
// ─────────────────────────────────────────────────────────────────────────────
// Single-screen component used by both sides of a video session. `mode` is the
// MEDIA role on THIS device, NOT the user's account role — either party can be
// the publisher depending on the call direction:
//   • mode=publish → activates the front camera and broadcasts into the room
//   • mode=view    → joins the room as a subscriber and renders the remote feed
// Caregiver-initiated emergency: recipient publishes, caregiver views.
// Recipient-initiated "Call My Caregiver": caregiver publishes, recipient views.
// The room is always keyed on the care-recipient's uid (the room "owner"),
// passed to the server as targetUserId regardless of who publishes.
//
// The actual SDK (`@twilio/video-react-native-sdk`) is loaded through the
// guarded wrapper at services/twilioVideo.ts so this file is safe to render
// in Expo Go too — when the native module is missing we fall back to the
// previous "needs a dev build" placeholder UI and audit-log the fact.
//
// To run real video end-to-end you need a custom EAS build:
//   pnpm --filter @workspace/mobile exec eas build \
//        --profile development --platform ios   (or android)
// The plugin entry "@twilio/video-react-native-sdk" in app.json wires up
// the native config (Info.plist / AndroidManifest) automatically during
// `expo prebuild`.
// ─────────────────────────────────────────────────────────────────────────────

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { logAudit } from "@/services/audit";
import { useAuth } from "@/contexts/AuthContext";
import {
  markEmergencyEventResolved,
  markEmergencyEventVideoConnected,
} from "@/services/emergencyEventLog";
import { requestVideoToken, VIDEO_TOKEN_ERROR_MESSAGE } from "@/services/video";
import { stopRingtone } from "@/services/ringtone";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/services/firebase";
import {
  finishNativeCall, getCallKeep, nativeCallConnected, nativeCallSnapshot,
  subscribeNativeCalls,
} from "@/services/nativeCalls";
import { HomeCameraFeed } from "@/components/HomeCameraFeed";
import {
  TwilioVideo,
  TwilioVideoLocalView,
  TwilioVideoParticipantView,
  isTwilioVideoAvailable,
  twilioVideoLoadError,
  type ParticipantEventCb,
  type RoomErrorEventCb,
  type RoomEventCb,
  type TrackEventCb,
  type TrackIdentifier,
} from "@/services/twilioVideo";

type Mode = "publish" | "view";

// AUTO-RECONNECT — an unexpected mid-call Twilio disconnect (transient network
// drop, or WebRTC media starvation while the concurrent Reolink home-camera feed
// polls full-frame JPEGs on the same device) should self-heal rather than leave a
// dead "phone camera". We rejoin with the still-valid access token (TTL 1h) using
// bounded retries + exponential backoff, then surface the real reason on screen.
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BACKOFF_MS = 1000; // 1s → 2s → 4s

interface RemoteVideoTrack {
  participantSid: string;
  videoTrackSid: string;
  identity: string;
}

export default function CameraStreamScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    roomName?: string;
    receiverName?: string;
    caregiverName?: string;
    // Explicit name of the OTHER person on the call (the one NOT holding this
    // device). Set by the navigator so the banner/labels stay correct even when
    // the publisher is the caregiver (recipient-initiated "Call My Caregiver").
    otherPartyName?: string;
    receiverId?: string;
    eventId?: string;
    // RECIPIENT-INITIATED CALL ONLY — the cameraActivations docId. Server
    // requires it for tc-call-* rooms to bind token minting to the signaled
    // 1:1 participants. Absent for tc-emrg-* emergency rooms.
    activationDocId?: string;
    nativeCallUUID?: string;
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
  // Prefer the explicit otherPartyName param (set by every call navigator).
  // Fall back to the legacy mode-based guess for older nav paths that don't
  // pass it. In publish mode the "other party" is the watcher; in view mode it
  // is the person whose camera we're subscribing to.
  const otherPartyName =
    params.otherPartyName ??
    (mode === "publish"
      ? params.caregiverName ?? "Your caregiver"
      : params.receiverName ?? "Care recipient");
  // Role-accurate label for audit details. Publish/view no longer maps 1:1 to
  // recipient/caregiver (the caregiver publishes in a recipient-initiated call),
  // so derive this from the signed-in user's role rather than the stream mode.
  const selfLabel = user?.role === "caregiver" ? "Caregiver" : "Care-recipient";

  const [connecting, setConnecting] = useState(true);

  // RING — silence the in-app incoming-call ringtone once we reach this screen.
  // For a caregiver-initiated call the recipient's activation handler started
  // the ring; stop it the moment the call resolves (connected or failed →
  // `connecting` flips false) and always on unmount. Harmless no-op for the
  // caller side, where no ring was ever started.
  useEffect(() => {
    if (!connecting) stopRingtone();
  }, [connecting]);
  useEffect(() => () => stopRingtone(), []);

  const [tokenError, setTokenError] = useState<string | null>(null);
  // DIAGNOSTIC — raw error string from Twilio SDK / token endpoint, shown
  // under the friendly "Video unavailable" copy so we can debug failures
  // on real devices without needing remote logs. Safe to leave in: contains
  // no PHI, only Twilio error codes / HTTP status reasons.
  const [tokenErrorDetail, setTokenErrorDetail] = useState<string | null>(null);
  // TWILIO VIDEO — connection lifecycle. `roomConnected` flips true when
  // the SDK's onRoomDidConnect fires; `remoteTracks` accumulates remote
  // video tracks the caregiver subscribes to.
  const [roomConnected, setRoomConnected] = useState(false);
  const [remoteTracks, setRemoteTracks] = useState<RemoteVideoTrack[]>([]);
  // The token is held in a ref (not state) so it is never accidentally
  // serialized into render output or React DevTools — JWTs are short-lived
  // bearer credentials.
  const accessTokenRef = useRef<string | null>(null);
  const twilioRef = useRef<InstanceType<NonNullable<typeof TwilioVideo>> | null>(null);
  // Guard against double-disconnect (endStream + unmount cleanup).
  const disconnectedRef = useRef(false);
  const endingRef = useRef(false);
  // Auto-reconnect bookkeeping for unexpected mid-call drops.
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Token mint + audit lifecycle ────────────────────────────────────────
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

    // Fresh session — clear any stale end/reconnect bookkeeping from a prior run.
    disconnectedRef.current = false;
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    let cancelled = false;
    (async () => {
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

      // The same /api/video/token endpoint serves both sides. Identity is
      // re-derived server-side from the verified Firebase uid; we send it
      // here only for the local audit log. `targetUserId` is the room's
      // care-recipient (the room "owner") — independent of which side
      // publishes video. Use the explicit receiverId param when provided
      // (caregiver side, or the recipient-as-viewer in a recipient-initiated
      // call); fall back to the signed-in uid for the recipient-publishes
      // flows (emergency / caregiver-initiated) that don't pass receiverId,
      // where the signed-in user IS the recipient. The server uses
      // targetUserId to enforce the permittedCaregivers permission check.
      const identity = user?.id ?? `anon-${mode}`;
      const targetUserId = receiverId ?? (user?.id ?? "");

      if (!targetUserId) {
        if (user?.id) {
          logAudit({
            userId: user.id,
            action: "video_token_error",
            details: `Token request aborted — missing targetUserId (mode=${mode}, room=${roomName})`,
          });
        }
        if (!cancelled) {
          setTokenError(VIDEO_TOKEN_ERROR_MESSAGE);
          setConnecting(false);
        }
        return;
      }

      const result = await requestVideoToken({
        identity,
        roomName,
        targetUserId,
        auditUserId: user?.id,
        activationDocId: params.activationDocId,
      });

      if (cancelled) return;

      if (!result.ok) {
        if (mode === "publish" && user?.id) {
          logAudit({
            userId: user.id,
            action: "camera_activation_failed",
            details: `Receiver-side token mint failed (${result.code}) — camera cannot publish to room ${roomName}`,
          });
        }
        setTokenError(result.message);
        setTokenErrorDetail(`token mint failed: ${result.code}`);
        setConnecting(false);
        return;
      }

      accessTokenRef.current = result.token;

      // ── REAL SDK CONNECT ────────────────────────────────────────────────
      // If the native module is loaded (custom dev build), tell the
      // imperative TwilioVideo component to join the room. The room
      // event handlers below will flip `roomConnected` once the room
      // ACK comes back. If the SDK is missing (Expo Go / web), the
      // component renders the "needs a dev build" placeholder instead
      // and we still mark connection ready so the audit/event lifecycle
      // can proceed for end-to-end flow testing.
      if (isTwilioVideoAvailable && twilioRef.current) {
        // PERMISSION GATE — audio is now TWO-WAY, so BOTH sides capture the
        // microphone (enableAudio:true below) and therefore both need OS
        // RECORD_AUDIO. On Android, calling Twilio.connect() with enableAudio
        // (or enableVideo) while the matching OS permission is ungranted makes
        // connect() hang forever ("Joining room…"). So request mic on every
        // device, and camera additionally on the publisher (the only side that
        // sets enableVideo). Already-granted permissions resolve instantly, so
        // this is a safe no-op for the recipient who already consented.
        if (Platform.OS !== "web") {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Camera } = require("expo-camera") as typeof import("expo-camera");
            const micRes = await Camera.requestMicrophonePermissionsAsync();
            const camRes =
              mode === "publish"
                ? await Camera.requestCameraPermissionsAsync()
                : { status: "granted" as const };
            if (cancelled) return;
            if (micRes.status !== "granted" || camRes.status !== "granted") {
              if (user?.id) {
                logAudit({
                  userId: user.id,
                  action: "camera_activation_failed",
                  details: `Permission denied — camera=${camRes.status}, microphone=${micRes.status} (mode=${mode}, room=${roomName})`,
                });
              }
              setTokenError(
                mode === "publish"
                  ? "Camera and microphone access are needed to share your video. Enable them in Settings, then try again."
                  : "Microphone access is needed so you can speak during the call. Enable it in Settings, then try again.",
              );
              setTokenErrorDetail(`permissions: camera=${camRes.status}, mic=${micRes.status}`);
              setConnecting(false);
              return;
            }
          } catch (err) {
            // expo-camera missing should not happen in a dev build that bundles
            // the Twilio SDK; log and let connect() attempt anyway rather than
            // hard-blocking the call.
            const reason = err instanceof Error ? err.message : "unknown";
            if (user?.id) {
              logAudit({
                userId: user.id,
                action: "camera_permission_warmup",
                details: `Permission request threw — ${reason} (mode=${mode}, room=${roomName})`,
              });
            }
          }
        }
        try {
          // TWO-WAY AUDIO — both sides capture and publish their microphone so
          // caregiver and care recipient can talk to each other. Only the
          // publisher sends video (enableVideo); the viewer is audio-only on
          // the outbound side but still hears the publisher's video+audio.
          // enableRemoteAudio (Android) keeps inbound audio subscribed; iOS
          // subscribes to remote audio automatically.
          twilioRef.current.connect({
            accessToken: result.token,
            roomName,
            enableAudio: true,
            enableVideo: mode === "publish",
            enableRemoteAudio: true,
            enableNetworkQualityReporting: true,
          });
          // Don't flip `connecting` to false yet — wait for onRoomDidConnect.
        } catch (err) {
          const reason = err instanceof Error ? err.message : "twilio connect failed";
          if (user?.id) {
            logAudit({
              userId: user.id,
              action: "video_token_error",
              details: `TwilioVideo.connect threw: ${reason} (room=${roomName})`,
            });
          }
          setTokenError(VIDEO_TOKEN_ERROR_MESSAGE);
          setTokenErrorDetail(`SDK connect threw: ${reason}`);
          setConnecting(false);
        }
      } else {
        // Expo Go / web fallback path — log the SDK absence and complete
        // the audit/event lifecycle as before so the rest of the flow
        // can still be exercised end-to-end without a dev build.
        if (user?.id && !isTwilioVideoAvailable) {
          logAudit({
            userId: user.id,
            action: "video_token_error",
            details: `Twilio Video native module unavailable (${twilioVideoLoadError ?? "Expo Go or web"}) — falling back to placeholder (room=${roomName})`,
          });
        }
        setConnecting(false);
        if (user?.id) {
          logAudit({
            userId: user.id,
            action: "video_stream_connected",
            details: `${selfLabel} reached camera-stream room ${roomName} (placeholder mode — no native SDK)`,
            targetUserId: receiverId ?? undefined,
          });
        }
        if (mode === "view") {
          markEmergencyEventVideoConnected(eventId);
        }
      }
    })();

    return () => {
      cancelled = true;
      const alreadyEnded = disconnectedRef.current;
      // Mark the session intentionally ended so a disconnect event fired by the
      // teardown below doesn't trigger an auto-reconnect on an unmounting screen.
      disconnectedRef.current = true;
      if (params.nativeCallUUID) finishNativeCall(params.nativeCallUUID);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      // Best-effort disconnect on unmount — in case the user backs out of
      // the screen without pressing the explicit End Stream button.
      if (!alreadyEnded && isTwilioVideoAvailable && twilioRef.current) {
        try {
          twilioRef.current.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName, mode, user?.id]);

  // Re-join the room using the already-minted access token (permissions are
  // already granted by the initial connect, so this won't hang). Used by the
  // auto-reconnect path. Returns false if the SDK/token isn't available.
  const connectToRoom = useCallback(() => {
    const token = accessTokenRef.current;
    if (!isTwilioVideoAvailable || !twilioRef.current || !token) return false;
    try {
      twilioRef.current.connect({
        accessToken: token,
        roomName,
        enableAudio: true,
        enableVideo: mode === "publish",
        enableRemoteAudio: true,
        enableNetworkQualityReporting: true,
      });
      return true;
    } catch {
      return false;
    }
  }, [roomName, mode]);

  // Schedule one bounded, backed-off reconnect attempt. Called from BOTH the
  // mid-call drop handler (onRoomDidDisconnect) and the connect-failure handler
  // (onRoomDidFailToConnect) so a failed rejoin chains into the next attempt
  // rather than giving up after one try. Surfaces a terminal error once the
  // attempt budget is exhausted; onRoomDidConnect resets the budget on success.
  const scheduleReconnect = useCallback(
    (reason: string) => {
      if (disconnectedRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnecting(false);
        setTokenError(VIDEO_TOKEN_ERROR_MESSAGE);
        setTokenErrorDetail(`Twilio room dropped, reconnect failed: ${reason}`);
        return;
      }
      const attempt = reconnectAttemptsRef.current;
      reconnectAttemptsRef.current = attempt + 1;
      // Present this attempt as "reconnecting", clearing any stale error UI.
      setTokenError(null);
      setTokenErrorDetail(null);
      setConnecting(true);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(
        () => {
          if (disconnectedRef.current) return;
          // connectToRoom() only reports whether the SDK could be ASKED to
          // rejoin; the real outcome arrives later via onRoomDidConnect
          // (success → budget reset) or onRoomDidFailToConnect (failure →
          // chains the next attempt).
          if (!connectToRoom()) {
            setConnecting(false);
            setTokenError(VIDEO_TOKEN_ERROR_MESSAGE);
            setTokenErrorDetail(`Reconnect failed after drop: ${reason}`);
          }
        },
        RECONNECT_BACKOFF_MS * 2 ** attempt,
      );
    },
    [connectToRoom],
  );

  // ── SDK event handlers ──────────────────────────────────────────────────
  const onRoomDidConnect: RoomEventCb = useMemo(
    () => () => {
      if (params.nativeCallUUID) nativeCallConnected(params.nativeCallUUID);
      setRoomConnected(true);
      setConnecting(false);
      // A clean (re)connect clears the auto-reconnect budget.
      reconnectAttemptsRef.current = 0;
      // AUDIO ROUTING — route call audio to the loudspeaker (not the quiet
      // earpiece) and make sure inbound audio is unmuted, so both sides can
      // hear each other hands-free. This is a no-op on web/Expo Go.
      try {
        twilioRef.current?.toggleSoundSetup(true);
        twilioRef.current?.setRemoteAudioEnabled(true);
      } catch {
        /* ignore — audio routing is best-effort */
      }
      if (user?.id) {
        logAudit({
          userId: user.id,
          action: "video_stream_connected",
          details: `${selfLabel} connected to Twilio Video room ${roomName}`,
          targetUserId: receiverId ?? undefined,
        });
      }
      if (mode === "view") {
        markEmergencyEventVideoConnected(eventId);
      }
    },
    [user?.id, mode, roomName, receiverId, eventId],
  );

  const onRoomDidFailToConnect: RoomErrorEventCb = useMemo(
    () => (event) => {
      const reason =
        typeof event.error === "string"
          ? event.error
          : event.error?.message ?? "unknown room error";

      // ANY connect failure with retry budget left — including the very FIRST
      // attempt — chains into the next backoff attempt rather than giving up.
      // Transient signaling failures (e.g. "Signaling connection error" from a
      // brief network blip right as the camera activates) were previously
      // terminal on the initial connect, showing "Video unavailable" for a
      // hiccup that a 1–2s retry would have absorbed. connectToRoom() returns
      // before the rejoin's real outcome is known, so this handler is also
      // where a failed rejoin is observed and chained.
      if (
        !disconnectedRef.current &&
        reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
      ) {
        if (user?.id) {
          logAudit({
            userId: user.id,
            action: "video_stream_disconnected",
            details: `${
              reconnectAttemptsRef.current === 0
                ? "Initial connect failed"
                : "Reconnect attempt failed"
            } (${reason}) — retrying ${
              reconnectAttemptsRef.current + 1
            }/${MAX_RECONNECT_ATTEMPTS} (room=${roomName})`,
          });
        }
        scheduleReconnect(reason);
        return;
      }

      // Initial connect failure, or reconnect budget exhausted — terminal.
      if (user?.id) {
        logAudit({
          userId: user.id,
          action: "video_token_error",
          details: `Twilio room connect failed: ${reason} (room=${roomName})`,
        });
      }
      setTokenError(VIDEO_TOKEN_ERROR_MESSAGE);
      setTokenErrorDetail(`Twilio rejected room connect: ${reason}`);
      setConnecting(false);
    },
    [user?.id, roomName, scheduleReconnect],
  );

  // DISCONNECT — distinct from connect-failure. A disconnect can be either
  // (a) the user pressed End Stream (expected, no error UI), or (b) the
  // SDK lost the room mid-call (unexpected, but still NOT a token mint
  // failure — recording it as `video_token_error` would corrupt the audit
  // trail). We only flip back to a "not connected" state and let the
  // existing endStream / unmount paths handle the rest.
  const onRoomDidDisconnect: RoomErrorEventCb = useMemo(
    () => (event) => {
      setRoomConnected(false);
      setRemoteTracks([]);
      const errMsg =
        typeof event.error === "string"
          ? event.error
          : event.error?.message ?? null;
      const reason = errMsg ?? "no error detail";

      // Expected disconnect — the user pressed End Stream or the screen is
      // unmounting (both set disconnectedRef). Nothing to recover.
      if (disconnectedRef.current) return;

      // Unexpected mid-call drop. The most likely cause is WebRTC media
      // starvation from the concurrent Reolink home-camera polling saturating
      // the device's bandwidth. Kick off the bounded auto-reconnect (which
      // self-heals a transient drop) before any error UI is shown. NOTE: a
      // normal remote hang-up surfaces as onRoomParticipantDidDisconnect on the
      // viewer side — not this event — so this path is genuinely for lost
      // connections rather than intentional call ends.
      if (user?.id) {
        logAudit({
          userId: user.id,
          action: "video_stream_disconnected",
          details: `Twilio room dropped (${reason}) — reconnect attempt ${
            reconnectAttemptsRef.current + 1
          }/${MAX_RECONNECT_ATTEMPTS} (room=${roomName})`,
          targetUserId: receiverId ?? undefined,
        });
      }
      scheduleReconnect(reason);
    },
    [user?.id, roomName, receiverId, scheduleReconnect],
  );

  // REMOTE AUDIO — when the other participant's audio track arrives, make sure
  // it is subscribed/unmuted and keep audio on the loudspeaker. Applies to BOTH
  // sides now that audio is two-way. Best-effort; no-op on web/Expo Go.
  const onParticipantAddedAudioTrack: TrackEventCb = useMemo(
    () => () => {
      try {
        twilioRef.current?.setRemoteAudioEnabled(true);
        twilioRef.current?.toggleSoundSetup(true);
      } catch {
        /* ignore — audio routing is best-effort */
      }
    },
    [],
  );

  const onParticipantAddedVideoTrack: TrackEventCb = useMemo(
    () => ({ participant, track }) => {
      // Caregiver (mode=view) subscribes to remote video tracks. The
      // publish side can ignore — we don't need to render the receiver's
      // own remote view.
      if (mode !== "view") return;
      setRemoteTracks((prev) => {
        if (prev.some((t) => t.videoTrackSid === track.trackSid)) return prev;
        return [
          ...prev,
          {
            participantSid: participant.sid,
            videoTrackSid: track.trackSid,
            identity: participant.identity,
          },
        ];
      });
    },
    [mode],
  );

  const onParticipantRemovedVideoTrack: TrackEventCb = useMemo(
    () => ({ track }) => {
      setRemoteTracks((prev) => prev.filter((t) => t.videoTrackSid !== track.trackSid));
    },
    [],
  );

  const onRoomParticipantDidDisconnect: ParticipantEventCb = useMemo(
    () => ({ participant }) => {
      setRemoteTracks((prev) => prev.filter((t) => t.participantSid !== participant.sid));
      if (params.activationDocId) void endStream();
    },
    [],
  );

  // ── End / disconnect ────────────────────────────────────────────────────
  const endStream = async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    if (params.nativeCallUUID) finishNativeCall(params.nativeCallUUID);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (isTwilioVideoAvailable && twilioRef.current && !disconnectedRef.current) {
      try {
        twilioRef.current.disconnect();
      } catch {
        /* ignore */
      }
    }
    disconnectedRef.current = true;

    // EMERGENCY CALL FLOW — close out the lifecycle. Only the caregiver
    // (mode=view) owns the events doc, so only they patch it here. Both
    // sides write the audit log so we have a record from each device.
    if (user?.id) {
      logAudit({
        userId: user.id,
        action: "emergency_call_resolved",
        details: `${selfLabel} ended the live stream (room=${roomName})`,
        targetUserId: receiverId ?? undefined,
      });
    }
    if (mode === "view") {
      markEmergencyEventResolved(eventId);
    }

    router.back();
  };

  // Keep the OS call and media lifetimes synchronized in both directions.
  useEffect(() => {
    const uuid = params.nativeCallUUID;
    if (!uuid) return;
    const unsubscribe = subscribeNativeCalls(() => {
      const call = nativeCallSnapshot().find((item) => item.callUUID === uuid);
      if (!call || call.action === "end") void endStream();
    });
    const mute = getCallKeep()?.addEventListener("didPerformSetMutedCallAction", (event) => {
      if (event.callUUID.toLowerCase() === uuid.toLowerCase()) {
        void twilioRef.current?.setLocalAudioEnabled(!event.muted);
      }
    });
    return () => { unsubscribe(); mute?.remove(); };
  }, [params.nativeCallUUID]);

  useEffect(() => {
    if (tokenError && params.nativeCallUUID) finishNativeCall(params.nativeCallUUID, 1);
  }, [tokenError, params.nativeCallUUID]);

  // Call cancellation/remote hang-up must also stop native UI. The same doc
  // lets a caller terminate an unanswered ring rather than leave a ghost call.
  useEffect(() => {
    if (!db || !params.activationDocId) return;
    const ref = doc(db, "cameraActivations", params.activationDocId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (["declined", "cancelled", "ended"].includes(data.status)) {
        void endStream();
      } else if (data.status === "pending" && data.callerUid === user?.id && data.expiresAt) {
        timer = setTimeout(() => {
          void runTransaction(db!, async (tx) => {
            if ((await tx.get(ref)).data()?.status === "pending") {
              tx.update(ref, { status: "cancelled", cancelledAt: serverTimestamp() });
            }
          }).catch(() => {});
          void endStream();
        }, Math.max(0, data.expiresAt.toMillis() - Date.now()));
      }
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      // Preserve auth/room/identity fields; only end the existing signal.
      void runTransaction(db!, async (tx) => {
        const data = (await tx.get(ref)).data();
        if (data?.status === "answered") {
          tx.update(ref, { status: "ended", endedAt: serverTimestamp() });
        } else if (data?.status === "pending" && data.callerUid === user?.id) {
          tx.update(ref, { status: "cancelled", cancelledAt: serverTimestamp() });
        }
      }).catch(() => {});
    };
  }, [params.activationDocId, user?.id]);

  // ── Render ──────────────────────────────────────────────────────────────
  const showRealVideo =
    isTwilioVideoAvailable &&
    !!TwilioVideo &&
    !!TwilioVideoLocalView &&
    !!TwilioVideoParticipantView;

  // DUAL-FEED — when a caregiver is viewing a recipient, show the recipient's
  // Reolink "Home Camera" alongside the Twilio "Phone Camera". Only the caregiver
  // (mode=view) with a known receiverId can pull the proxied snapshot feed.
  // Collapse the home-camera half entirely when the recipient has no Home
  // Camera set up — the phone camera then gets the full screen instead of
  // sharing it with a permanent "not configured" panel.
  const [homeCamNotConfigured, setHomeCamNotConfigured] = useState(false);
  // Reset when the viewed recipient changes — a different recipient may have a
  // camera configured, so they get a fresh probe rather than inheriting the
  // previous recipient's collapsed state.
  useEffect(() => {
    setHomeCamNotConfigured(false);
  }, [receiverId]);
  const showHomeCamera = mode === "view" && !!receiverId && !homeCamNotConfigured;

  // BANDWIDTH CONTENTION — while the Twilio phone-camera call is connecting or
  // live on THIS device, freeze the home (Reolink) feed instead of polling it.
  // The two streams compete for the device's uplink and the continuous JPEG poll
  // was starving the WebRTC call (and dropping the home feed). On token error or
  // placeholder mode (Expo Go / web) there is no active WebRTC media, so let the
  // home feed keep polling — that way a failed call still leaves the caregiver a
  // live home view rather than a frozen one.
  const phoneCameraActive =
    showRealVideo && !tokenError && (connecting || roomConnected);

  return (
    <View style={[styles.root, { paddingTop: topPad + 16, paddingBottom: bottomPad + 16 }]}>
      {mode === "publish" && (
        <View style={styles.banner}>
          <View style={styles.bannerDot} />
          <Text style={styles.bannerText}>CAMERA IS ACTIVE — {otherPartyName} is watching</Text>
        </View>
      )}

      <View style={showHomeCamera ? styles.feeds : styles.feedsSingle}>
      <View style={[styles.videoArea, showHomeCamera && styles.feedHalf]}>
        {showHomeCamera && (
          <View style={styles.feedLabel} pointerEvents="none">
            <Text style={styles.feedLabelText}>PHONE CAMERA</Text>
          </View>
        )}
        {/* Imperative TwilioVideo controller — it has no visible UI but it
            owns the room/connection. Mount it whenever the native SDK is
            available so the connect() call in the effect can target it. */}
        {showRealVideo && TwilioVideo && (
          <TwilioVideo
            ref={twilioRef}
            onRoomDidConnect={onRoomDidConnect}
            onRoomDidFailToConnect={onRoomDidFailToConnect}
            onRoomDidDisconnect={onRoomDidDisconnect}
            onParticipantAddedAudioTrack={onParticipantAddedAudioTrack}
            onParticipantAddedVideoTrack={onParticipantAddedVideoTrack}
            onParticipantRemovedVideoTrack={onParticipantRemovedVideoTrack}
            onRoomParticipantDidDisconnect={onRoomParticipantDidDisconnect}
            style={styles.twilioController}
          />
        )}

        {tokenError ? (
          <View style={styles.placeholder}>
            <Feather name="alert-triangle" size={56} color="#FF3B30" />
            <Text style={styles.errorTitle}>Video unavailable</Text>
            <Text style={styles.errorSub}>{tokenError}</Text>
            {tokenErrorDetail && (
              <Text selectable style={styles.errorDiag}>
                Diagnostic: {tokenErrorDetail}
              </Text>
            )}
          </View>
        ) : connecting ? (
          <View style={styles.placeholder}>
            <ActivityIndicator size="large" color="#22FF6E" />
            <Text style={styles.placeholderTitle}>
              {mode === "publish" ? "Activating front camera…" : "Connecting to camera…"}
            </Text>
            <Text style={styles.placeholderSub}>Joining room {roomName.slice(-6) || "—"}</Text>
          </View>
        ) : showRealVideo && roomConnected ? (
          // Real Twilio video rendering. Care-recipient sees their own
          // front camera; caregiver sees the receiver's remote track.
          mode === "publish" && TwilioVideoLocalView ? (
            <TwilioVideoLocalView enabled={true} style={styles.videoView} scaleType="fill" />
          ) : remoteTracks.length > 0 && TwilioVideoParticipantView ? (
            <TwilioVideoParticipantView
              trackIdentifier={
                {
                  participantSid: remoteTracks[0].participantSid,
                  videoTrackSid: remoteTracks[0].videoTrackSid,
                } satisfies TrackIdentifier
              }
              style={styles.videoView}
              scaleType="fill"
            />
          ) : (
            <View style={styles.placeholder}>
              <ActivityIndicator size="large" color="#22FF6E" />
              <Text style={styles.placeholderTitle}>Waiting for {otherPartyName}…</Text>
              <Text style={styles.placeholderSub}>
                Connected to room — waiting for the other side to join.
              </Text>
            </View>
          )
        ) : (
          // Expo Go / web fallback — placeholder explaining the dev-build
          // requirement. End-to-end flow (token mint, audit log, events
          // doc updates) still works in this mode for development testing.
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
                ? `Your camera will broadcast to ${otherPartyName} in a custom dev build.`
                : `${otherPartyName}'s front camera will appear here in a custom dev build.`}
            </Text>
            <Text style={styles.placeholderHint}>
              Run an EAS dev build to enable real Twilio Video here
            </Text>
          </View>
        )}
      </View>
      {showHomeCamera && receiverId && (
        <View style={[styles.videoArea, styles.feedHalf]}>
          <View style={styles.feedLabel} pointerEvents="none">
            <Text style={styles.feedLabelText}>HOME CAMERA</Text>
          </View>
          {/* Secondary home-camera view during a call. Frozen on its last frame
              while the phone camera is live (pausedForCall) to free bandwidth for
              the WebRTC call; resumes polling if the call ends/fails. Continuous
              polling is gated to emergency rooms — a routine call only ever pulls
              a manual on-demand frame. */}
          <HomeCameraFeed
            targetUserId={receiverId}
            active={roomName.startsWith("tc-emrg")}
            pausedForCall={phoneCameraActive}
            onNotConfigured={() => setHomeCamNotConfigured(true)}
          />
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
  feeds: { flex: 1, gap: 12 },
  feedsSingle: { flex: 1 },
  feedHalf: { flex: 1 },
  feedLabel: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 5,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  feedLabelText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
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
  // The imperative <TwilioVideo /> component has no visible UI but RN still
  // expects a layout. Pin it to a 0×0 box so it doesn't occupy space.
  twilioController: { position: "absolute", width: 0, height: 0, opacity: 0 },
  videoView: { flex: 1, width: "100%", height: "100%" },
  placeholder: { alignItems: "center", padding: 24, gap: 14 },
  errorTitle: { color: "#FF3B30", fontSize: 22, fontWeight: "700", textAlign: "center" },
  errorSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 320,
  },
  errorDiag: {
    color: "rgba(255, 200, 200, 0.7)",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 16,
    maxWidth: 360,
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
