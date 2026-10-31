import { connect } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { logger } from "./logger";

// Only opaque call identifiers travel in native pushes. Resolve names, room
// access and account relationships from Firestore after authentication.
export interface NativeCallPush {
  type: "terra_call";
  callUUID: string;
  signalDocId: string;
  targetUid: string;
  expiresAt: string;
}

type FirestoreValue = { stringValue?: string; integerValue?: string };
type DeviceDocument = { fields?: Record<string, FirestoreValue> };

let apnsJwt: { value: string; expires: number } | undefined;
let fcmAccess: { value: string; expires: number } | undefined;

async function appleToken(): Promise<string> {
  if (apnsJwt && apnsJwt.expires > Date.now()) return apnsJwt.value;
  const pem = process.env.APNS_AUTH_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  if (!pem || !keyId) throw new Error("apns_not_configured");
  const key = await importPKCS8(pem.replace(/\\n/g, "\n"), "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(process.env.APNS_TEAM_ID ?? "ZGCT2ZHDY2")
    .setIssuedAt()
    .sign(key);
  apnsJwt = { value, expires: Date.now() + 45 * 60_000 };
  return value;
}

async function firebaseAccess(): Promise<{ token: string; project: string }> {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("fcm_not_configured");
  const account = JSON.parse(raw) as {
    type?: string; project_id?: string; private_key?: string; client_email?: string;
  };
  // This project supplies FCM ONLY. Never initialize Auth/Firestore with this
  // service account: those intentionally use a different Firebase project.
  if (
    account.type !== "service_account" ||
    account.project_id !== (process.env.FCM_PROJECT_ID ?? "terra-call-fcm") ||
    !account.private_key || !account.client_email
  ) throw new Error("fcm_account_invalid_or_wrong_project");
  if (fcmAccess && fcmAccess.expires > Date.now()) {
    return { token: fcmAccess.value, project: account.project_id };
  }
  const key = await importPKCS8(account.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("fcm_oauth_rejected");
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!result.access_token) throw new Error("fcm_oauth_missing_token");
  fcmAccess = {
    value: result.access_token,
    expires: Date.now() + Math.max(0, (result.expires_in ?? 3600) - 120) * 1000,
  };
  return { token: result.access_token, project: account.project_id };
}

async function sendApple(deviceToken: string, environment: string, data: NativeCallPush) {
  const authorization = await appleToken();
  const origin = environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  return new Promise<boolean>((resolve) => {
    const session = connect(origin);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      session.destroy();
      resolve(ok);
    };
    session.on("error", () => finish(false));
    session.setTimeout(5_000, () => finish(false));
    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${authorization}`,
      "apns-topic": `${process.env.APNS_BUNDLE_ID ?? "com.terracall.app"}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      // Do not queue calls for later delivery when a phone is offline.
      "apns-expiration": "0",
      "apns-id": data.callUUID,
    });
    request.on("response", (headers) => {
      const status = Number(headers[":status"]);
      if (status !== 200) logger.warn({ status, provider: "apns" }, "Native call push rejected");
      finish(status === 200);
    });
    request.on("error", () => finish(false));
    request.end(JSON.stringify({ aps: { "content-available": 1 }, ...data }));
  });
}

async function sendAndroid(deviceToken: string, data: NativeCallPush) {
  const { token, project } = await firebaseAccess();
  const remaining = Math.min(45, Math.floor((Number(data.expiresAt) - Date.now()) / 1000));
  if (remaining <= 0) return false;
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: deviceToken, data,
        // No notification block: the headless handler must report a Telecom
        // incoming call, not a second ordinary notification.
        android: { priority: "high", ttl: `${remaining}s` },
      },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    logger.warn({ status: response.status, provider: "fcm" }, "Native call push rejected");
  }
  return response.ok;
}

export async function sendNativeCallPush(
  document: Record<string, unknown> | null, data: NativeCallPush,
): Promise<boolean> {
  const fields = (document as DeviceDocument | null)?.fields;
  const token = fields?.nativeCallPushToken?.stringValue;
  const platform = fields?.nativeCallPlatform?.stringValue;
  if (!token || !["ios", "android"].includes(platform ?? "")) return false;
  // Prevent token-shaped data from becoming a path/header injection.
  if (platform === "ios" && !/^[a-f0-9]{64,200}$/i.test(token)) return false;
  if (platform === "android" && !/^[a-zA-Z0-9_:\-]{20,4096}$/.test(token)) return false;
  try {
    return platform === "ios"
      ? await sendApple(token, fields?.nativeCallApnsEnvironment?.stringValue ?? "production", data)
      : await sendAndroid(token, data);
  } catch {
    // Never log provider errors verbatim: libraries may include credential
    // contents or device tokens. Legacy Expo push remains the fallback.
    logger.warn({ platform, callUUID: data.callUUID }, "Native call push failed");
    return false;
  }
}
