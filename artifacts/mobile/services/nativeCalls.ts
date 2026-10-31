import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppRegistry, NativeModules, Platform } from "react-native";
import type CallKeep from "react-native-callkeep";

export interface NativeCall {
  callUUID: string;
  signalDocId: string;
  targetUid: string;
  expiresAt: number;
  action: "ringing" | "answer" | "end" | "connected";
}

const STORAGE_KEY = "terra.nativeCall.v1";
const READY_KEY = "terra.nativeCalls.ready.v1";
const OWNER_KEY = "terra.nativeCalls.owner.v1";
const records = new Map<string, NativeCall>();
const subscribers = new Set<() => void>();
const tokenListeners = new Set<(token: string) => void>();
const actionBeforePayload = new Map<string, "answer" | "end">();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let latestToken: string | null = null;
let initialized = false;
let androidReady = false;
let writes = Promise.resolve();

export const callKeepOptions = {
  ios: {
    appName: "Terra Call", supportsVideo: true, includesCallsInRecents: false,
    maximumCallGroups: "1", maximumCallsPerCallGroup: "1",
  },
  android: {
    alertTitle: "Enable Terra Call calling",
    alertDescription: "Allow Terra Call to show incoming calls on your lock screen.",
    cancelButton: "Not now", okButton: "Continue", additionalPermissions: [],
    selfManaged: false,
    foregroundService: {
      channelId: "terra_call_active_v1", channelName: "Active video calls",
      notificationTitle: "Terra Call is in a call",
    },
  },
};

export function getCallKeep(): typeof CallKeep | null {
  if (Platform.OS === "web" || !NativeModules.RNCallKeep) return null;
  // Keep web, Expo Go and old native binaries functional.
  return require("react-native-callkeep").default as typeof CallKeep;
}

export function nativeCallsReady(): boolean {
  return !!getCallKeep() && (Platform.OS !== "android" || androidReady);
}

export async function setNativeCallOwner(uid: string): Promise<void> {
  await AsyncStorage.setItem(OWNER_KEY, uid);
}

export async function clearNativeCallSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OWNER_KEY);
  } finally {
    for (const call of [...records.values()]) finishNativeCall(call.callUUID);
  }
}

export async function disableNativeCallRegistration(): Promise<void> {
  androidReady = false;
  await AsyncStorage.setItem(READY_KEY, "false");
}

function publish() {
  const snapshot = [...records.values()];
  writes = writes.catch(() => {}).then(() =>
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)),
  );
  writes.catch(() => console.warn("[NativeCalls] Could not persist call state"));
  subscribers.forEach((listener) => listener());
}

export function nativeCallSnapshot(): NativeCall[] {
  return [...records.values()];
}

