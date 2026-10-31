// Keep app.json static while supplying the existing native Maps key at build
// time. Do not expose any APNs/FCM service-account credentials in Expo config.
module.exports = function withAndroidMapsKey(config) {
  const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  config.extra = { ...config.extra, androidMapsKeyConfigured: Boolean(key) };
  if (key) {
    config.android = {
      ...config.android,
      config: { ...config.android?.config, googleMaps: { apiKey: key } },
    };
  }
  return config;
};
