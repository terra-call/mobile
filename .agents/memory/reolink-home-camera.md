---
name: Reolink Home Camera (server snapshot proxy)
description: How the secondary "Home Camera" feed works and the SSRF rules any user-host proxy here must follow
---

# Reolink "Home Camera" — server-proxied snapshot feed

Secondary caregiver video feed alongside the Twilio "Phone Camera". Reolink has
**no cloud snapshot API**, so remote viewing = the camera's own CGI HTTP API at a
public address (Reolink DDNS + forwarded port). The server logs in (`cmd=Login`)
and pulls single JPEGs (`cmd=Snap`); the caregiver app polls the proxy ~1.5s to
fake a live feed (no MJPEG/RTSP). Available to all care recipients (no plan gate).

**Credential model:** camera user/password live ONLY as AES-256-GCM ciphertext on
the recipient's Firestore user doc (`reolink.enc`), key derived from
`SESSION_SECRET` via HKDF. Server decrypts at proxy time; the caregiver client
never receives plaintext. Ciphertext is safe to be signed-in-readable, so **no
firestore.rules change** was needed.

# SSRF rules for ANY proxy of a user-supplied host (camera or otherwise)

The snapshot host is attacker-controllable, so the proxy is a textbook SSRF sink.
Two non-obvious requirements that a naive allow-check misses:

1. **Block the full private/reserved set, including IPv4-mapped IPv6.** A guard
   that only checks dotted-quad v4 + `::1`/`fe80`/`fc`/`fd` is bypassable: Node's
   `net.isIP("::ffff:127.0.0.1")` returns 6, so the v4 loopback slips through.
   Decode `::ffff:` (both dotted and hex forms) back to v4 and evaluate it, and
   cover CGNAT (100.64/10), link-local/metadata (169.254/16), TEST-NETs,
   benchmark (198.18/15), multicast/reserved (≥224), and fail closed on malformed.

2. **Resolve once, then connect by the vetted IP — never re-resolve at connect.**
   `dns.lookup` for the allow-check + `http.request({host})` doing its own second
   lookup is a DNS-rebinding TOCTOU: the check sees a public IP, the socket hits a
   private one. Fix: resolve to a vetted IP literal, open the socket to that IP,
   and carry the original hostname only in the `Host` header / TLS `servername`.

**Why:** architect review flagged both as ship-blockers; verified with a 21-case
IP table. **How to apply:** any future feature that fetches a user-provided URL
from the server must reuse `resolveCameraIp`-style vetting, not a bare
hostname allow-check.

Reolink cameras serve self-signed TLS, so the camera connection uses
`rejectUnauthorized:false` (camera socket ONLY). Try https then http; cache the
token per camera. Never log creds, tokens, or full host.

# Cloud-vs-LAN reachability (why local-IP camera testing can't run from Replit)

The api-server runs in Replit's CLOUD, not on the user's home network. A camera at
a private LAN IP (e.g. 192.168.1.215) is only reachable from inside that house, so
the server-snapshot-proxy design **cannot reach it from Replit at all** — a curl
from the container times out. No code change fixes this; it's a network-topology
fact. To actually test against a physical Reolink you need a publicly reachable
address (router port-forward → public IP/DDNS), which is also the production path.

To allow local/private targets for on-network dev or a self-hosted server, the SSRF
guard honors `REOLINK_ALLOW_PRIVATE_HOSTS=true` — but it is hard-disabled whenever
`NODE_ENV=production`, so a misconfigured prod deploy can never relax the guard.
The integration logic is verifiable without a real camera via a localhost mock of
`cmd=Login`/`cmd=Snap`, decoupling "is the code correct" from "can we reach the LAN".
**Why:** user asked to "test snapshot against local camera first" — impossible from
cloud; surfaced the blocker instead of shipping something that can't work.
