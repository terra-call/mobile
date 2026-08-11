// Enables Push Notifications on the bundle ID and regenerates the App Store
// provisioning profile (profiles are immutable; old one is deleted).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BUNDLE_ID = "com.terracall.app";
const OUT = path.resolve(import.meta.dirname, "../credentials");

const raw = (process.env.ASC_API_KEY_P8 || "").trim();
const b64 = raw.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
const p8 = "-----BEGIN PRIVATE KEY-----\n" + b64.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const si = `${enc({ alg: "ES256", kid: process.env.ASC_API_KEY_ID.trim(), typ: "JWT" })}.${enc({ iss: process.env.ASC_API_ISSUER_ID.trim(), iat: now, exp: now + 900, aud: "appstoreconnect-v1" })}`;
  const sig = crypto.sign("sha256", Buffer.from(si), { key: p8, dsaEncoding: "ieee-p1363" });
  return `${si}.${sig.toString("base64url")}`;
}
async function asc(method, endpoint, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

const bundle = (await asc("GET", `/v1/bundleIds?filter[identifier]=${BUNDLE_ID}`)).data[0];

// 1. enable push capability (409 if already enabled — tolerated)
try {
  await asc("POST", "/v1/bundleIdCapabilities", {
    data: {
      type: "bundleIdCapabilities",
      attributes: { capabilityType: "PUSH_NOTIFICATIONS" },
      relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
    },
  });
  console.log("Enabled Push Notifications capability");
} catch (e) {
  if (String(e).includes("409")) console.log("Push capability already enabled");
  else throw e;
}

// 2. find existing cert id (reuse the one we created)
const certs = (await asc("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=10")).data;
if (!certs.length) throw new Error("no distribution certificate found");
const cert = certs[0];

// 3. delete old profiles for this bundle, create fresh one
const profiles = (await asc("GET", `/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=50`)).data;
for (const p of profiles) {
  if (p.attributes.name.startsWith("Terra Call App Store")) {
    await asc("DELETE", `/v1/profiles/${p.id}`);
    console.log("Deleted old profile:", p.attributes.name);
  }
}
const profile = (
  await asc("POST", "/v1/profiles", {
    data: {
      type: "profiles",
      attributes: { name: `Terra Call App Store ${Date.now()}`, profileType: "IOS_APP_STORE" },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: bundle.id } },
        certificates: { data: [{ type: "certificates", id: cert.id }] },
      },
    },
  })
).data;
fs.writeFileSync(path.join(OUT, "terra-call.mobileprovision"), Buffer.from(profile.attributes.profileContent, "base64"));
console.log("Wrote new provisioning profile:", profile.attributes.name);
