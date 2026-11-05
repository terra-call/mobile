---
name: Mobile build dependency reproducibility
description: Cloud pnpm compatibility and Expo prebuild manifest mutations
---

Keep cloud builds on a pnpm version compatible with the workspace lockfile and catalogs. Do not bypass frozen-lockfile failures to hide incompatible tooling or manifest drift.

**Why:** A GitHub-triggered build ignored an incompatible lockfile, then reported it missing. With the workspace's pnpm version, a separate manifest mismatch became visible.

**How to apply:** Check the first install warning, pin compatible tooling, and validate with a frozen lockfile before another cloud attempt.

Pin the cloud Node runtime as well as pnpm; do not patch Metro or polyfill build-tool internals to accommodate an obsolete builder runtime.

**Why:** A cloud builder reached Metro but failed on `Array.prototype.toReversed`, which the older runtime did not support. Local success on a newer Node runtime did not expose that mismatch.

**How to apply:** Match the Node runtime to the installed Expo/React Native tooling requirements before investigating application JavaScript when Metro itself cannot load.

For GitHub-triggered Android builds, explicitly select an SDK-compatible build image rather than fixing tool versions individually on a legacy image.

**Why:** After Node and pnpm were corrected, the same build path still ran Gradle under Java 11, while the Android Gradle plugin required Java 17. Pinning Node does not upgrade Java or the Android toolchain.

**How to apply:** Verify the image's Java and NDK versions against Expo's infrastructure documentation. Keep the SDK-compatible image and any explicit Node/pnpm overrides consistent.

Expo prebuild can insert duplicate Expo/React/React Native dependencies even when dependency updates are skipped.

**Why:** A literal React version inserted alongside a catalog-based declaration caused a frozen install to fail despite both resolving to the same version.

**How to apply:** Review package manifest changes after prebuild. Preserve the original dependency declarations instead of committing redundant generated entries, then rerun the frozen-lockfile check.
