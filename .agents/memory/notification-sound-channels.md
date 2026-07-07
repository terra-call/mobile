---
name: Notification sound + Android channels
description: Durable gotchas for custom notification sounds and Android channels in the Expo app.
---

# Custom notification sound + Android notification channels

- A custom notification sound is a NATIVE change: the `.wav` is bundled via the
  `expo-notifications` config-plugin `sounds` array in `app.json`, so it only
  ships in a fresh `eas build` (bump `expo.version` per the appVersion runtime
  rule) — NOT via `eas update` OTA. Sound file must be `.wav` (iOS needs
  PCM/CAF/AIFF/WAV; keep <30s). Reference it by filename WITH extension in both
  the plugin and the Android channel `sound`.

- **Android locks a channel after first creation on a device.** Once a channel
  id exists, its sound/importance/bypassDnd are frozen — calling
  `setNotificationChannelAsync` again with new values is a no-op until the user
  edits it in system settings OR you use a NEW channel id. So to change a
  channel's sound/importance later, bump the channel id.
  **Why:** Android platform behavior; silent no-op is easy to mistake for a bug.

- Push routing: the Expo push payload's `channelId` selects which Android
  channel governs sound/importance/DND. iOS ignores `channelId` and uses the
  push `sound` field (UNNotificationSound). So channel ids MUST stay in sync
  between client (`NOTIFICATION_CHANNELS`) and server (`PUSH_CHANNELS`).

- **iOS silent/DND override needs Apple's critical-alerts entitlement**
  (`com.apple.developer.usernotifications.critical-alerts`, request + approval
  from Apple, then declared in app.json). Sending `sound: {critical:true,...}`
  WITHOUT the entitlement gets the push rejected/downgraded by APNs — keep the
  `IOS_CRITICAL_ALERTS_ENABLED` flag false until granted. Android DND override
  works today via an `emergencies` channel with `bypassDnd:true` (needs
  `ACCESS_NOTIFICATION_POLICY` perm + user granting DND access).

- Terra Call channels: `incoming_calls` (HIGH, custom tone, respects DND),
  `emergencies` (MAX, custom tone, bypassDnd — I'M NOT OK + escalation),
  `alerts` (HIGH, default sound, respects DND — missed check-in). Placeholder
  tone `terra_call_alert.wav` is flagged for Mike's branded swap before launch.
