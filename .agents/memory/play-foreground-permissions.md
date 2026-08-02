---
name: Play Console foreground-service permissions
description: Twilio SDK injects unused foreground-service permissions; block them instead of declaring
---

The Twilio video RN SDK's Android manifest adds FOREGROUND_SERVICE_MEDIA_PROJECTION (and media playback surfaces too), which triggers Play Console's "Foreground service permissions" declaration form demanding demo videos.

**Why:** The app never screen-shares or plays background media — declaring unused permissions with fake videos risks rejection.

**How to apply:** `android.blockedPermissions` in app.json lists FOREGROUND_SERVICE_MEDIA_PROJECTION and FOREGROUND_SERVICE_MEDIA_PLAYBACK. Removing/blocking manifest permissions requires a new native AAB (done: versionCode 3), not OTA. Permission-only manifest changes don't need an expo.version bump (JS unchanged, runtime stays compatible).
