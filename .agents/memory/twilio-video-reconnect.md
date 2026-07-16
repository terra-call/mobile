---
name: Twilio Video reconnect + Reolink contention
description: Non-obvious Twilio Video event semantics and the dual-feed media-starvation drop on the caregiver camera-stream screen
---

# Caregiver dual-feed: phone camera drops ~30s into a call

On the caregiver `camera-stream.tsx` (mode=`view`) screen the Twilio WebRTC
"phone camera" connects, then drops ~30s in — exactly when the Reolink
`HomeCameraFeed` begins its continuous full-frame JPEG poll on the SAME device.

**Cause:** media-path starvation, not token TTL (that's 3600s) and not a
remount. The home-camera poller downloads a full-res JPEG (unique cache-bust
URL + `no-store`, so nothing is cached) into two retained `<Image>` layers while
WebRTC media runs on the same device; the sustained bandwidth/decode load
starves WebRTC and Twilio fires `onRoomDidDisconnect`.

**Why it stayed dead:** there was no auto-reconnect — the disconnect handler just
flipped state to "not connected".

**How to apply / fixes that matter here:**
- **A gentle poll cadence is NOT enough — on a real iOS device the home feed
  still drops the instant Twilio media goes live and stays stable for 1+ min once
  it stops. The contention is real and severe.** Resolution: fully PAUSE the
  Reolink poll loop for the duration of the phone-camera call (freeze the last
  good frame, show a small "paused" badge — never the offline overlay), and
  auto-resume when the call ends/fails. Pause is driven by a `pausedForCall` prop
  threaded from `camera-stream` (true while `connecting || roomConnected`, and
  crucially FALSE on `tokenError` so a failed call still leaves a live home view).
  The slow `POLL_MS` is now only a secondary guard for the brief windows the feed
  polls outside an active call.
- Auto-reconnect on unexpected drop using the still-valid access token
  (`accessTokenRef`), bounded attempts + exponential backoff. (Less load-bearing
  now that polling pauses during the call, but kept for transient network drops.)
- **`pausedForCall` must NOT block the FIRST frame.** The caregiver-initiated
  dual-feed (`emergency-call` → `camera-stream`) mounts with the Twilio call
  already live, so `pausedForCall` (= `connecting || roomConnected`) is true from
  frame zero. If the poll gate is a bare `!pausedForCall`, the home feed freezes
  before it ever fetched anything → permanent BLACK panel (offline overlay
  suppressed by the pause, "paused" badge gated on `live` which never flips). Gate
  must be `(!pausedForCall || !live)`: keep polling while paused until ONE good
  frame is acquired, then freeze on it. A single acquisition fetch is not the
  continuous poll that caused contention, so it's safe mid-call. The recipient
  "I'M NOT OK" path is immune because it renders `HomeCameraFeed` in
  `EmergencyCameraModal` with no `pausedForCall`.

# Twilio Video event-model facts (cost us diagnosis time)

- **A remote participant hang-up does NOT fire `onRoomDidDisconnect` on the
  viewer side — it fires `onRoomParticipantDidDisconnect`** (remote track is
  removed → "Waiting for…" placeholder). `onRoomDidDisconnect` means *your own*
  connection to the room was lost. So auto-reconnecting on `onRoomDidDisconnect`
  is safe — it won't churn on normal call ends.
- **`twilioRef.connect()` returns before the rejoin outcome is known.** A failed
  rejoin surfaces later via `onRoomDidFailToConnect`, NOT as a return value. So a
  bounded auto-reconnect loop must chain the next backoff attempt from BOTH
  `onRoomDidDisconnect` (the initial drop) and `onRoomDidFailToConnect` (a failed
  rejoin) — feeding both into one shared `scheduleReconnect`. Driving retries
  only from the disconnect handler yields just ONE real retry.
- **The INITIAL connect failure must also retry** via the same bounded backoff —
  a transient "Signaling connection error" right at camera activation was
  previously terminal and showed "Video unavailable" for a momentary network blip.
- Reset the reconnect attempt budget in `onRoomDidConnect` (success), and guard
  every reconnect path with a `disconnectedRef` flag set by both End Stream and
  the unmount cleanup, so a teardown disconnect can't reconnect/setState on an
  unmounting screen.
