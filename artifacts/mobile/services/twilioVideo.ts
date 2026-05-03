// TWILIO VIDEO — guarded SDK loader
// ─────────────────────────────────────────────────────────────────────────────
// `@twilio/video-react-native-sdk` is a native module: it ships native iOS and
// Android code that only exists inside a custom EAS dev build. Inside Expo Go
// (used during day-to-day development) the native code is missing and a plain
// top-level `import` would crash the entire JS bundle at load time — bricking
// every screen, not just camera-stream.
//
// To keep dev-server iteration alive while the production EAS build still
// gets the real SDK, we wrap the module load in a try/catch that:
//   • skips loading entirely on web (no native module ever),
//   • catches the "RNTwilioVideo native module not found" error in Expo Go,
//   • exports `isTwilioVideoAvailable` as the single feature flag the rest
//     of the app keys off of.
//
// Components MUST check `isTwilioVideoAvailable` before rendering any of
// the exported `TwilioVideo*` views. When the flag is false the components
// are null at runtime and rendering them would throw.
// ─────────────────────────────────────────────────────────────────────────────

import { Platform } from "react-native";
import type {
  TrackEventCb,
  TrackErrorEventCb,
  RoomEventCb,
  RoomErrorEventCb,
  ParticipantEventCb,
  TrackIdentifier,
} from "@twilio/video-react-native-sdk";

type TwilioVideoModule = typeof import("@twilio/video-react-native-sdk");

let mod: TwilioVideoModule | null = null;
let loadError: string | null = null;

if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("@twilio/video-react-native-sdk") as TwilioVideoModule;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "unknown require error";
    mod = null;
  }
}

/**
 * True only inside a custom EAS dev/production build that includes the
 * native Twilio Video module. Always false on web and in Expo Go.
 */
export const isTwilioVideoAvailable = mod !== null;

/** Diagnostic — surfaced in audit logs when the SDK is missing. */
export const twilioVideoLoadError = loadError;

/** The imperative `<TwilioVideo />` component class, or null in Expo Go/web. */
export const TwilioVideo = mod?.TwilioVideo ?? null;

/** Local-camera preview view, or null in Expo Go/web. */
export const TwilioVideoLocalView = mod?.TwilioVideoLocalView ?? null;

/** Remote-participant video view, or null in Expo Go/web. */
export const TwilioVideoParticipantView = mod?.TwilioVideoParticipantView ?? null;

// Re-export the callback / event types so components can type their handlers
// without importing directly from the native package (keeps the guard
// boundary single-sourced through this module).
export type {
  TrackEventCb,
  TrackErrorEventCb,
  RoomEventCb,
  RoomErrorEventCb,
  ParticipantEventCb,
  TrackIdentifier,
};
