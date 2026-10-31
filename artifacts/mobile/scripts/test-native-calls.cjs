// Pure JS/provider-contract tests; these do NOT use real push credentials or
// substitute for physical iPhone/Android lock-screen testing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const esbuild = require("../../api-server/node_modules/esbuild");

async function bundle(file) {
  return (await esbuild.build({
    entryPoints: [path.resolve(__dirname, file)], bundle: false,
    format: "cjs", platform: "node", write: false,
  })).outputFiles[0].text;
}

function run(code, modules, extras = {}) {
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, console, Date, Promise, Set, Map,
    setTimeout: () => 1, clearTimeout: () => {},
    require: (name) => {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
    ...extras,
  });
  vm.runInContext(code, context);
  return module.exports;
}

function mobile(code, platform = "android") {
  const saved = new Map();
  const events = new Map();
  const shown = [];
  const ended = [];
  let background;
  let foregrounded = 0;
  const ck = {
    setup: async () => {}, checkPhoneAccountEnabled: async () => true,
    setAvailable() {}, setReachable() {}, setSettings() {}, registerAndroidEvents() {},
    addEventListener(name, callback) {
      events.set(name, callback); return { remove() {} };
    },
    getInitialEvents: async () => [], clearInitialEvents() {},
    displayIncomingCall: (...args) => shown.push(args),
    reportEndCallWithUUID: (...args) => ended.push(args),
    setCurrentCallActive() {}, backToForeground() { foregrounded++; },
  };
  const api = run(code, {
    "@react-native-async-storage/async-storage": {
      getItem: async (key) => saved.get(key) ?? null,
      setItem: async (key, value) => { saved.set(key, value); },
      removeItem: async (key) => { saved.delete(key); },
    },
    "react-native": {
      Platform: { OS: platform },
      NativeModules: { RNCallKeep: {}, RNFBAppModule: {} },
      AppRegistry: { registerHeadlessTask() {} },
    },
    "react-native-callkeep": { default: ck },
    "@react-native-firebase/messaging": {
      default: () => ({
        setBackgroundMessageHandler: (callback) => { background = callback; },
        onMessage() {},
      }),
    },
  });
  api.initializeNativeCallHandlers();
  return { api, events, shown, ended, background: (...args) => background(...args),
    foregrounded: () => foregrounded };
}

const id = "ae9d4f5a-4c17-4ac9-914c-2f59cc200888";
function payload(overrides = {}) {
  return { type: "terra_call", callUUID: id, signalDocId: "signal1",
    targetUid: "callee", expiresAt: String(Date.now() + 40_000), ...overrides };
}

