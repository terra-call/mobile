---
name: Native runtime compatibility
description: Expo Launch's native-directory handling and earlier fingerprint mismatch constrain runtime versioning.
---

Expo Launch can include local, Git-ignored native directories in its build
snapshot. A clean Git status does not mean it will run in managed/CNG mode.
Its bare-workflow configuration resolver rejects automatic runtime policies.

**Why:** A real Launch attempt reached signing successfully but failed before
native compilation because generated native directories were detected while
the app used an automatic runtime policy. Use an explicit runtime rather than
assuming Git ignore rules will prevent native-directory detection.

**How to apply:** Follow the runtime bump rule in `replit.md`. When diagnosing
this failure, compare app configuration with generated native runtime values;
do not change bundle identifiers, credentials or update channels to fix it.

Avoid fingerprint-based runtimes in this pnpm/CNG environment.

**Why:** Local and cloud fingerprints previously differed after native
generation and pnpm autolinking, preventing builds from progressing.

**How to apply:** Preserve explicit native compatibility boundaries and use a
new native binary for changes to native modules or capabilities.