export function subscribeNativeCalls(listener: () => void): () => void {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

function action(uuid: string, kind: "answer" | "end") {
  uuid = uuid.toLowerCase();
  if (kind === "answer" && Platform.OS === "android") getCallKeep()?.backToForeground();
  const call = records.get(uuid);
  if (!call) {
    actionBeforePayload.set(uuid, kind);
    return;
  }
  if (call.action === "end") return;
  records.set(uuid, { ...call, action: kind });
  if (kind === "answer") {
    const timer = timers.get(uuid);
    if (timer) clearTimeout(timer);
    timers.delete(uuid);
  }
  publish();
}

function decode(input: unknown): NativeCall | null {
  if (!input || typeof input !== "object") return null;
  const d = input as Record<string, unknown>;
  if (
    typeof d.callUUID !== "string" ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(d.callUUID) ||
    typeof d.signalDocId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(d.signalDocId) ||
    typeof d.targetUid !== "string" || !d.targetUid ||
    !Number.isFinite(Number(d.expiresAt))
  ) return null;
  return {
    callUUID: d.callUUID.toLowerCase(), signalDocId: d.signalDocId,
    targetUid: d.targetUid, expiresAt: Number(d.expiresAt), action: "ringing",
  };
}

function receive(input: unknown, alreadyDisplayed: boolean): boolean {
  const call = decode(input);
  const ck = getCallKeep();
  if (!call || !ck) return false;
  if (records.has(call.callUUID)) return true;
  if (call.expiresAt <= Date.now() || call.expiresAt > Date.now() + 65_000) {
    if (alreadyDisplayed) ck.reportEndCallWithUUID(call.callUUID, 3);
    return true;
  }
  call.action = actionBeforePayload.get(call.callUUID) ?? "ringing";
  actionBeforePayload.delete(call.callUUID);
  records.set(call.callUUID, call);
  publish();
  if (!alreadyDisplayed) {
    ck.displayIncomingCall(call.callUUID, "Terra Call", "Terra Call video call", "generic", true);
  }
  if (call.action === "ringing") {
    timers.set(call.callUUID, setTimeout(() => {
      if (records.get(call.callUUID)?.action !== "ringing") return;
      finishNativeCall(call.callUUID, 3);
    }, call.expiresAt - Date.now()));
  }
  return true;
}

/** Used by foreground Firestore and legacy Expo-push fallback delivery. */
export function presentNativeCall(input: unknown): boolean {
  if (!nativeCallsReady()) return false;
  return receive(input, false);
}

export function finishNativeCall(uuid: string, reason = 2): void {
  uuid = uuid.toLowerCase();
  const timer = timers.get(uuid);
  if (timer) clearTimeout(timer);
  timers.delete(uuid);
  getCallKeep()?.reportEndCallWithUUID(uuid, reason);
  records.delete(uuid);
  actionBeforePayload.delete(uuid);
  publish();
}

export function nativeCallConnected(uuid: string): void {
  const call = records.get(uuid.toLowerCase());
  if (call) records.set(call.callUUID, { ...call, action: "connected" });
  if (Platform.OS === "android") getCallKeep()?.setCurrentCallActive(uuid);
  publish();
}

export function subscribeVoipToken(listener: (token: string) => void): () => void {
  tokenListeners.add(listener);
  if (latestToken) listener(latestToken);
  return () => { tokenListeners.delete(listener); };
}

export async function setupNativeCalls(): Promise<boolean> {
  const ck = getCallKeep();
  if (!ck) return false;
  await ck.setup(callKeepOptions);
  if (Platform.OS === "android") {
    androidReady = await ck.checkPhoneAccountEnabled();
    ck.setAvailable(androidReady);
    ck.setReachable();
    await AsyncStorage.setItem(READY_KEY, String(androidReady));
    return androidReady;
  }
  return true;
}

/** Runs before expo-router starts so cold-start Answer/Decline is never lost. */
export function initializeNativeCallHandlers(): void {
  const ck = getCallKeep();
  if (!ck || initialized) return;
  initialized = true;
  ck.addEventListener("answerCall", ({ callUUID }) => action(callUUID, "answer"));
  ck.addEventListener("endCall", ({ callUUID }) => action(callUUID, "end"));
  ck.addEventListener("checkReachability", () => ck.setReachable());
  const replay = (events: Awaited<ReturnType<typeof ck.getInitialEvents>>) => {
    for (const event of events) {
      if (event.name === "RNCallKeepDidDisplayIncomingCall" && !event.data.error) {
        receive(event.data.payload, true);
      } else if (event.name === "RNCallKeepPerformAnswerCallAction") {
        action(event.data.callUUID, "answer");
      } else if (event.name === "RNCallKeepPerformEndCallAction") {
        action(event.data.callUUID, "end");
      }
    }
  };
  ck.addEventListener("didDisplayIncomingCall", ({ payload, error }) => {
    if (!error) receive(payload, true);
  });
  ck.addEventListener("didLoadWithEvents", replay);
  // Only iOS buffers events in this API.
  if (Platform.OS === "ios") {
    ck.getInitialEvents().then(replay).then(() => ck.clearInitialEvents()).catch(() => {});
  }
  AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
    if (!raw) return;
    for (const stored of JSON.parse(raw) as NativeCall[]) {
      if (records.has(stored.callUUID) || stored.expiresAt <= Date.now()) continue;
      const earlyAction = actionBeforePayload.get(stored.callUUID);
      receive(stored, true);
      const call = records.get(stored.callUUID);
      if (call) {
        records.set(call.callUUID, { ...call, action: earlyAction ?? stored.action });
        publish();
      }
    }
  }).catch(() => console.warn("[NativeCalls] Could not restore call state"));

  if (Platform.OS === "ios" && NativeModules.RNVoipPushNotificationManager) {
    const voip = require("react-native-voip-push-notification").default as
      typeof import("react-native-voip-push-notification").default;
    const token = (value: string) => {
      latestToken = value;
      tokenListeners.forEach((listener) => listener(value));
    };
    voip.addEventListener("register", token);
    // Native CallKit reporting has already happened before these events.
    voip.addEventListener("notification", (data) => receive(data, true));
    voip.addEventListener("didLoadWithEvents", (events) => {
      for (const event of events) {
        if (event.name === "RNVoipPushRemoteNotificationsRegisteredEvent") token(event.data as string);
        if (event.name === "RNVoipPushRemoteNotificationReceivedEvent") receive(event.data, true);
      }
    });
  }
  if (Platform.OS === "android" && NativeModules.RNFBAppModule) {
    AppRegistry.registerHeadlessTask("RNCallKeepBackgroundMessage", () => async () => {
      ck.registerAndroidEvents();
      ck.setReachable();
    });
    const messaging = require("@react-native-firebase/messaging").default as
      typeof import("@react-native-firebase/messaging").default;
    const handleMessage = async (message: { data?: Record<string, unknown> }) => {
      if (message.data?.type !== "terra_call") return;
      if (await AsyncStorage.getItem(OWNER_KEY) !== message.data.targetUid) return;
      androidReady = await AsyncStorage.getItem(READY_KEY) === "true";
      if (!androidReady) return;
      ck.setSettings(callKeepOptions);
      ck.registerAndroidEvents();
      ck.setAvailable(true);
      ck.setReachable();
      receive(message.data, false);
    };
    messaging().setBackgroundMessageHandler(handleMessage);
    messaging().onMessage(handleMessage);
  }
}
