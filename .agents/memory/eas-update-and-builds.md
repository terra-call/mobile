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

- All Android builds are EAS profile/channel **`preview`**, internal distribution,
  appVersion **1.0.0**. The caregiver tablet runs that preview APK.
- `runtimeVersion.policy = "appVersion"` (currently 1.0.0). JS-only changes keep
  the same runtime, so OTA updates reach existing installs without a rebuild.
- App has `expo-updates` + `updates.url` configured, so installs pull OTA on a
  full cold start (kill from recents + reopen — background/foreground won't fetch).
- EAS projectId 715d9c4f-6a1b-407b-8b3a-e2a43d458682, owner `terracall`.
