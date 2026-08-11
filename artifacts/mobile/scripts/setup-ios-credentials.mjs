// Creates an Apple iOS distribution certificate + App Store provisioning
// profile via the App Store Connect API, and writes credentials.json for
// EAS local credentials. Requires ASC_API_KEY_P8 / ASC_API_KEY_ID /
// ASC_API_ISSUER_ID env vars. Outputs into artifacts/mobile/credentials/.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BUNDLE_ID = "com.terracall.app";
const APP_NAME = "Terra Call";
const OUT = path.resolve(import.meta.dirname, "../credentials");
fs.mkdirSync(OUT, { recursive: true });

// --- normalize p8 (it may have been pasted as a single line) ---
const raw = (process.env.ASC_API_KEY_P8 || "").trim();
const b64 = raw.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
const p8 = "-----BEGIN PRIVATE KEY-----\n" + b64.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
const KEY_ID = process.env.ASC_API_KEY_ID.trim();
const ISSUER = process.env.ASC_API_ISSUER_ID.trim();

// --- ASC JWT (ES256) ---
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const payload = { iss: ISSUER, iat: now, exp: now + 900, aud: "appstoreconnect-v1" };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), { key: p8, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${sig.toString("base64url")}`;
}

async function asc(method, endpoint, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

// --- 1. bundle ID ---
let bundle = (await asc("GET", `/v1/bundleIds?filter[identifier]=${BUNDLE_ID}`)).data.find(
  (b) => b.attributes.identifier === BUNDLE_ID
);
if (!bundle) {
  bundle = (
    await asc("POST", "/v1/bundleIds", {
      data: { type: "bundleIds", attributes: { identifier: BUNDLE_ID, name: APP_NAME, platform: "IOS" } },
    })
  ).data;
  console.log("Registered bundle ID:", BUNDLE_ID);
} else {
  console.log("Bundle ID already registered:", bundle.id);
}

// --- 2. distribution certificate ---
const keyPath = path.join(OUT, "dist_key.pem");
const csrPath = path.join(OUT, "dist.csr");
execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", csrPath, "-subj", "/CN=Terra Call Distribution/O=Mike Jones/C=US"]);
const csr = fs.readFileSync(csrPath, "utf8");
const cert = (
  await asc("POST", "/v1/certificates", {
    data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: csr } },
  })
).data;
console.log("Created distribution certificate:", cert.attributes.serialNumber);
const certDer = path.join(OUT, "dist.der");
const certPem = path.join(OUT, "dist.pem");
fs.writeFileSync(certDer, Buffer.from(cert.attributes.certificateContent, "base64"));
execFileSync("openssl", ["x509", "-inform", "der", "-in", certDer, "-out", certPem]);

// p12 (password from env or generated)
const P12_PASSWORD = process.env.P12_PASSWORD || crypto.randomBytes(12).toString("hex");
const p12Path = path.join(OUT, "dist.p12");
execFileSync("openssl", ["pkcs12", "-export", "-legacy", "-out", p12Path, "-inkey", keyPath, "-in", certPem, "-passout", `pass:${P12_PASSWORD}`]);
console.log("Wrote", p12Path);

// --- 3. provisioning profile ---
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
const profilePath = path.join(OUT, "terra-call.mobileprovision");
fs.writeFileSync(profilePath, Buffer.from(profile.attributes.profileContent, "base64"));
console.log("Wrote", profilePath);

// --- 4. credentials.json ---
fs.writeFileSync(
  path.resolve(import.meta.dirname, "../credentials.json"),
  JSON.stringify(
    {
      ios: {
        provisioningProfilePath: "credentials/terra-call.mobileprovision",
        distributionCertificate: { path: "credentials/dist.p12", password: P12_PASSWORD },
      },
    },
    null,
    2
  )
);
console.log("Wrote credentials.json — done.");
