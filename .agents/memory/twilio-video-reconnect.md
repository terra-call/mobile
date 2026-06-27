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
- Keep the home-camera poll cadence gentle while a call can be concurrent
  (`POLL_MS` is intentionally ≥2.5s, not a true ~1.5s video rate).
- Auto-reconnect on unexpected drop using the still-valid access token
  (`accessTokenRef`), bounded attempts + exponential backoff.

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
- Reset the reconnect attempt budget in `onRoomDidConnect` (success), and guard
  every reconnect path with a `disconnectedRef` flag set by both End Stream and
  the unmount cleanup, so a teardown disconnect can't reconnect/setState on an
  unmounting screen.
