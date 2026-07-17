---
name: Android maps crash (no Google Maps API key)
description: Rendering react-native-maps MapView on Android without a Google Maps API key hard-crashes the app natively; key is injected via app.config.js + EAS env.
---

- Rendering `react-native-maps` `MapView` on Android without
  `android.config.googleMaps.apiKey` crashes the app natively ("Terra Call
  closed because this app has a bug") — no JS error boundary can catch it.
  iOS uses Apple Maps and needs no key.
- **Current state (July 2026):** key configured. `app.config.js` (dynamic
  config over `app.json`) injects `GOOGLE_MAPS_ANDROID_API_KEY` from env and
  sets `extra.androidMapsKeyConfigured`. `MapDisplay.native.tsx` gates on that
  flag: Android binaries built WITHOUT the key still get the list fallback
  instead of crashing. The key lives in the EAS `preview` environment
  (`eas env`) and as a Replit secret — NOT in the repo.
- **Why dynamic config:** app.json is static; the key must not be committed.
  EAS builds resolve app.config.js remotely, so the env var must exist in the
  matching EAS environment (`eas env:create ... --force` to update).
- An OTA update alone can NOT add the key — it requires a fresh native build
  (and the runtime bump rule: bump `expo.version` for native config changes).
- Google Cloud key is API-restricted to Maps SDK for Android; application
  restriction left at None until tightened post-verification.
