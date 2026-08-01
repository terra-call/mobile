const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// @twilio/video-react-native-sdk is native-only (its views don't exist for
// web), which crashes the entire web bundle. Stub it on web so the app can
// run in a browser (used for dev preview and store-listing screenshots).
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName.startsWith("@twilio/video-react-native-sdk")) {
    return { type: "sourceFile", filePath: path.resolve(__dirname, "web-stubs/twilio-video.js") };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
