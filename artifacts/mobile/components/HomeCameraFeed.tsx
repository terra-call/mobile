// REOLINK — caregiver Home Camera feed
// ─────────────────────────────────────────────────────────────────────────────
// Renders the care-recipient's Reolink camera as a pseudo-live feed by polling
// the server snapshot proxy (`GET /api/reolink/snapshot`) ~every 1.5s and
// swapping the <Image> source. Reolink exposes single JPEG frames only — there
// is no MJPEG/RTSP path through the cloud — so this stitches frames together.
//
// The caregiver never receives camera credentials; the server decrypts them and
// returns just the image bytes. Each request carries a fresh Firebase ID token
// (Authorization header) and a cache-busting timestamp.
//
// COST CONTROL — continuous polling is expensive (bandwidth + server CPU
// logging into the camera). It therefore runs ONLY when the caller marks the
// feed `active` (a genuine emergency/escalation), and is paused automatically
// when:
//   • the app goes to the background (Firestore-style: no point polling unseen),
//   • a 10-minute session cap elapses (caregiver must tap Resume), or
//   • the feed unmounts (modal dismissed / navigated away).
// When not actively polling, the caregiver can still pull a single fresh frame
// on demand ("Refresh"). Each polling session's start/stop is written to the
// HIPAA audit log so usage patterns can be monitored.
//
// State machine:
//   loading        → initial probe in flight
//   not_configured → recipient hasn't set up a Home Camera (404) → stop polling
//   ready          → may poll; `live` tracks whether the last frame loaded
// ─────────────────────────────────────────────────────────────────────────────

import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getReolinkSnapshotSource } from "@/services/reolink";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/services/audit";

// Target interval between frame *starts* for the pseudo-live feed. Set to 5s
// during an active emergency: each snapshot travels camera → home-internet
// upstream (the slow forwarded-port leg) → server → device, so polling faster
// than that slow uplink can serve just piles up overlapping fetches and starves
// the concurrent Twilio WebRTC call running on the SAME screen — the contention
// that was dropping the phone-camera feed. 5s keeps the feed "live enough" for
// monitoring while leaving the link real headroom. NOTE: the loop is self-paced
// (see the poll effect) — it only starts the next frame once the current one
// resolves, so frames never overlap. POLL_MS is the *minimum* spacing measured
// from each frame's start.
const POLL_MS = 5000;
// Floor between frames. After a slow or failed frame (which already ate most of
// POLL_MS) we retry promptly rather than adding another full interval on top.
const MIN_GAP_MS = 500;
// Watchdog for a single in-flight frame: if the <Image> neither loads nor errors
// within this window (stuck socket / dropped connection), give up on it and pace
// the next frame anyway so the loop can't stall on one hung request.
const FRAME_TIMEOUT_MS = 9000;
// Cross-fade duration when swapping to a freshly-loaded frame. Short enough to
// feel live, long enough to hide the hard cut between JPEGs.
const FADE_MS = 280;
// The snapshot proxy logs in then grabs a frame (server-side fast-fails at ~6s),
// so a single probe can legitimately take a few seconds — but it must never hang
// forever. Abort a stalled probe and retry once before falling back to the
// self-healing "offline" state, where the live poll loop keeps retrying.
const PROBE_TIMEOUT_MS = 8000;
const PROBE_RETRIES = 1;
const PROBE_RETRY_DELAY_MS = 1500;
// Maximum continuous polling session before we pause and require a manual
// Resume — caps the cost of a feed left open and forgotten.
const MAX_SESSION_MS = 10 * 60 * 1000;

type Phase = "loading" | "not_configured" | "ready";
type Source = { uri: string; headers: Record<string, string> };
type PausedReason = null | "session" | "manual";

