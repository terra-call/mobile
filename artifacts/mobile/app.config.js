// Dynamic Expo config: starts from app.json and injects values that must not
// live in the repo. GOOGLE_MAPS_ANDROID_API_KEY is provided by the EAS
// "preview"/"production" environments (eas env) at build time and by Replit
// secrets in local dev. Without it, Android MapView would hard-crash — the
// map screen guards on the key's presence via expo-constants.
const appJson = require("./app.json");

module.exports = ({ config }) => {
  const base = { ...appJson.expo, ...config };
  const mapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

  return {
    ...base,
    android: {
      ...base.android,
      config: {
        ...(base.android?.config ?? {}),
        ...(mapsApiKey ? { googleMaps: { apiKey: mapsApiKey } } : {}),
      },
    },
    extra: {
      ...(base.extra ?? {}),
      // Lets JS know whether the native binary was built with a Maps key, so
      // the map screen can fall back to the list on keyless builds instead of
      // crashing natively.
      androidMapsKeyConfigured: Boolean(mapsApiKey),
    },
  };
};
