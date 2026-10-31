module.exports = {
  dependencies: {
    // PushKit handles iOS wakeups. Avoid installing a second Firebase/Auth
    // application on iOS just to support Android FCM background messages.
    "@react-native-firebase/app": { platforms: { ios: null } },
    "@react-native-firebase/messaging": { platforms: { ios: null } },
  },
};