export function HomeCameraFeed({
  targetUserId,
  active,
  pausedForCall = false,
}: {
  targetUserId: string;
  /**
   * Whether continuous polling is permitted. Pass `true` only for genuine
   * emergencies/escalations. When `false` the feed shows a single frame plus a
   * manual Refresh control and never enters the poll loop.
   */
  active: boolean;
  /**
   * Freeze the feed on its last good frame for the duration of a concurrent
   * Twilio phone-camera call. The poll loop is suspended (so the JPEG fetches
   * stop starving the WebRTC call's bandwidth) but the last frame stays on
   * screen under a small "Paused during video call" badge — NOT the offline
   * overlay. Polling resumes automatically when this flips back to `false`
   * (call ended / failed), provided the feed is still `active`.
   */
  pausedForCall?: boolean;
}) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [live, setLive] = useState(false);
  const activeRef = useRef(true);

  // Lifecycle gating ----------------------------------------------------------
  const [appForeground, setAppForeground] = useState(
    AppState.currentState === "active",
  );
  // `session`  → 10-minute cap elapsed; `manual` → caller marked feed inactive.
  const [pausedReason, setPausedReason] = useState<PausedReason>(null);

  // ── Double-buffered frame swap (no flicker) ─────────────────────────────────
  // Two persistent <Image> layers ping-pong: a new frame is loaded into the
  // hidden layer and only cross-faded in once it has fully decoded (onLoad), so
  // the previous frame stays on screen until the new one is ready. Both layers
  // stay mounted to preserve their decoded bitmaps across swaps.
  const [layerA, setLayerA] = useState<Source | null>(null);
  const [layerB, setLayerB] = useState<Source | null>(null);
  const visibleRef = useRef<"A" | "B">("A");
  const opacityA = useRef(new Animated.Value(1)).current;
  const opacityB = useRef(new Animated.Value(0)).current;
  // Consecutive image-load failures — we only show the offline overlay after a
  // couple in a row so a single dropped hidden-layer frame can't flash it over
  // a perfectly good visible frame.
  const failCountRef = useRef(0);
  // Set by the live poll effect to its `advance(frameId)` fn so the image
  // load/error callbacks can pace the NEXT frame the moment the current one
  // resolves (self-pacing — see the poll effect). Null when the loop isn't
  // running. The frameId argument lets `advance` ignore a late callback from an
  // already-superseded frame, so a stale settle can't shorten the current
  // frame's interval or cancel its watchdog.
  const scheduleNextRef = useRef<((frameId: number) => void) | null>(null);
  // The monotonic frameId currently loading in each physical layer, so a
  // layer's load/error callback can tell `advance` WHICH frame just settled.
  const layerFrameIdRef = useRef<{ A: number; B: number }>({ A: 0, B: 0 });

  // Load the next frame into whichever layer is currently hidden. `frameId` (set
  // by the poll loop) is recorded against the target layer for self-pacing; the
  // probe/manual paths omit it (they don't drive the loop).
  const loadIntoHidden = useCallback((src: Source, frameId?: number) => {
    const target: "A" | "B" = visibleRef.current === "A" ? "B" : "A";
    if (frameId !== undefined) layerFrameIdRef.current[target] = frameId;
    if (target === "B") setLayerB(src);
    else setLayerA(src);
  }, []);

  // Cross-fade to a layer once its image has finished loading.
  const onLayerLoaded = useCallback(
    (layer: "A" | "B") => {
      if (!activeRef.current) return;
      // This frame settled — pace the next one (no-op outside the poll loop).
      scheduleNextRef.current?.(layerFrameIdRef.current[layer]);
      failCountRef.current = 0;
      setLive(true);
      if (layer === visibleRef.current) return; // initial / already-visible frame
      // Claim visibility immediately (at fade start, not on completion) so the
      // next frame always loads into the truly-hidden layer even if this fade is
      // still mid-flight — preserving the ping-pong invariant under timing churn.
      visibleRef.current = layer;
      const incoming = layer === "A" ? opacityA : opacityB;
      const outgoing = layer === "A" ? opacityB : opacityA;
      Animated.parallel([
        Animated.timing(incoming, {
          toValue: 1,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(outgoing, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [opacityA, opacityB],
  );

  // A frame failed to load — only fall to "offline" after repeated failures.
  const onLayerError = useCallback((layer: "A" | "B") => {
    if (!activeRef.current) return;
    // This frame settled (with a failure) — pace the next one so a transient
    // error self-heals quickly instead of stalling the loop.
    scheduleNextRef.current?.(layerFrameIdRef.current[layer]);
    failCountRef.current += 1;
    if (failCountRef.current >= 2) setLive(false);
  }, []);

  // ── Initial probe — distinguish "not configured" (404) from "offline" ───────
  // Bounded by a timeout + a few retries so a slow/stalled first frame can't
  // leave the feed stuck on "Connecting…". If it can't get a definitive answer
  // it drops into the "ready" (offline) state, where the live poll loop keeps
  // retrying and self-heals the moment the camera responds again.
  useEffect(() => {
    activeRef.current = true;
    let cancelled = false;

    const probe = async (attempt: number): Promise<void> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        // Token acquisition can itself stall (network token refresh has no
        // built-in timeout), so race it against the same abort deadline rather
        // than awaiting it unguarded.
        const src = await Promise.race([
          getReolinkSnapshotSource(targetUserId),
          new Promise<null>((resolve) => {
            controller.signal.addEventListener("abort", () => resolve(null), {
              once: true,
            });
          }),
        ]);
        if (cancelled || !activeRef.current) {
          clearTimeout(timer);
          return;
        }
        if (!src) {
          clearTimeout(timer);
          // Not signed in / server URL missing / token stalled — enter offline
          // so the poll loop can recover, rather than spinning forever.
          setPhase("ready");
          setLive(false);
          return;
        }
        const res = await fetch(src.uri, {
          headers: src.headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (cancelled || !activeRef.current) return;
        if (res.status === 404) {
          setPhase("not_configured");
          return;
        }
        // Feed the first frame through the double-buffer; the Image's onLoad
        // drives `live`, so a stale/failed frame won't be marked live.
        loadIntoHidden(src);
        setPhase("ready");
      } catch {
        clearTimeout(timer);
        if (cancelled || !activeRef.current) return;
        if (attempt < PROBE_RETRIES) {
          await new Promise((r) => setTimeout(r, PROBE_RETRY_DELAY_MS));
          if (cancelled || !activeRef.current) return;
          return probe(attempt + 1);
        }
        // Give up the definitive probe — fall back to offline + keep polling.
        setPhase("ready");
        setLive(false);
      }
    };

    void probe(0);

    return () => {
      cancelled = true;
      activeRef.current = false;
    };
  }, [targetUserId, loadIntoHidden]);

  // ── App foreground/background tracking ──────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppForeground(next === "active");
    });
    return () => sub.remove();
  }, []);

  // When the caller turns the feed inactive (no longer an emergency), reflect it
  // as a manual pause; when it becomes active again, clear that pause so polling
  // can resume. A `session` pause (10-min cap) is sticky until the user resumes.
  useEffect(() => {
    setPausedReason((cur) => {
      if (!active) return "session" === cur ? cur : "manual";
      return cur === "manual" ? null : cur;
    });
  }, [active]);

  // Single source of truth for "should the loop be running right now". A live
  // phone-camera call (`pausedForCall`) suspends polling so the two streams stop
  // fighting over the device uplink — the last frame stays frozen meanwhile.
  //
  // EXCEPTION: keep polling while paused until we have actually acquired one good
  // frame (`!live`). Otherwise, in the caregiver-initiated dual-feed the call is
  // already live the instant this screen mounts, so the freeze would kick in
  // before the feed ever fetched a frame — leaving a permanently BLACK home half
  // (no frame to freeze, offline overlay suppressed, "paused" badge gated on
  // `live`). Acquiring a single frame is a one-shot fetch, not the continuous
  // poll that caused the WebRTC contention, so it's safe during a call. Once the
  // first frame decodes (`live` true) the loop stops and the frame stays frozen.
  const polling =
    phase === "ready" &&
    active &&
    appForeground &&
    pausedReason === null &&
    (!pausedForCall || !live);

  // ── Live refresh loop — runs only while `polling` ───────────────────────────
  // Self-paced: each frame requests the next only once it settles (load, error,
  // or watchdog timeout), so frames never overlap. `tick` is async and `polling`
  // can flip false (background / 10-min cap / emergency ended / unmount) while a
  // fetch is in flight, so an effect-local `cancelled` flag is the only reliable
  // stop signal — clearing the timers alone misses the case where one already
  // fired and we're mid-await, which would otherwise reschedule a fresh loop
  // after cleanup ran and keep costing money.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let frameTimer: ReturnType<typeof setTimeout> | undefined; // per-frame watchdog
    let gapTimer: ReturnType<typeof setTimeout> | undefined; // inter-frame delay
    let frameId = 0; // monotonic id of the in-flight frame
    let settled = false; // has the current frame resolved (load/error/timeout)?
    let frameStartedAt = 0;

    // Pace the NEXT frame. Acts at most once per frame — driven by the image
    // load/error callbacks (via scheduleNextRef) or the watchdog below. The
    // `forId` guard ignores a late settle from a superseded frame so it can't
    // shorten the current frame's interval or clear its watchdog.
    // Self-pacing is the core fix: the old fixed-interval loop fired a new frame
    // every POLL_MS regardless of whether the previous one had returned, so on a
    // slow camera path requests piled up and each new one aborted the previous
    // in-flight fetch — leaving the feed stuck "reconnecting". Now frames never
    // overlap: we only request the next once the current settles.
    const advance = (forId: number) => {
      if (cancelled || forId !== frameId || settled) return;
      settled = true;
      if (frameTimer) clearTimeout(frameTimer);
      // Aim for POLL_MS between frame starts, but never wait less than MIN_GAP_MS
      // so a slow/failed frame (which already consumed most of POLL_MS) retries
      // promptly instead of adding another full interval.
      const elapsed = Date.now() - frameStartedAt;
      const gap = Math.max(MIN_GAP_MS, POLL_MS - elapsed);
      gapTimer = setTimeout(tick, gap);
    };

    const tick = async () => {
      if (cancelled) return;
      const myId = ++frameId;
      settled = false;
      frameStartedAt = Date.now();
      // One watchdog for the WHOLE frame, armed BEFORE the token-mint await so a
      // hang in getReolinkSnapshotSource() (e.g. a stalled getIdToken) can't
      // freeze the loop — it also covers the subsequent <Image> load. If it fires
      // (forId still current), advance paces the next frame so we can't stall.
      frameTimer = setTimeout(() => advance(myId), FRAME_TIMEOUT_MS);
      const src = await getReolinkSnapshotSource(targetUserId);
      // `settled` here means the watchdog already fired during the mint — bail so
      // we don't stomp the next frame's source or arm a duplicate timer.
      if (cancelled || !activeRef.current || settled) return;
      if (!src) {
        advance(myId); // couldn't mint a token — retry after a gap
        return;
      }
      // Same-layer reuse on a failed frame is safe: setLayer*(src) swaps the
      // <Image> source, which aborts any still-in-flight load on that layer, so a
      // superseded frame can't fire a late onLoad/onError. The frameId gate in
      // advance() guards the residual timing windows.
      loadIntoHidden(src, myId);
    };

    scheduleNextRef.current = advance;
    void tick(); // first frame immediately — don't wait a whole interval

    return () => {
      cancelled = true;
      scheduleNextRef.current = null;
      if (frameTimer) clearTimeout(frameTimer);
      if (gapTimer) clearTimeout(gapTimer);
    };
  }, [polling, targetUserId, loadIntoHidden]);

  // ── 10-minute session cap ───────────────────────────────────────────────────
  useEffect(() => {
    if (!polling) return;
    const cap = setTimeout(() => setPausedReason("session"), MAX_SESSION_MS);
    return () => clearTimeout(cap);
  }, [polling]);

  // ── Audit: log each polling session's start/stop (with duration + reason) ───
  // Refs mirror the latest gating state so the cleanup can name WHY a session
  // ended even though its closure captured values from when it started.
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;
  const pausedReasonRef = useRef(pausedReason);
  pausedReasonRef.current = pausedReason;
  const appForegroundRef = useRef(appForeground);
  appForegroundRef.current = appForeground;
  const activePropRef = useRef(active);
  activePropRef.current = active;
  const pausedForCallRef = useRef(pausedForCall);
  pausedForCallRef.current = pausedForCall;

  useEffect(() => {
    if (!polling) return;
    const startedAt = Date.now();
    const actor = userIdRef.current;
    if (actor) {
      logAudit({
        userId: actor,
        action: "reolink_polling_started",
        targetUserId,
        details: "Caregiver started live home-camera polling",
      }).catch(() => {});
    }
    return () => {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      const reason =
        pausedReasonRef.current === "session"
          ? "10-minute session limit"
          : pausedForCallRef.current
            ? "paused for video call"
            : !appForegroundRef.current
              ? "app backgrounded"
              : !activePropRef.current
                ? "emergency ended"
                : "feed closed";
      if (actor) {
        logAudit({
          userId: actor,
          action: "reolink_polling_stopped",
          targetUserId,
          details: `Live home-camera polling stopped after ${durationSec}s (${reason})`,
        }).catch(() => {});
      }
    };
    // Intentionally keyed only on `polling`/`targetUserId`: one start + one stop
    // per polling session, not per gating-state mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, targetUserId]);

  // Pull a single fresh frame without entering the poll loop (manual control).
  const refreshOnce = useCallback(async () => {
    const src = await getReolinkSnapshotSource(targetUserId);
    if (src && activeRef.current) loadIntoHidden(src);
  }, [targetUserId, loadIntoHidden]);

  // Resume after the 10-minute cap (or a manual pause that's still relevant).
  const resume = useCallback(() => {
    setPausedReason(null);
  }, []);

  if (phase === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#51aafa" />
        <Text style={styles.subtle}>Connecting to home camera…</Text>
      </View>
    );
  }

  if (phase === "not_configured") {
    return (
      <View style={styles.center}>
        <Feather name="camera-off" size={44} color="rgba(255,255,255,0.35)" />
        <Text style={styles.title}>No home camera configured</Text>
        <Text style={styles.subtle}>
          The care recipient hasn&apos;t connected a home camera yet.
        </Text>
      </View>
    );
  }

  // Which overlay (if any) sits on top of the last frame. While the phone-camera
  // call is up we deliberately freeze on the last good frame and show ONLY a
  // small badge — never the full session/manual/offline overlays, which would
  // hide the frame and read as an error rather than an intentional pause.
  const showSessionPause = pausedReason === "session" && !pausedForCall;
  const showManualPause = pausedReason === "manual" && !pausedForCall;
  const showOffline =
    !pausedForCall && !showSessionPause && !showManualPause && polling && !live;
  // Only badge once we actually have a decoded frame to freeze — otherwise the
  // initial probe is still loading and we'd be claiming "paused" over an empty
  // frame. While paused the loader for that first frame is fine to show through.
  const showCallPause = pausedForCall && phase === "ready" && live;
  // Paused for a call but we haven't captured the frame to freeze yet (the
  // dual-feed mounts with the call already live). Show a small loader instead of
  // a black panel while the one-shot acquisition fetch is in flight.
  const showCallAcquiring = pausedForCall && phase === "ready" && !live;

  return (
    <View style={styles.fill}>
      {layerA && (
        <Animated.Image
          source={layerA}
          style={[StyleSheet.absoluteFillObject, { opacity: opacityA }]}
          resizeMode="cover"
          onLoad={() => onLayerLoaded("A")}
          onError={() => onLayerError("A")}
        />
      )}
      {layerB && (
        <Animated.Image
          source={layerB}
          style={[StyleSheet.absoluteFillObject, { opacity: opacityB }]}
          resizeMode="cover"
          onLoad={() => onLayerLoaded("B")}
          onError={() => onLayerError("B")}
        />
      )}

      {showSessionPause && (
        <View style={[styles.center, styles.overlay]}>
          <Feather name="pause-circle" size={44} color="rgba(255,255,255,0.55)" />
          <Text style={styles.title}>Live feed paused</Text>
          <Text style={styles.subtle}>
            Paused after 10 minutes to save data. Tap to keep watching.
          </Text>
          <Pressable style={styles.button} onPress={resume}>
            <Feather name="play" size={16} color="#04121f" />
            <Text style={styles.buttonText}>Resume live feed</Text>
          </Pressable>
        </View>
      )}

      {showManualPause && (
        <View style={[styles.center, styles.overlay]}>
          <Feather name="camera" size={44} color="rgba(255,255,255,0.5)" />
          <Text style={styles.title}>Live updates off</Text>
          <Text style={styles.subtle}>
            Continuous streaming runs during emergencies. Tap to grab a fresh
            frame.
          </Text>
          <Pressable style={styles.button} onPress={refreshOnce}>
            <Feather name="refresh-cw" size={16} color="#04121f" />
            <Text style={styles.buttonText}>Refresh</Text>
          </Pressable>
        </View>
      )}

      {showOffline && (
        <View style={[styles.center, styles.overlay]}>
          <Feather name="wifi-off" size={44} color="rgba(255,255,255,0.45)" />
          <Text style={styles.title}>Home camera offline</Text>
          <Text style={styles.subtle}>Trying to reconnect…</Text>
        </View>
      )}

      {showCallAcquiring && (
        <View style={[styles.center, styles.overlay]}>
          <ActivityIndicator size="small" color="#51aafa" />
          <Text style={styles.subtle}>Loading home camera…</Text>
        </View>
      )}

      {showCallPause && (
        <View style={styles.callPauseWrap} pointerEvents="none">
          <View style={styles.callPauseBadge}>
            <Feather name="pause" size={12} color="#fff" />
            <Text style={styles.callPauseText}>Paused during video call</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: "100%", height: "100%" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 10 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,14,28,0.85)" },
  title: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  subtle: { color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center", lineHeight: 19 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: "#22FF6E",
  },
  buttonText: { color: "#04121f", fontSize: 14, fontWeight: "700" },
  callPauseWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: "center",
  },
  callPauseBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(10,14,28,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  callPauseText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
