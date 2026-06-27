// REOLINK — HTTP camera client (server-side proxy)
// ─────────────────────────────────────────────────────────────────────────────
// Reolink has NO public cloud snapshot API. Remote viewing works by pointing
// at the camera's public address (Reolink DDNS + a forwarded/UPnP port). This
// module logs in to the camera's CGI HTTP API and pulls a single JPEG via the
// `Snap` command — the caller (snapshot route) polls it ~every 1.5s to fake a
// live feed.
//
// Flow:
//   1. POST /cgi-bin/api.cgi?cmd=Login  → { value: { Token: { name } } }
//   2. GET  /cgi-bin/api.cgi?cmd=Snap&channel=0&token=<token> → raw JPEG bytes
//
// Reolink cameras serve HTTPS with a self-signed cert, so TLS verification is
// disabled for the camera connection ONLY (rejectUnauthorized:false). We try
// https first, then http. Tokens are cached per camera to avoid re-login on
// every poll.
//
// SECURITY:
//   • SSRF guard — the host is recipient-supplied. We block loopback / private /
//     link-local / CGNAT ranges (and metadata IPs) so this proxy can't be used
//     to reach internal infrastructure. The product explicitly targets public
//     DDNS hostnames, so private addresses are never legitimate here.
//   • Never log credentials, tokens, or the full host.
// ─────────────────────────────────────────────────────────────────────────────

import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { logger } from "./logger";
import type { ReolinkCreds } from "./reolinkCrypto";

type Scheme = "https" | "http";

export type SnapshotError = "unreachable" | "auth" | "no_image" | "blocked";

export type SnapshotResult =
  | { ok: true; jpeg: Buffer }
  | { ok: false; error: SnapshotError };

interface TokenEntry {
  token: string;
  scheme: Scheme;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenEntry>();
// Per-request timeout. A healthy login+snap completes in ~1–2s, so 6s leaves
// ample headroom while letting a dead/slow path fail fast — important because a
// failed snapshot otherwise blocks the caregiver's pseudo-live feed.
const REQUEST_TIMEOUT_MS = 6000;
const TOKEN_TTL_MS = 50 * 60 * 1000; // Reolink tokens last ~1h; refresh a bit early.

interface RawResponse {
  status: number;
  buf: Buffer;
  contentType: string;
}

function rawRequest(opts: {
  scheme: Scheme;
  host: string; // original hostname — used only for the Host header / TLS SNI
  connectIp: string; // pre-vetted IP we actually open the socket to (SSRF-safe)
  port: number;
  path: string;
  method: "GET" | "POST";
  body?: string;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const defaultPort = opts.scheme === "https" ? 443 : 80;
    const headers: Record<string, string | number> = {
      // Preserve the camera's real hostname so its CGI vhost still matches, but
      // never let it influence which address we connect to.
      Host: opts.port === defaultPort ? opts.host : `${opts.host}:${opts.port}`,
    };
    if (opts.body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(opts.body);
    }

    // Connect by the vetted IP literal (not the hostname) so a rebinding DNS
    // record can't swing the second resolution at connect time to an internal
    // target (TOCTOU). The hostname only survives in the Host header / SNI.
    const common = {
      host: opts.connectIp,
      port: opts.port,
      path: opts.path,
      method: opts.method,
      headers,
    };

    const req =
      opts.scheme === "https"
        ? https.request(
            { ...common, rejectUnauthorized: false, servername: opts.host },
            onResponse,
          )
        : http.request(common, onResponse);

    function onResponse(res: http.IncomingMessage) {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          buf: Buffer.concat(chunks),
          contentType: String(res.headers["content-type"] ?? ""),
        }),
      );
    }

    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("timeout"));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** True for any non-globally-routable IPv4 address (treats malformed as unsafe). */
function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split(".").map((s) => Number(s));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → fail closed
  }
  const [a, b, c] = p;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

