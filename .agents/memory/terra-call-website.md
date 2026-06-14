---
name: terra-call.com marketing/legal website (external)
description: The public website is NOT in this Replit project; how to verify its deploys and why Twilio A2P kept failing.
---

# terra-call.com — external site, not in this repo

The public marketing/legal site at terra-call.com is built on a separate "Vibe" platform and fronted by Cloudflare. It is NOT one of this project's artifacts (this repo only has mobile, api-server, mockup-sandbox). You can VIEW it (curl + external_url screenshot) but cannot edit its source from here. Edits/deploys happen on the external platform.

## Verifying a deploy actually went live
- **Trust the hashed JS bundle, not `last-modified`.** The page is a Vite SPA; the real content lives in `/assets/index-<hash>.js`. A genuine code change produces a NEW hash. If the bundle hash is unchanged, the new build is NOT live even if `last-modified` moved or byte size changed (those can shift from meta-tag-only edits).
- To check what the homepage renders without depending on render caches: `curl` the bundle and grep for telltale strings (e.g. "Join the Waitlist" vs "Get Started", "missed check-ins and emergencies" vs "launch updates").

## Cloudflare edge cache gotchas
- HTML is served with `cache-control: ... s-maxage=86400` → 24h edge cache. `cf-cache-status: HIT` means you're seeing a cached copy.
- `<meta http-equiv="Cache-Control" no-cache>` tags do NOTHING for the CDN — Cloudflare obeys the HTTP response header only.
- A bare-URL screenshot can show a stale render while `?fresh=1` shows the new build. Tell the user to **Purge Everything** in Cloudflare before relying on the plain URL (and before Twilio review).

## Twilio A2P 10DLC rejection (error 30919 + CTA verification)
Three things the reviewer checks on the LIVE public URL:
1. Crawlable business info WITHOUT JS — the SPA must server-render business name/description, contact, and legal links in `<div id="root">` (else scanner sees blank page).
2. Site must NOT read as "under development" (no "Launching soon" / waitlist framing).
3. Opt-in CTA wording on the site must MATCH the campaign consent exactly ("missed check-ins and emergencies", "Msg frequency varies", "Msg & data rates may apply", "Reply STOP to cancel, HELP for help").
4. Privacy policy must contain the exact sentence: opt-in data is "never shared, sold, or provided to third parties or lead generators".

**Why:** Twilio reviewers fetch the live, possibly-cached production URL with a JS-less scanner. Stale Cloudflare cache or an un-published build = same old page = repeat rejection, even when the user's own browser shows the fixed version.
