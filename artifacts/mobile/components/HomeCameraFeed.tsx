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

type Phase = "loading" | "not_configured" | "ready";
type Source = { uri: string; headers: Record<string, string> };

export function HomeCameraFeed({ targetUserId }: { targetUserId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [source, setSource] = useState<Source | null>(null);
  const [live, setLive] = useState(false);
  const activeRef = useRef(true);

  // ── Initial probe — distinguish "not configured" (404) from "offline" ───────
  useEffect(() => {
    activeRef.current = true;
    (async () => {
      const src = await getReolinkSnapshotSource(targetUserId);
      if (!activeRef.current) return;
      if (!src) {
        setPhase("ready");
        setLive(false);
        return;
      }
      try {
        const res = await fetch(src.uri, { headers: src.headers });
        if (!activeRef.current) return;
        if (res.status === 404) {
          setPhase("not_configured");
          return;
        }
        setSource(src);
        setLive(res.ok);
        setPhase("ready");
      } catch {
        if (activeRef.current) {
          setPhase("ready");
          setLive(false);
        }
      }
    })();
    return () => {
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
