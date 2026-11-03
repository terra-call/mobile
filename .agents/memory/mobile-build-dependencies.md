---
name: Mobile build dependency reproducibility
description: Cloud pnpm compatibility and Expo prebuild manifest mutations
---

Keep cloud builds on a pnpm version compatible with the workspace lockfile and catalogs. Do not bypass frozen-lockfile failures to hide incompatible tooling or manifest drift.

**Why:** A GitHub-triggered build ignored an incompatible lockfile, then reported it missing. With the workspace's pnpm version, a separate manifest mismatch became visible.

**How to apply:** Check the first install warning, pin compatible tooling, and validate with a frozen lockfile before another cloud attempt.

Expo prebuild can insert duplicate Expo/React/React Native dependencies even when dependency updates are skipped.

**Why:** A literal React version inserted alongside a catalog-based declaration caused a frozen install to fail despite both resolving to the same version.

**How to apply:** Review package manifest changes after prebuild. Preserve the original dependency declarations instead of committing redundant generated entries, then rerun the frozen-lockfile check.
