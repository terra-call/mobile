const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig, IOSConfig, withAndroidManifest, withAppDelegate,
  withDangerousMod, withXcodeProject, withPlugins,
} = require("expo/config-plugins");

module.exports = function withNativeCalls(config) {
  // Native Firebase is Android/FCM only. JS Firebase continues to use the
  // original Auth/Firestore project; iOS uses PushKit directly, not FCM.
  config = withPlugins(config, [
    AndroidConfig.GoogleServices.withClassPath,
    AndroidConfig.GoogleServices.withApplyPlugin,
    AndroidConfig.GoogleServices.withGoogleServicesFile,
  ]);
  config = withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.$["xmlns:tools"] ??= "http://schemas.android.com/tools";
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    // Expo Notifications and RNFirebase both supply this metadata. Explicitly
    // keep Expo's configured color instead of RNFirebase's library default.
    app["meta-data"] ??= [];
    let notificationColor = app["meta-data"].find(
      (item) => item.$["android:name"] === "com.google.firebase.messaging.default_notification_color",
    );
    if (!notificationColor) {
      notificationColor = { $: {
        "android:name": "com.google.firebase.messaging.default_notification_color",
        "android:resource": "@color/notification_icon_color",
      } };
      app["meta-data"].push(notificationColor);
    }
    const replaced = new Set(
      (notificationColor.$["tools:replace"] ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    );
    replaced.add("android:resource");
    notificationColor.$["tools:replace"] = [...replaced].join(",");
    app.service ??= [];
    let service = app.service.find(
      (item) => item.$["android:name"] === "io.wazo.callkeep.VoiceConnectionService",
    );
    if (!service) {
      service = {
        $: {
          "android:name": "io.wazo.callkeep.VoiceConnectionService",
          "android:permission": "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
          "android:exported": "true",
        },
        "intent-filter": [{
          action: [{ $: { "android:name": "android.telecom.ConnectionService" } }],
        }],
      };
      app.service.push(service);
    }
    service.$["android:label"] = "Terra Call";
    let headless = app.service.find(
      (item) => item.$["android:name"] === "io.wazo.callkeep.RNCallKeepBackgroundMessagingService",
    );
    if (!headless) {
      headless = { $: { "android:name": "io.wazo.callkeep.RNCallKeepBackgroundMessagingService" } };
      app.service.push(headless);
    }
    headless.$["android:exported"] = "false";
    // The phoneCall type keeps the signaling/UI service alive. Twilio owns
    // microphone capture, and cannot start it until the user answers.
    service.$["android:foregroundServiceType"] = "phoneCall";
    // RNFirebase's receiver handles call data in headless JS. Use Expo's
    // service for ordinary alerts so adding RNFirebase does not steal them.
    if (!app.service.some((item) => item.$["android:name"] === ".TerraCallMessagingService")) app.service.push({
      $: { "android:name": ".TerraCallMessagingService", "android:exported": "false" },
      "intent-filter": [{
        $: { "android:priority": "10" },
        action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }],
      }],
    });
    return mod;
  });
  config = withDangerousMod(config, ["android", async (mod) => {
    const packageName = mod.android.package;
    const root = path.join(
      mod.modRequest.platformProjectRoot, "app/src/main/java",
      packageName.replaceAll(".", "/"),
    );
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "TerraCallMessagingService.kt"), `
package ${packageName}

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

// Filter native-call data out of Expo's ordinary-notification pipeline.
// RNFirebase's broadcast receiver still receives these data-only messages.
class TerraCallMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    if (message.data["type"] != "terra_call") super.onMessageReceived(message)
  }
}
`);
    return mod;
  }]);
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("Terra Call PushKit plugin expects the Expo Swift AppDelegate");
    }
    const marker = "// Terra Call: start native call provider before React";
    if (!mod.modResults.contents.includes(marker)) {
      const anchor = /(\s*let delegate = ReactNativeDelegate\(\))/;
      if (!anchor.test(mod.modResults.contents)) {
        throw new Error("AppDelegate template changed; review PushKit initialization");
      }
      mod.modResults.contents = mod.modResults.contents.replace(
        anchor, `\n    ${marker}\n    TerraCallPushKit.start()\n$1`,
      );
    }
    return mod;
  });
  config = withDangerousMod(config, ["ios", async (mod) => {
    const name = mod.modRequest.projectName;
    const root = path.join(mod.modRequest.platformProjectRoot, name);
    for (const file of ["TerraCallPushKit.h", "TerraCallPushKit.m"]) {
      fs.copyFileSync(path.join(__dirname, "native", file), path.join(root, file));
    }
    const header = path.join(root, `${name}-Bridging-Header.h`);
    const existing = fs.existsSync(header) ? fs.readFileSync(header, "utf8") : "";
    if (!existing.includes('#import "TerraCallPushKit.h"')) {
      fs.writeFileSync(header, `${existing}\n#import "TerraCallPushKit.h"\n`);
    }
    return mod;
  }]);
  return withXcodeProject(config, (mod) => {
    const name = mod.modRequest.projectName;
    const file = `${name}/TerraCallPushKit.m`;
    if (!mod.modResults.hasFile(file)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: file, groupName: name, project: mod.modResults,
      });
    }
    return mod;
  });
};