/** SSRF block-list: any loopback / private / link-local / reserved address. */
function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return ipv4IsPrivate(ip);
  if (kind === 6) {
    let low = ip.toLowerCase();
    const zone = low.indexOf("%"); // strip scope id (fe80::1%eth0)
    if (zone !== -1) low = low.slice(0, zone);

    // IPv4-mapped/-embedded IPv6 — evaluate the embedded v4 (::ffff:127.0.0.1
    // and ::ffff:7f00:1 both mean loopback). Fail closed on any other ::ffff:.
    const mappedDotted = low.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) return ipv4IsPrivate(mappedDotted[1]);
    const mappedHex = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return ipv4IsPrivate(
        `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`,
      );
    }
    if (low.startsWith("::ffff:")) return true;

    if (low === "::1" || low === "::") return true; // loopback / unspecified
    if (low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb"))
      return true; // fe80::/10 link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // fc00::/7 unique-local
    if (low.startsWith("ff")) return true; // ff00::/8 multicast
    if (low.startsWith("2001:db8")) return true; // documentation
    if (low.startsWith("64:ff9b")) return true; // NAT64
    if (low.startsWith("100:")) return true; // 100::/64 discard-only
    return false;
  }
  return true; // not a valid IP literal → fail closed
}

// DEV/TEST ESCAPE HATCH — when REOLINK_ALLOW_PRIVATE_HOSTS="true" the SSRF guard
// permits loopback/private/LAN addresses. This is ONLY for local development or a
// self-hosted server that physically sits on the same network as the camera (e.g.
// testing a Reolink at 192.168.x.x). It MUST stay unset in the Replit-hosted /
// production environment — a cloud server can't reach a LAN anyway, and allowing
// private targets there would re-open the SSRF hole the rest of this guard closes.
let warnedPrivateAllowed = false;
function allowPrivateHosts(): boolean {
  // Hard guardrail: the escape hatch is ignored in production regardless of the
  // env var, so a misconfigured deploy can never relax the SSRF guard. A cloud
  // prod server can't reach a LAN anyway, so this loses no legitimate capability.
  if (process.env.NODE_ENV === "production") return false;
  return process.env.REOLINK_ALLOW_PRIVATE_HOSTS === "true";
}

/**
 * SSRF guard / resolver. Returns a single vetted IP literal to connect to, or
 * null if the host is disallowed. Resolving here (once) and connecting by the
 * returned IP closes the DNS-rebinding TOCTOU window: every resolved address
 * must be public, and we never re-resolve the hostname at connect time.
 *
 * If REOLINK_ALLOW_PRIVATE_HOSTS is set, private/loopback targets are allowed
 * (local testing only — see the note above).
 */
export async function resolveCameraIp(host: string): Promise<string | null> {
  if (!host) return null;
  const allowPrivate = allowPrivateHosts();
  if (allowPrivate && !warnedPrivateAllowed) {
    warnedPrivateAllowed = true;
    logger.warn(
      "REOLINK_ALLOW_PRIVATE_HOSTS is enabled — SSRF guard permits private/LAN addresses. Do NOT use this in production.",
    );
  }

  const h = host.toLowerCase();
  if (!allowPrivate && (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal"))) {
    return null;
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host) && !allowPrivate) return null;
    return host;
  }
  try {
    const results = await dns.lookup(host, { all: true });
    if (results.length === 0) return null;
    if (!allowPrivate && !results.every((r) => !isPrivateIp(r.address))) return null;
    return results[0].address;
  } catch {
    return null;
  }
}

/** Boolean convenience wrapper around {@link resolveCameraIp} for setup checks. */
export async function isAllowedCameraHost(host: string): Promise<boolean> {
  return (await resolveCameraIp(host)) !== null;
}

