const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let modifyManifest;
const moduleStub = { exports: {} };
const passthrough = (config) => config;
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../plugins/withNativeCalls.js"), "utf8"),
  {
    module: moduleStub,
    require(name) {
      if (name === "node:fs") return fs;
      if (name === "node:path") return path;
      assert.equal(name, "expo/config-plugins");
      return {
        AndroidConfig: {
          GoogleServices: {},
          Manifest: { getMainApplicationOrThrow: (manifest) => manifest.manifest.application[0] },
        },
        IOSConfig: {},
        withPlugins: passthrough,
        withAndroidManifest(config, action) { modifyManifest = action; return config; },
        withDangerousMod: passthrough,
        withAppDelegate: passthrough,
        withXcodeProject: passthrough,
      };
    },
  },
);
moduleStub.exports({});

for (const existing of [false, true]) {
  const metadata = existing ? [{ $: {
    "android:name": "com.google.firebase.messaging.default_notification_color",
    "android:resource": "@color/notification_icon_color",
    "tools:replace": "android:value",
  } }] : [];
  const application = { "meta-data": metadata };
  const mod = { modResults: { manifest: { $: {}, application: [application] } } };
  modifyManifest(mod);
  modifyManifest(mod);
  assert.equal(mod.modResults.manifest.$["xmlns:tools"], "http://schemas.android.com/tools");
  const colors = metadata.filter((item) =>
    item.$["android:name"] === "com.google.firebase.messaging.default_notification_color");
  assert.equal(colors.length, 1, "repeated prebuilds must not duplicate metadata");
  assert.equal(colors[0].$["android:resource"], "@color/notification_icon_color");
  const overrides = colors[0].$["tools:replace"].split(",");
  assert.equal(overrides.filter((value) => value === "android:resource").length, 1);
  if (existing) assert(overrides.includes("android:value"), "preserve other merge overrides");
}
console.log("Native-call notification manifest checks passed");
