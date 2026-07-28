// Creates the two Apple-review demo accounts (caregiver + care recipient),
// writes their Firestore profile docs, and links them together.
// Uses the same public Firebase Auth REST flow the app itself uses.
const API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
if (!API_KEY) { console.error("Missing EXPO_PUBLIC_FIREBASE_API_KEY"); process.exit(1); }
const PROJECT = "terra-call-9335b";

const ACCOUNTS = [
  { email: "review.caregiver@terra-call.com", password: "AppleReview2026!Cg", name: "Demo Caregiver", role: "caregiver" },
  { email: "review.recipient@terra-call.com", password: "AppleReview2026!Cr", name: "Demo Recipient", role: "care-receiver" },
];

async function authCall(endpoint, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${endpoint}: ${json?.error?.message || res.status}`);
  return json;
}

async function signUpOrIn(acct) {
  try {
    return await authCall("signUp", { email: acct.email, password: acct.password, returnSecureToken: true });
  } catch (e) {
    if (String(e.message).includes("EMAIL_EXISTS")) {
      console.log(`  ${acct.email} already exists — signing in`);
      return await authCall("signInWithPassword", { email: acct.email, password: acct.password, returnSecureToken: true });
    }
    throw e;
  }
}

function fsFields(obj) {
  const conv = (v) => {
    if (v === null) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(conv) } };
    if (typeof v === "object") return { mapValue: { fields: fsFields(v).fields } };
    throw new Error("unsupported " + typeof v);
  };
  return { fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, conv(v)])) };
}

async function writeDoc(uid, idToken, data, updateMaskFields) {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`;
  if (updateMaskFields) url += "?" + updateMaskFields.map((f) => `updateMask.fieldPaths=${f}`).join("&");
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(fsFields(data)),
  });
  if (!res.ok) throw new Error(`Firestore write ${uid}: ${res.status} ${await res.text()}`);
}

const results = {};
for (const acct of ACCOUNTS) {
  console.log(`Creating ${acct.role}: ${acct.email}`);
  const auth = await signUpOrIn(acct);
  results[acct.role] = { uid: auth.localId, idToken: auth.idToken, ...acct };
  await writeDoc(auth.localId, auth.idToken, {
    email: acct.email, name: acct.name, role: acct.role, phone: "",
    smsConsent: false, smsConsentAt: null,
    status: acct.role === "care-receiver" ? "unknown" : null,
    lastCheckIn: null, location: null,
    organizationId: null, organizationRole: null,
    hipaaConsentSigned: false, hipaaConsentDate: null, npiNumber: null,
  });
  console.log(`  uid=${auth.localId} doc written`);
}

// Link: recipient permits the demo caregiver.
const cg = results["caregiver"], cr = results["care-receiver"];
await writeDoc(cr.uid, cr.idToken, {
  permittedCaregiverIds: [cg.uid],
  permittedCaregivers: [{ id: cg.uid, name: cg.name, email: cg.email }],
}, ["permittedCaregiverIds", "permittedCaregivers"]);
console.log("Linked recipient -> caregiver");
console.log("\nDemo credentials for App Store Connect review notes:");
console.log(`  Caregiver: ${cg.email} / ${cg.password}`);
console.log(`  Recipient: ${cr.email} / ${cr.password}`);
