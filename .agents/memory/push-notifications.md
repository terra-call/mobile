---
name: Push notifications (Terra Call)
description: Why incoming-call wakeups need push, and the Android standalone FCM requirement
---

# Push wakeup is required for BOTH call directions

Firestore `onSnapshot` listeners pause when the app is backgrounded or closed.
So a `cameraActivations` signal doc alone only rings devices that are
foregrounded. Every call direction (caregiver→recipient and recipient→caregiver)
must ALSO send an Expo push to wake the target device, or the caller hits the
~45s timeout with "No answer".

**Why:** chased a "No answer" bug for many turns — signal doc wrote fine, but the
target device's listener wasn't subscribed because the app was backgrounded.

**How to apply:** any new realtime-signaled flow that must reach a closed app
needs a best-effort push wakeup alongside the Firestore write. Target token is
resolved server-side from Firestore (`users/<uid>.expoPushToken`), never from the
caller. Keep push best-effort (try/catch) so send failures never break signaling.

# Android standalone APK push needs FCM credentials uploaded to EAS

On Android, an installed APK (not Expo Go) will NOT receive Expo pushes until the
**FCM V1 service account JSON** is uploaded to the EAS project credentials. This
is server-side (Expo's push service signs with it) — uploading does NOT require
rebuilding the APK; existing installs start receiving pushes immediately.

**Gotchas:**
- The correct file is the Firebase **service account** key
  (Firebase Console → Project Settings → Service accounts → Generate new private
  key). It contains `"type":"service_account"` + `"private_key"`. It is NOT
  `google-services.json`. Uploading the wrong file gives Expo error
  `"private_key": Required`.
- `google-services.json` (in repo, wired via `android.googleServicesFile`) only
  handles the device-side FCM registration; it is necessary but not sufficient.
- Without FCM creds, `registerForPushNotifications` can fail silently
  ("Default FirebaseApp is not initialized") and no token saves to Firestore.

# PHI hygiene for push

Lock-screen-visible title/body must be generic with NO names ("Incoming Call" /
"Tap to answer"). Names go in the `data` payload only (delivered silently, shown
by the app once unlocked). SMS bodies may contain names but are gated by
`smsConsent` per recipient.
