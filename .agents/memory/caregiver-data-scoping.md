---
name: Caregiver care-receiver list is unfiltered (client-side)
description: Why any new caregiver-side feature that surfaces recipient PHI must self-gate on permittedCaregiverIds.
---

# Caregiver care-receiver list scoping

FIXED (Aug 2026): `CareDataContext` now filters the caregiver's list client-side
to recipients whose `permittedCaregiverIds`/`permittedCaregivers` include the
caregiver's uid; only admins see all recipients. The Firestore query itself is
still broad (role == care-receiver) and the read rule still allows any signed-in
user to read user docs — so the guidance below still applies to any NEW surface
that bypasses `careReceivers`. The hard access boundary remains **server-side**
via `isPermittedForReceiver`.

**Why:** This means a caregiver-side feature that merely reads `careReceivers`
and acts on it (e.g. auto-popping an emergency home-camera modal) can act on
recipients the caregiver is NOT actually linked to — leaking recipient identity /
status (PHI) even though the actual camera frames stay protected by the server
proxy.

**How to apply:** Any new caregiver-side surface that exposes recipient PHI
(modals, alerts, auto-actions) must self-gate on linkage. `CareReceiver` exposes
`permittedCaregiverIds` (derived from the recipient's `permittedCaregivers`) —
require `r.permittedCaregiverIds.includes(currentUser.id)` before surfacing. For
push-triggered surfaces, the push is already targeted to linked caregivers, so
gate when the recipient is loaded and fall back to best-effort on cold start.
