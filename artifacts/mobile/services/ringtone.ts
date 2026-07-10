// In-app LOOPING ringtone for incoming calls (both directions).
//
// This is deliberately SEPARATE from the one-shot push-notification sound
// (see notifications.ts / notificationScheduler.ts TERRA_CALL_ALERT_SOUND).
// The push sound covers the locked / backgrounded / killed wakeup case — it is
// a single ~4s chime the OS plays when the notification is delivered. THIS
// service is what makes the phone actually "ring": a sustained, looping tone
// played while an incoming call is being surfaced to the callee, regardless of
// whether the app is in the foreground (where the notification sound is
// unreliable / not a ringtone).
//
// Directions covered:
//   • recipient → caregiver : caregiver's IncomingCallModal starts/stops this
//     as its `incoming` state toggles.
//   • caregiver → recipient : the recipient's camera_activate handlers start it
//     right before navigating into camera-stream; camera-stream stops it once
//     the call connects (or fails) and on unmount.
//
// PLACEHOLDER TONE — same asset as the push sound; swap for Mike's branded
// audio before launch.  >>> BRANDED ASSET NEEDED FROM MIKE <<<
//   Asset path: artifacts/mobile/assets/sounds/terra_call_alert.wav
import { Platform } from "react-native";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";

// Safety cap — a ringtone must never loop forever if a stop() path is missed
// (unexpected unmount, navigation blocked, etc). Auto-stops after this long.
const MAX_RING_MS = 45_000;

let player: AudioPlayer | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let audioModeConfigured = false;
// Desired-state latch. `startRingtone()` awaits (audio-mode config + player
// creation), so a fast Answer/Decline can call `stopRingtone()` while a start
// is still in flight. Every `await` boundary re-checks this flag and bails if a
// stop happened meanwhile — otherwise the ring would leak until the safety cap.
let wantRinging = false;

// Alarm-style audio session so the ringtone is audible like a real incoming
// call. On iOS `playsInSilentMode` pierces the hardware mute switch / silent
// mode. On Android media playback rides the media volume stream (independent of
// the ringer), so a silenced ringer still rings. Configured once, lazily.
async function configureAudioModeOnce(): Promise<void> {
  if (audioModeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
    });
    audioModeConfigured = true;
  } catch {
    // Non-fatal — playback still attempts under the default audio mode.
  }
}

// Start the looping ringtone. Idempotent: the push and Firestore delivery paths
// may both fire for the same call, so a second call while already ringing is a
// no-op rather than stacking players.
export async function startRingtone(): Promise<void> {
  if (Platform.OS === "web") return;
  wantRinging = true;
  if (player) return;

  await configureAudioModeOnce();
  // A stop() (Answer/Decline/unmount) may have landed during the await above —
  // bail before creating a player we'd immediately have to tear down.
  if (!wantRinging) return;

  let created: AudioPlayer;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    created = createAudioPlayer(require("../assets/sounds/terra_call_alert.wav"));
  } catch {
    return;
  }

  // Re-check after the (possibly async) create: if we're no longer wanted, or
  // another start already installed a player, release this one and stop.
  if (!wantRinging || player) {
    try {
      created.remove();
    } catch {
      // ignore
    }
    return;
  }

  player = created;
  try {
    player.loop = true;
    player.volume = 1.0;
    player.play();
  } catch {
    stopRingtone();
    return;
  }

  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(() => {
    stopRingtone();
  }, MAX_RING_MS);
}

// Stop and fully release the ringtone. Safe to call when nothing is playing
// (used defensively by camera-stream for the caller side, where no ring ever
// started).
export function stopRingtone(): void {
  // Clear the desire first so any start() still in flight bails at its next
  // await/re-check boundary.
  wantRinging = false;
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch {
    // ignore — player may already be released
  }
  player = null;
}
