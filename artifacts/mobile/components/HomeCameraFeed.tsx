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
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { getReolinkSnapshotSource } from "@/services/reolink";

const POLL_MS = 1500;
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
  const [source, setSource] = useState<Source | null>(null);
  const [live, setLive] = useState(false);
  const activeRef = useRef(true);

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
        setSource(src);
        setLive(res.ok);
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
      if (src) setSource(src);
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
      {source && (
        <Image
          source={source}
          style={styles.fill}
          resizeMode="cover"
          onLoad={() => activeRef.current && setLive(true)}
          onError={() => activeRef.current && setLive(false)}
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
