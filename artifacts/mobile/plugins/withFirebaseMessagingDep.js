// Resolve helpers through Expo's public export rather than an undeclared
// transitive dependency, which pnpm does not expose in clean cloud installs.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withFirebaseMessagingDep(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('com.google.firebase:firebase-messaging')) {
      config.modResults.contents = config.modResults.contents.replace(
        /dependencies\s*\{/,
        'dependencies {\n    implementation("com.google.firebase:firebase-messaging:24.1.0")'
      );
    }
    return config;
  });
};
