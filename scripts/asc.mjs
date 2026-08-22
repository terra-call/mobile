// Minimal App Store Connect API helper. Usage: node scripts/asc.mjs GET /v1/apps/6800145154
import crypto from "node:crypto";

const raw = (process.env.ASC_API_KEY_P8 || "").trim();
const b64 = raw.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
const p8 = "-----BEGIN PRIVATE KEY-----\n" + b64.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
const KEY_ID = process.env.ASC_API_KEY_ID.trim();
const ISSUER = process.env.ASC_API_ISSUER_ID.trim();

export function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const si = `${enc({ alg: "ES256", kid: KEY_ID, typ: "JWT" })}.${enc({ iss: ISSUER, iat: now, exp: now + 900, aud: "appstoreconnect-v1" })}`;
  const sig = crypto.sign("sha256", Buffer.from(si), { key: p8, dsaEncoding: "ieee-p1363" });
  return `${si}.${sig.toString("base64url")}`;
}

export async function asc(method, endpoint, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : null;
}

if (process.argv[1] && process.argv[1].endsWith("asc.mjs") && process.argv[2]) {
  const body = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
  asc(process.argv[2], process.argv[3], body).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
