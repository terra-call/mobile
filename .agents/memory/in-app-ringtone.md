---
name: In-app looping ringtone
description: Why incoming calls need an in-app audio loop separate from the push sound, and the start/stop race it must guard
---

# In-app ringtone vs push notification sound

Terra Call has NO CallKit — incoming calls are Expo push + in-app UI. The push
notification `sound` is a one-shot ~4s chime; it does NOT ring, and in the
foreground it's unreliable. So a real "ringtone" requires an **in-app audio
loop** (`expo-audio`) that plays while the incoming-call UI is up, kept
SEPARATE from the push sound (which still covers the locked/backgrounded
wakeup). Both must exist; they solve different delivery states.

**Two ring sites (asymmetric flows):**
- recipient→caregiver: caregiver's `IncomingCallModal` — ring keyed on the
  `incoming` state (Answer/Decline/recipient-cancel all null it out).
- caregiver→recipient: recipient has NO modal — it auto-navigates into
  `camera-stream` (publish). Start the ring in the activation handlers (push +
  Firestore) *before* the navigation; `camera-stream` stops it when `connecting`
  flips false (connected/failed) and on unmount. A **singleton** service
  survives the navigation; the caller side never starts a ring so its stop() is
  a harmless no-op.

**Why:** the requirement was "ring in both directions," but the two directions
use different UIs (modal vs direct nav), so the ring can't live in one component.

# The async start/stop race (must guard)

`startRingtone()` awaits (audio-mode config + player create). A fast
Answer/Decline calls `stopRingtone()` while the start is still in flight; the
`if (player) return` guard misses because `player` isn't set yet, so the ring
starts anyway and leaks until the safety cap. **Fix:** a module-level
`wantRinging` desired-state latch — `stop()` clears it first; `start()` re-checks
it after every await and bails/releases if it went false. Also re-check
`!player` after create to coalesce concurrent starts. Always keep a max-duration
safety auto-stop as a backstop.

**How to apply:** any singleton media/loop with async setup + a sync stop needs
a desired-state flag checked past each await — a null-object guard alone races.