async function login(
  scheme: Scheme,
  host: string,
  connectIp: string,
  port: number,
  creds: ReolinkCreds,
): Promise<string | null> {
  const body = JSON.stringify([
    {
      cmd: "Login",
      action: 0,
      param: { User: { userName: creds.username, password: creds.password } },
    },
  ]);
  const r = await rawRequest({
    scheme,
    host,
    connectIp,
    port,
    path: "/cgi-bin/api.cgi?cmd=Login",
    method: "POST",
    body,
  });
  if (r.status !== 200) return null;
  try {
    const json = JSON.parse(r.buf.toString("utf8")) as Array<{
      value?: { Token?: { name?: string } };
    }>;
    const token = json?.[0]?.value?.Token?.name;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

async function snap(
  scheme: Scheme,
  host: string,
  connectIp: string,
  port: number,
  token: string,
): Promise<Buffer | null> {
  const rs = Math.random().toString(36).slice(2);
  const r = await rawRequest({
    scheme,
    host,
    connectIp,
    port,
    path: `/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=${rs}&token=${encodeURIComponent(token)}`,
    method: "GET",
  });
  if (r.status !== 200) return null;
  // On an expired/invalid token Reolink returns a JSON error envelope, not an
  // image. Treat any JSON body (or implausibly tiny payload) as "not an image".
  if (r.contentType.includes("application/json")) return null;
  if (r.buf.length < 100) return null;
  return r.buf;
}

/**
 * Fetch a single JPEG snapshot from the camera. Tries a cached token first,
 * then logs in (https then http). Returns a structured error so the route can
 * map it to the right client message ("offline" vs "wrong password").
 */
export async function fetchSnapshot(
  host: string,
  port: number,
  creds: ReolinkCreds,
): Promise<SnapshotResult> {
  // Resolve + vet the host ONCE, then connect only to the returned IP. This is
  // both the SSRF allow-check and the fix for DNS-rebinding TOCTOU.
  const connectIp = await resolveCameraIp(host);
  if (!connectIp) {
    return { ok: false, error: "blocked" };
  }

  const cacheKey = `${host}:${port}:${creds.username}`;
  const cached = tokenCache.get(cacheKey);

  // Fast path — reuse a cached token on the scheme that last worked.
  if (cached && cached.expiresAt > Date.now()) {
    try {
      const jpeg = await snap(cached.scheme, host, connectIp, port, cached.token);
      if (jpeg) return { ok: true, jpeg };
    } catch {
      // fall through to re-login
    }
    tokenCache.delete(cacheKey);
  }

  // Prefer the scheme that matches the port (80 → http, else https), then fall
  // back to the other. Local cameras typically expose plain HTTP on :80; trying
  // http first there avoids a wasted TLS handshake against a non-TLS port.
  const preferred: Scheme = port === 80 ? "http" : "https";
  const fallback: Scheme = preferred === "https" ? "http" : "https";
  const order: Scheme[] = cached
    ? [cached.scheme, cached.scheme === "https" ? "http" : "https"]
    : [preferred, fallback];

  let lastError: SnapshotError = "unreachable";
  for (const scheme of order) {
    let token: string | null;
    try {
      token = await login(scheme, host, connectIp, port, creds);
    } catch (e) {
      lastError = "unreachable"; // connection refused / timeout / TLS
      // A timeout means the host/port isn't responding at all — trying the other
      // scheme on the SAME dead port just doubles the wait (the bug that made a
      // failed snapshot cost ~16s). Fast-fail; only fall through to the other
      // scheme on a non-timeout error (e.g. a TLS/protocol mismatch).
      if (e instanceof Error && e.message === "timeout") break;
      continue;
    }
    if (!token) {
      // Reachable but login returned no token → almost always bad credentials.
      lastError = "auth";
      continue;
    }
    let jpeg: Buffer | null;
    try {
      jpeg = await snap(scheme, host, connectIp, port, token);
    } catch (e) {
      lastError = "unreachable";
      if (e instanceof Error && e.message === "timeout") break;
      continue;
    }
    if (jpeg) {
      tokenCache.set(cacheKey, {
        token,
        scheme,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      });
      return { ok: true, jpeg };
    }
    lastError = "no_image";
  }

  logger.info(
    { port, error: lastError, hostHint: host.split(".")[0] },
    "Reolink snapshot fetch failed",
  );
  return { ok: false, error: lastError };
}
