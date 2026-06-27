---
name: Reolink pseudo-live home-camera feed
description: How the caregiver's "live" Reolink feed works (snapshot polling, not a real stream) and the invariants that keep it from flapping
---

# It is snapshot polling, not a real video stream

The caregiver "live" home-camera view is a fast loop of still JPEG snapshots
pulled from the api-server (`/api/reolink/...`), cross-faded between two `<Image>`
layers (A/B double-buffer) to look like video. There is no RTSP/WebRTC stream for
the home camera. It runs on the same caregiver screen as a Twilio phone-camera
call, so both compete for the device's network.

# The flapping bug (2-min connect + drop-after-2s reconnect loop)

**Why:** the camera port-forward is intermittently slow (healthy snapshot ~900ms;
degraded = "unreachable" ~8s then 502). Two code bugs amplified that into a loop:
1. Server double-waited two schemes (https then http, ~8s each = ~16s per failed
   snapshot), so first-frame latency stacked into minutes.
2. Client polled on a FIXED interval — it fired a new frame every POLL_MS whether
   or not the previous returned. On a slow path requests piled up, and each new
   `<Image>` source ABORTED the previous in-flight fetch (the `request aborted
   statusCode:null` log spam), so `live` never latched true → offline-overlay loop.

# Invariants that fix it (keep these)

- **Server fast-fail:** on `Error("timeout")` from login/snap, `break` the scheme
  loop — do NOT fall back to the other scheme. Fallback is only worth it for
  non-timeout protocol errors. Timeout means the port is dead right now; waiting
  the second scheme just doubles the dwell.
- **Client loop must be SELF-PACED, not fixed-interval.** Request the next frame
  only after the current one SETTLES (image onLoad / onError / a per-frame
  watchdog). This is the core fix — it makes frames strictly serial so they can
  never pile up or abort each other.
- **Settlement needs frame identity.** A single mutable `settled` flag is not
  enough: a late onLoad/onError from a superseded frame can settle the current
  one. Gate with a monotonic `frameId` (`advance(forId)` returns unless
  `forId === frameId && !settled`).
- **Arm the per-frame watchdog BEFORE the token-mint await,** not after the image
  is handed to a layer — otherwise a hang in token minting (`getIdToken`) freezes
  the loop with no fallback. After the await, bail if `settled` (watchdog already
  fired) so you don't stomp the next frame.
- **Pace by start time:** `gap = max(MIN_GAP_MS, POLL_MS - elapsed)` computed from
  the frame's start. This keeps cadence ~POLL even if a settle fires early, so an
  early/spurious settle cannot shorten the interval into an overlap.

# Known benign residual (do not chase with per-request nonces)

On a load FAILURE the visible layer does not flip, so the retry reuses the same
hidden layer and overwrites that layer's recorded frameId. An abort-driven
`onError` (from swapping the source on a still-loading layer after a watchdog
fire) can then read the new id and settle the next frame early. It is **benign**:
because gap is computed from start time it reschedules at ~POLL (same cadence, no
concurrent fetch, no stall). RN `<Image>` has ONE handler per element that always
reflects the latest source, so a per-request nonce captured in JSX can't actually
distinguish the abort either — the only airtight fix (`key={frameId}` to remount
per frame) reintroduces per-frame blank flicker and defeats the double-buffer.
Not worth it.

# Two network legs — know which one a fix actually helps

The snapshot crosses TWO legs: (1) camera → api-server, which rides the
recipient's HOME-INTERNET UPLOAD through a forwarded port — this is the slow,
flappy bottleneck; and (2) api-server → caregiver tablet (egress). They are
independent.
- **Server-side JPEG downscale** (sharp resize→720w q55 in routes/reolink.ts,
  best-effort with try/catch fallback to original bytes) only shrinks leg 2. It
  lowers egress/decode pressure on the tablet but does NOTHING for the slow leg 1.
- **The lever for leg 1 is fewer/less-overlapping requests** — i.e. a longer
  `POLL_MS` (raised to 5000) and the self-paced serial loop above. Do not expect
  server downscale to fix camera→server slowness.

# Delivery

Client (HomeCameraFeed.tsx / EmergencyCameraModal.tsx / emergency-call.tsx)
changes are JS-only → ship via `eas update` (OTA), no version bump. Server
(reolink.ts / reolinkClient.ts) changes only reach the tablet after a REDEPLOY —
the tablet hits the deployed api-server via `EXPO_PUBLIC_API_URL`, not the dev
workflow. Note `sharp` is a native dep on the api-server; it works on Replit
deploy (same Nix env as dev).

# Phone camera from the emergency modal (one-tap, not auto)

EmergencyCameraModal shows the home (Reolink) feed + a full-width "Connect Phone
Camera" button. It does NOT auto-connect Twilio — running the Reolink poll AND a
Twilio call at once competes for device bandwidth (the contention that dropped the
feed), so the phone camera is gated behind an explicit tap. The button reuses the
tested path: `onDismiss()` then `router.push('/emergency-call', {autoStart:"1"})`,
and emergency-call's run-once effect fires `startVideoCall()` (consent → activate
→ `router.replace('/camera-stream')` dual feed). **Why:** avoids duplicating the
event/audit/consent/activation logic that already lives in startVideoCall.
