---
name: Android maps crash (no Google Maps API key)
description: Rendering react-native-maps MapView on Android without a Google Maps API key hard-crashes the app natively; Android is currently guarded to a list fallback.
---

- Rendering `react-native-maps` `MapView` on Android without
  `android.config.googleMaps.apiKey` in `app.json` crashes the app natively
  ("Terra Call closed because this app has a bug") — no JS error boundary can
  catch it. iOS uses Apple Maps and needs no key.
- **Current state (July 2026):** Android is guarded — `MapDisplay.native.tsx`
  short-circuits on `Platform.OS === "android"` and shows the shared
  coordinate-list fallback (`MapFallbackList`). Web uses the same fallback.
- **How to restore the Android interactive map:** get a Google Maps API key
  (Maps SDK for Android enabled in Google Cloud), add it to
  `app.json → android.config.googleMaps.apiKey`, bump `expo.version` (native
  config change → runtime bump rule), run a fresh `eas build`, then remove the
  Android guard. An OTA update alone can NOT add the key.
