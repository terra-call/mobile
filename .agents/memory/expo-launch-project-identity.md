---
name: Expo Launch project identity
description: Replit-managed Launch builds can use a different Expo account and project than the checked-in app configuration.
---

Do not assume that the checked-in Expo owner and slug identify the project
used by Replit Expo Launch.

**Why:** Actual Launch credential-resolution logs identified a separate
Replit-managed account/project, while the source still pointed to the older
Expo project. Sending the source-derived dashboard link did not lead the user
to the Launch builds.

**How to apply:** Use Launch workflow evidence to identify the build's account
and project before sharing a dashboard link. Distinguish that identity from the
source configuration, and do not assume a personal Expo login has access to the
managed account. Do not change owner, project ID, update URL or signing merely
to make a dashboard link accessible.