(async () => {
  const source = await bundle("../services/nativeCalls.ts");
  const web = mobile(source, "web");
  assert.equal(web.api.presentNativeCall(payload()), false);

  const m = mobile(source);
  await m.api.setupNativeCalls();
  await m.api.setNativeCallOwner("callee");
  assert.equal(m.api.presentNativeCall(payload()), true);
  m.api.presentNativeCall(payload());
  assert.equal(m.shown.length, 1, "Firestore/FCM duplicate must display once");
  m.events.get("answerCall")({ callUUID: id.toUpperCase() });
  assert.equal(m.api.nativeCallSnapshot()[0].action, "answer");
  assert.equal(m.foregrounded(), 1);
  m.api.nativeCallConnected(id);
  m.events.get("endCall")({ callUUID: id });
  assert.equal(m.api.nativeCallSnapshot()[0].action, "end");
  m.api.finishNativeCall(id);
  assert.equal(m.api.nativeCallSnapshot().length, 0);
  const count = m.shown.length;
  await m.background({ data: payload({ targetUid: "different-account" }) });
  assert.equal(m.shown.length, count, "stale-token wrong-account push must not ring");
  await m.background({ data: payload() });
  assert.equal(m.shown.length, count + 1);
  await m.api.clearNativeCallSession();
  await m.background({ data: payload() });
  assert.equal(m.api.nativeCallSnapshot().length, 0, "signed-out device must not ring");
  assert.equal(m.api.presentNativeCall(payload({ callUUID: "invalid" })), false);
  assert.equal(m.api.presentNativeCall(payload({ expiresAt: "1" })), true);
  assert.equal(m.api.nativeCallSnapshot().length, 0, "expired calls cannot reopen camera");
  const early = mobile(source, "ios");
  early.events.get("answerCall")({ callUUID: id });
  early.events.get("didDisplayIncomingCall")({ payload: payload() });
  assert.equal(early.api.nativeCallSnapshot()[0].action, "answer",
    "cold-start Answer before JS payload must be retained");

  const providerSource = await bundle("../../api-server/src/lib/nativeCallPush.ts");
  const requests = [];
  const httpBodies = [];
  const network = [];
  const environment = {
    APNS_AUTH_KEY_P8: "test-only-not-a-real-key", APNS_KEY_ID: "test-key",
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: "service_account", project_id: "terra-call-fcm",
      private_key: "test-only-not-a-real-key", client_email: "test@example.invalid",
    }),
  };
  class Jwt {
    setProtectedHeader() { return this; } setIssuer() { return this; }
    setIssuedAt() { return this; } setExpirationTime() { return this; }
    setAudience() { return this; } async sign() { return "test-only-jwt"; }
  }
  const provider = run(providerSource, {
    "node:http2": { connect: () => {
      const session = new EventEmitter();
      session.setTimeout = () => {}; session.destroy = () => {};
      session.request = (headers) => {
        requests.push(headers);
        const request = new EventEmitter();
        request.end = (body) => {
          httpBodies.push(JSON.parse(body));
          request.emit("response", { ":status": 200 });
        };
        return request;
      };
      return session;
    }},
    "jose": { importPKCS8: async () => ({}), SignJWT: Jwt },
    "./logger": { logger: { warn() {} } },
  }, {
    process: { env: environment }, URLSearchParams, AbortSignal,
    fetch: async (url, options) => {
      network.push({ url, options });
      return { ok: true, json: async () => ({ access_token: "test-only-access", expires_in: 3600 }) };
    },
  });
  const data = payload();
  assert.equal(await provider.sendNativeCallPush({ fields: {
    nativeCallPushToken: { stringValue: "a".repeat(64) },
    nativeCallPlatform: { stringValue: "ios" },
  } }, data), true);
  assert.equal(requests[0]["apns-topic"], "com.terracall.app.voip");
  assert.equal(requests[0]["apns-push-type"], "voip");
  assert.equal(requests[0]["apns-expiration"], "0");
  assert.equal(httpBodies[0].callUUID, id);
  assert.equal(httpBodies[0].callerName, undefined);
  assert.equal(await provider.sendNativeCallPush({ fields: {
    nativeCallPushToken: { stringValue: "test-fcm-token-12345678901234567890" },
    nativeCallPlatform: { stringValue: "android" },
  } }, data), true);
  const fcm = JSON.parse(network[1].options.body).message;
  assert.equal(fcm.android.priority, "high");
  assert.ok(Number(fcm.android.ttl.replace("s", "")) <= 45);
  assert.equal(fcm.notification, undefined);
  environment.FCM_SERVICE_ACCOUNT_JSON = environment.FCM_SERVICE_ACCOUNT_JSON.replace("terra-call-fcm", "wrong-project");
  assert.equal(await provider.sendNativeCallPush({ fields: {
    nativeCallPushToken: { stringValue: "test-fcm-token-12345678901234567890" },
    nativeCallPlatform: { stringValue: "android" },
  } }, data), false, "mismatched FCM project must fail closed");
  assert.equal(network.length, 2, "wrong-project credentials must not send");
  console.log("PASS: native call deduplication, cold-start actions, account isolation, expiry, logout, APNs and FCM payload contracts");
})().catch((error) => { console.error(error); process.exitCode = 1; });
