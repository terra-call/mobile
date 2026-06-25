---
name: EAS Update / OTA from Replit
description: How to reliably publish expo OTA updates and which channel the devices use
---

# Run `eas update` as a WORKFLOW, never a bash background job

`npx eas-cli update` does a full Metro export that takes many minutes. Launching
it from the bash tool (`nohup ... &`, `setsid ...`) is unreliable here: the
background process gets reaped / SIGTERM'd (exit 143) between agent tool calls,
and it died silently mid-"Exporting..." twice (~25 min each) with no error.

**What works:** run it via a temporary Replit workflow:
`configureWorkflow({name:"EAS Update", command:"cd artifacts/mobile && CI=1 npx eas-cli@latest update --branch <branch> --message '...' --non-interactive", outputType:"console"})`,
poll `getWorkflowStatus`, then `removeWorkflow` when done. The workflow system
keeps the process alive independent of tool calls and gives clean logs.

**Gotchas:**
- Use `--branch <name>` not `--channel <name>` — the `--channel` form silently
  died/hung here; `--branch preview` exported fine.
- Set `CI=1` so output is plain progress lines instead of an ora spinner that
  writes nothing useful when redirected (you otherwise just see "- Exporting...").
- It was NOT an OOM issue (checked: GBs free, oom_kill=0). The bash-job deaths
  were process reaping, not memory.

# Device channel / runtime facts

- All Android builds are EAS profile/channel **`preview`**, internal distribution.
  The caregiver tablet runs that preview APK.
- `runtimeVersion.policy = "appVersion"`, so runtime == `expo.version`. JS-only
  changes keep the same runtime, so OTA updates reach existing installs without a
  rebuild. **Manual bump rule lives in `replit.md`**: bump `expo.version` whenever
  the native layer changes so stale OTA can't land on a mismatched binary.
- App has `expo-updates` + `updates.url` configured, so installs pull OTA on a
  full cold start (kill from recents + reopen — background/foreground won't fetch).
- `eas.json` has `appVersionSource: "remote"` — this only controls Android
  `versionCode`/iOS `buildNumber` (EAS manages those; the `versionCode` in app.json
  is ignored). The semantic `version` is still read from app.json, so the
  `appVersion` runtime policy correctly reflects the app.json bump.
- EAS projectId 715d9c4f-6a1b-407b-8b3a-e2a43d458682, owner `terracall`.

# fingerprint runtime policy is a dead end in this monorepo

Tried `runtimeVersion.policy = "fingerprint"` to auto-bump runtime on native
changes. **It cannot build here:** every EAS build aborts in CONFIGURE_EXPO_UPDATES
with "Runtime version mismatch — local vs EAS". Cause: this is a pnpm monorepo with
CNG (no committed android/ios). EAS runs `expo prebuild`, which adds a generated
`android/` bareNativeDir + pnpm-specific autolinking paths that the local
fingerprint never sees, so local and EAS fingerprints structurally cannot match.
Confirmed across builds via both `EAS_NO_VCS=1` and a git-VCS temp workflow.
**Do not retry fingerprint — use appVersion + manual bump.**
