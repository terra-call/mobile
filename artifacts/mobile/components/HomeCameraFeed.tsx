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
// State machine:
//   loading        → initial probe in flight
//   not_configured → recipient hasn't set up a Home Camera (404) → stop polling
//   ready          → polling; `live` tracks whether the last frame loaded
// ─────────────────────────────────────────────────────────────────────────────

import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getReolinkSnapshotSource } from "@/services/reolink";

const POLL_MS = 1500;
// Cross-fade duration when swapping to a freshly-loaded frame. Short enough to
// feel live, long enough to hide the hard cut between JPEGs.
const FADE_MS = 280;
// The snapshot proxy logs in then grabs a frame (each step up to ~8s server
// side), so a single probe can legitimately take several seconds — but it must
// never hang forever. Abort a stalled probe and retry a couple of times before
// falling back to the self-healing "offline" state.
const PROBE_TIMEOUT_MS = 12000;
const PROBE_RETRIES = 2;
const PROBE_RETRY_DELAY_MS = 1500;

type Phase = "loading" | "not_configured" | "ready";
type Source = { uri: string; headers: Record<string, string> };

export function HomeCameraFeed({ targetUserId }: { targetUserId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [live, setLive] = useState(false);
  const activeRef = useRef(true);

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

  // Load the next frame into whichever layer is currently hidden.
  const loadIntoHidden = useCallback((src: Source) => {
    if (visibleRef.current === "A") setLayerB(src);
    else setLayerA(src);
  }, []);

  // Cross-fade to a layer once its image has finished loading.
  const onLayerLoaded = useCallback(
    (layer: "A" | "B") => {
      if (!activeRef.current) return;
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
  const onLayerError = useCallback(() => {
    if (!activeRef.current) return;
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
  }, [targetUserId]);

  // ── Live refresh loop (only once we know a camera exists) ───────────────────
  useEffect(() => {
    if (phase !== "ready") return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const src = await getReolinkSnapshotSource(targetUserId);
      if (!activeRef.current) return;
      if (src) loadIntoHidden(src);
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => clearTimeout(timer);
  }, [phase, targetUserId]);

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

  return (
    <View style={styles.fill}>
      {layerA && (
        <Animated.Image
          source={layerA}
          style={[StyleSheet.absoluteFillObject, { opacity: opacityA }]}
          resizeMode="cover"
          onLoad={() => onLayerLoaded("A")}
          onError={onLayerError}
        />
      )}
      {layerB && (
        <Animated.Image
          source={layerB}
          style={[StyleSheet.absoluteFillObject, { opacity: opacityB }]}
          resizeMode="cover"
          onLoad={() => onLayerLoaded("B")}
          onError={onLayerError}
        />
      )}
      {!live && (
        <View style={[styles.center, styles.overlay]}>
          <Feather name="wifi-off" size={44} color="rgba(255,255,255,0.45)" />
          <Text style={styles.title}>Home camera offline</Text>
          <Text style={styles.subtle}>Trying to reconnect…</Text>
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
});
