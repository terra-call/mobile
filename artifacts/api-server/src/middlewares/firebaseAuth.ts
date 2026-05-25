// SECURITY — Firebase ID token auth on video endpoint
// Required before App Store submission
// Prevents unauthorized token minting
// ─────────────────────────────────────────────────────────────────────────────
//
// Verifies Firebase Authentication ID tokens (the JWT returned by
// `firebase.auth().currentUser.getIdToken()` on the mobile client) WITHOUT
// requiring the firebase-admin SDK or a service-account JSON private key.
//
// Why no admin SDK? The Terra Call GCP project enforces the
// `iam.disableServiceAccountKeyCreation` org policy, which blocks the
// "Generate new private key" flow that admin SDK normally needs. We do not
// want to lift that policy just for ID-token verification — a long-lived
// service-account JSON in Replit secrets would be a far larger blast radius
// than the public-cert verification we do here.
//
// How it works (cryptographically equivalent to admin.auth().verifyIdToken):
//   1. Fetch Google's public x509 certs (JWKS) from the well-known URL
//      `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
//      — `jose`'s `createRemoteJWKSet` caches and refreshes these for us.
//   2. Verify the JWT signature with the matching `kid` cert.
//   3. Verify standard claims:
//        - `iss` MUST equal `https://securetoken.google.com/<projectId>`
//        - `aud` MUST equal `<projectId>`
//        - `exp`, `iat`, `nbf` MUST be valid (jose enforces automatically).
//   4. Extract `uid` from `sub` (Firebase's canonical subject claim).
//
// On failure we emit a structured pino "unauthorized_token_request" log line
// (mirroring the auditLogs Firestore schema so a future upgrade to admin
// credentials can backfill rows) and return 401.
// ─────────────────────────────────────────────────────────────────────────────

import { type NextFunction, type Request, type Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "../lib/logger";

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ??
  "";

// Module-singleton so jose can cache + refresh Google's certs across requests.
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

export interface FirebaseAuthClaims {
  /** Firebase Auth uid — the cryptographically verified subject of the JWT. */
  uid: string;
  email?: string;
  /** Raw bearer token, for forwarding to Firestore REST in permission checks. */
  idToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      firebaseAuth?: FirebaseAuthClaims;
    }
  }
}

function logUnauthorized(
  req: Request,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  // SECURITY — mirror the Firestore `auditLogs` document shape so this
  // server-side log can be cross-referenced against client-side audit rows
  // (and backfilled into Firestore if/when admin creds become available).
  logger.warn(
    {
      action: "unauthorized_token_request",
      route: req.originalUrl,
      reason,
      remoteIp: req.ip,
      userAgent: req.get("user-agent"),
      ...extra,
    },
    "Unauthorized request to authenticated route",
  );
}

/**
 * Express middleware: requires a valid Firebase ID token in the
 * `Authorization: Bearer <token>` header. On success attaches
 * `req.firebaseAuth`. On failure responds 401 and logs the rejection.
 */
export async function verifyFirebaseIdToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!FIREBASE_PROJECT_ID) {
    logger.error(
      "FIREBASE_PROJECT_ID / EXPO_PUBLIC_FIREBASE_PROJECT_ID not set — cannot verify ID tokens",
    );
    res.status(500).json({ error: "auth_not_configured" });
    return;
  }

  const header = req.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    logUnauthorized(req, "missing_or_malformed_bearer");
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const idToken = match[1].trim();

  try {
    const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });

    const uid =
      (typeof payload.sub === "string" && payload.sub) ||
      (typeof payload.user_id === "string" && payload.user_id) ||
      "";
    if (!uid) {
      logUnauthorized(req, "verified_token_missing_subject");
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    req.firebaseAuth = {
      uid,
      email: typeof payload.email === "string" ? payload.email : undefined,
      idToken,
    };
    next();
  } catch (err) {
    logUnauthorized(
      req,
      err instanceof Error ? err.message : "verification_failed",
    );
    res.status(401).json({ error: "unauthorized" });
  }
}

/**
 * Helper: forward the caller's ID token to the Firestore REST API to read
 * a user document. Existing Firestore Security Rules enforce whether the
 * caller can read it. Returns the parsed Firestore document JSON, or null
 * on any failure (network, 403, 404, malformed). Intentionally swallows
 * errors — the caller treats null as "permission denied".
 */
export async function fetchUserDocAsCaller(
  callerIdToken: string,
  targetUid: string,
): Promise<Record<string, unknown> | null> {
  if (!FIREBASE_PROJECT_ID) return null;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(targetUid)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${callerIdToken}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Helper: forward the caller's ID token to the Firestore REST API to CREATE
 * a new document in a collection (auto-generated id). Existing Firestore
 * Security Rules govern whether the caller may write. Returns the created
 * doc's full resource name on success, or null on failure.
 *
 * Used by /api/video/initiate to write a `cameraActivations` signal doc
 * that the receiver's app subscribes to via onSnapshot — the Firestore
 * fallback for devices that can't receive push notifications (Android FCM
 * blocked by org policy, app force-killed, silent mode, low power, etc).
 */
