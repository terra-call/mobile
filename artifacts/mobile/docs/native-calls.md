# Native incoming calls — release checklist

This change integrates CallKit/PushKit (iOS) and managed Telecom
ConnectionService plus high-priority FCM data messages (Android) with the
existing Firestore call records and Twilio Video screen. It is **not release
verified** until tested in native binaries on physical devices.

## Configuration

- Expo SDK 54 remains unchanged. CallKeep's Expo plugin is pinned to its SDK 54
  release. Bundle/package identifiers are unchanged.
- The next app version/runtime is **1.6.1**, distinct from the existing 1.5.0
  binaries. Never publish this native feature as an OTA to the old runtime.
- Android now compiles and targets API 36 (Android 16), supported by the existing
  Expo SDK 54 / React Native 0.81 stack. Version 1.6.1 follows the already
  uploaded 1.6.0 iOS candidate; changing source does not replace that upload.
  Test Android 16 edge-to-edge layouts and native calling on physical devices.
  Google Play requires a new AAB with an incremented version code; an APK is
  suitable for direct device testing but does not resolve the production warning.
- iOS uses `UIBackgroundModes: audio, voip`, CallKit and PushKit. PushKit uses
  the existing Push Notifications/`aps-environment` capability; there is no
  standalone general-purpose "PushKit entitlement" to add.
- The push-enabled distribution provisioning profile must match the bundle
  identifier and Apple team. Distribution signing must produce
  `aps-environment=production`, explicitly selected in app.json for the
  existing internal/distribution profiles; verify the **signed archive**
  before distribution.
- EAS's existing production profile keeps local signing, its production
  channel, and automatic build-number increment. No build or submission was
  triggered by this implementation.
- All existing internal/distribution profiles use the production APNs
  endpoint. If using a locally development-signed Xcode binary, change
  `extra.nativeCallApnsEnvironment` to `sandbox` and the APS entitlement to
  `development` for that test binary.
- Associated Domains is unrelated to CallKit and was not changed.
- Android adds a managed phone account, phone-call foreground service
  permission, phone state/number permissions and `MANAGE_OWN_CALLS`.
  Users must enable the Terra Call calling account and allow microphone and
  notification access. The system dialer owns incoming call presentation;
  the application does not request its own full-screen-intent permission.
- Android's native Firebase project is FCM-only (`terra-call-fcm`).
  JS Firebase Auth and Firestore continue using the original project.
- Ordinary Expo notification delivery is preserved through the Expo
  Firebase messaging service; native-call data is filtered from that pipeline.
- Native-call device registration follows the current product's
  **one device token per account** model, not a multi-device ring group.

## Server credentials (server only)

`APNS_AUTH_KEY_P8`, `APNS_KEY_ID` and `FCM_SERVICE_ACCOUNT_JSON` are required.
The APNs key must have push permission for the existing Apple team/bundle;
an App Store Connect API key is not interchangeable. The FCM service account
must belong to `terra-call-fcm` and have permission to send FCM v1 messages.
Never place these in Expo `extra`, `EXPO_PUBLIC_*`, native resources or Git.

Credential presence is not proof of validity: verify successful provider
delivery with registered real-device tokens. Provider errors are logged
without keys, tokens or response bodies containing sensitive material.

## Before creating a native candidate

1. Review and publish the updated `firestore.rules` to the existing
   Auth/Firestore project. Native callee Answer/Decline and participant
   hang-up require the new narrowly scoped state transitions. The
   implementation does **not** publish rules automatically.
2. Publish the API server changes, with the three server secrets available
   to that deployment. This implementation does **not** publish automatically.
3. Review the app version, push-enabled signing profile, APNs team/bundle and
   Android FCM project match. Reconfirm the US-only storefront selection.
4. Create native test candidates through the publishing/build workflow only
   after user approval. Expo Go and browser previews cannot test CallKit,
   PushKit, Telecom or real Twilio media.

## Required device matrix

Test **both call directions** on physical iPhone and Android devices:

- Foreground, background, lock screen and app process not running.
- Android swipe-away versus explicit Settings **Force stop** (delivery after
  explicit force-stop is not supported until the user launches the app).
- Answer, Decline, caller cancellation, unanswered timeout, remote hang-up,
  immediate answer during cold start and duplicate Firestore/push delivery.
- Cold-start auth restoration, logout/account switch, denied/revoked phone,
  microphone, camera and notification permissions.
- Two-way audio, system mute, Bluetooth/speaker routing, interruption by an
  ordinary phone call, and locking/unlocking during an established call.
- Offline phone and reconnect: stale incoming calls must not ring later.
- A routine alert and an emergency alert still reach Expo listeners.
- Legacy 1.5.0 binary compatibility when native device registration is absent.

OS rules apply: unlocked/foreground presentation may be a banner instead of
full-screen; Do Not Disturb is respected; camera capture cannot bypass an
iOS lock screen or denied permission. The native Answer action updates the
call and waits for foreground/unlock before opening the camera permission
and Twilio flow.

## Local checks

`node artifacts/mobile/scripts/test-native-calls.cjs` checks JS state and
provider payload contracts using fake credentials only. Successful Expo
prebuild checks generated native configuration, **not** native compilation
or delivery. iOS signing, native compilation and the device matrix remain
release gates.
