---
name: iOS EAS local credentials
description: How iOS builds are signed for this project — first-cert non-interactive limitation, ASC API workaround, bundle ID split from Android
---

**Rule:** iOS builds use `credentialsSource: "local"` (profile level in eas.json) with `artifacts/mobile/credentials.json` + `credentials/` (gitignored). Certificates/profiles are created directly via the App Store Connect API (`scripts/setup-ios-credentials.mjs`, `scripts/fix-ios-profile.mjs`), not by EAS.

**Why:** eas-cli cannot create a team's FIRST distribution certificate non-interactively (throws "Distribution Certificate is not validated for non-interactive builds"); the ASC-key auth path only covers provisioning profiles. Also note: `credentialsSource` under `build.production.ios` was NOT picked up in one run — put it at profile level.

**Key facts:**
- iOS bundle ID is `com.terracall.app` (NOT `com.terracall.mobile` — that identifier is taken globally by another Apple team). Android package stays `com.terracall.mobile`.
- The provisioning profile must include the Push Notifications capability or the Xcode build fails with "doesn't support Push Notifications capability"; enable via POST /v1/bundleIdCapabilities, then regenerate the profile (profiles are immutable).
- ASC API key p8 secret is stored as ONE line — always re-wrap base64 at 64 chars into PEM before use.
- App Store Connect app records CANNOT be created via the API — user must create them in the ASC UI; then `eas submit` needs `ascAppId` in the submit profile (Terra Call = 6800145154).
- Apple limit: 2 distribution certs per team; setup script creates a new one each run — reuse/clean up.