/**
 * Helper: forward the caller's ID token to the Firestore REST API to read
 * ANY document by collection + docId. Mirrors fetchUserDocAsCaller but is
 * generic so callers can fetch e.g. cameraActivations docs without exposing
 * a new collection-specific helper. Returns null on any failure.
 */
export async function fetchFirestoreDocAsCaller(
  callerIdToken: string,
  collectionPath: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  if (!FIREBASE_PROJECT_ID) return null;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${callerIdToken}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Result of a Firestore REST create attempt.
 *
 * Discriminated so callers can distinguish:
 *   • ok=true                     → write succeeded, `name` is the full doc path
 *   • ok=false, permissionDenied  → Firestore Security Rules rejected the write
 *                                   (rules-vs-code drift; client should see 403)
 *   • ok=false, !permissionDenied → transport/config failure (client should see 502)
 *
 * This separation matters because an opaque "null" return collapses both
 * cases into a single 502 on the wire, making rules-deployment drift look
 * like a server outage to the mobile app.
 */
export type FirestoreCreateResult =
  | { ok: true; name: string }
  | { ok: false; permissionDenied: boolean; status: number };

export async function createFirestoreDocAsCaller(
  callerIdToken: string,
  collectionPath: string,
  fields: Record<string, unknown>,
): Promise<FirestoreCreateResult> {
  if (!FIREBASE_PROJECT_ID) {
    logger.error(
      { collectionPath },
      "createFirestoreDocAsCaller — FIREBASE_PROJECT_ID env var not set on server",
    );
    return { ok: false, permissionDenied: false, status: 0 };
  }
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collectionPath}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${callerIdToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: encodeFirestoreFields(fields) }),
    });
    if (!r.ok) {
      // Surface the actual Firestore REST error so deployment logs reveal
      // permission-denied vs schema-invalid vs project-misconfigured. Body
      // is small (Firestore returns a JSON error envelope) — safe to log.
      const errBody = await r.text().catch(() => "<unreadable>");
      const permissionDenied =
        r.status === 403 || /PERMISSION_DENIED/.test(errBody);
      logger.error(
        {
          collectionPath,
          status: r.status,
          permissionDenied,
          body: errBody.slice(0, 800),
        },
        "createFirestoreDocAsCaller — Firestore REST rejected the create",
      );
      return { ok: false, permissionDenied, status: r.status };
    }
    const json = (await r.json()) as { name?: string };
    if (!json.name) {
      logger.error(
        { collectionPath },
        "createFirestoreDocAsCaller — Firestore response missing doc name",
      );
      return { ok: false, permissionDenied: false, status: 200 };
    }
    return { ok: true, name: json.name };
  } catch (err) {
    logger.error(
      {
        collectionPath,
        err: err instanceof Error ? err.message : String(err),
      },
      "createFirestoreDocAsCaller — network/parse error",
    );
    return { ok: false, permissionDenied: false, status: 0 };
  }
}

function encodeFirestoreFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = encodeFirestoreValue(v);
  }
  return out;
}

function encodeFirestoreValue(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}

/**
 * Permission predicate: returns true iff `callerUid` is allowed to mint a
 * Twilio Video token for a room belonging to `receiverUid`. Two valid
 * cases:
 *   (a) caller IS the receiver (minting their own publish token), or
 *   (b) caller is listed in receiver's `permittedCaregivers` array.
 *
 * The Firestore lookup uses the caller's own ID token, so the existing
 * Security Rules govern read access — no admin bypass.
 */
export async function isPermittedForReceiver(
  claims: FirebaseAuthClaims,
  receiverUid: string,
): Promise<boolean> {
  if (claims.uid === receiverUid) return true;

  const doc = await fetchUserDocAsCaller(claims.idToken, receiverUid);
  if (!doc) return false;

  // Firestore REST encodes arrays as { fields: { permittedCaregivers: {
  //   arrayValue: { values: [ { mapValue: { fields: { id: { stringValue } } } } ] } } } }
  const fields = (doc as { fields?: Record<string, unknown> }).fields;
  const pc = fields?.permittedCaregivers as
    | { arrayValue?: { values?: unknown[] } }
    | undefined;
  const values = pc?.arrayValue?.values ?? [];
  for (const v of values) {
    const id = (v as { mapValue?: { fields?: { id?: { stringValue?: string } } } })
      ?.mapValue?.fields?.id?.stringValue;
    if (id === claims.uid) return true;
  }
  return false;
}
