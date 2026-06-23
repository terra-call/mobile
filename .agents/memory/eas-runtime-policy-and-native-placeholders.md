---
name: EAS appVersion runtime policy + Twilio native-module placeholder semantics
description: Why a native module can be in the APK yet report unavailable, and what the camera-stream placeholder actually means
---

## appVersion runtimeVersion policy is a footgun for native changes
With `runtimeVersion.policy = "appVersion"`, the runtime stays constant (e.g. "1.0.0")
even when native dependencies change. EAS will then serve an OTA JS bundle to a build
whose native layer does NOT match it. Result: native `require()` throws at JS init,
or expo-updates silently rolls back to the embedded bundle (so a shipped OTA "doesn't
take effect").

**Why:** OTA compatibility is keyed only on runtimeVersion. appVersion ignores native
fingerprint, so JS and native binary can drift while still being considered compatible.

**How to apply:** when an OTA "isn't picked up" or a bundled native module reports
missing on-device, suspect JS↔native drift first. Prefer the `fingerprint` policy
(SDK 52+) or bump runtimeVersion manually whenever native deps/config change, so
incompatible OTAs are never delivered to an old build. The clean fix for a drifted
device is a fresh EAS build from current HEAD (native + JS from the same commit);
that also embeds the latest JS so OTA delivery isn't even required.

## camera-stream "Run an EAS dev build" placeholder ⇔ SDK require() failed
In `app/camera-stream.tsx`, the "Live Stream Ready / Run an EAS dev build…" placeholder
is the final fallback shown ONLY when `isTwilioVideoAvailable === false` — i.e. the
guarded `require("@twilio/video-react-native-sdk")` (in `services/twilioVideo.ts`)
threw. Token-mint failures and room-connect failures both set `tokenError` and show a
DIFFERENT "Video unavailable" screen. So that placeholder always means a JS↔native SDK
loading problem, never a credentials/room problem. (Corollary: if you see the
placeholder, the token mint already succeeded.)

## Twilio Video needs API Key creds, not the Auth Token
The video token route mints with `AccessToken` + `VideoGrant` using
TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (plus TWILIO_ACCOUNT_SID). The account
Auth Token CANNOT mint Video grants. These API-key secrets must exist in the
**production deployment** env, separate from dev.

## Inspecting whether a native module is really in an APK
Download the EAS `buildUrl` (it's a zip) and `unzip -l app.apk | grep -i '\.so'`.
Twilio Video shows as `libtwilio_video_android_so.so` (~16MB).
