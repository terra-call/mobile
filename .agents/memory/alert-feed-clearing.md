---
name: Alert feed clearing
description: Why caregiver "clear check-ins/alerts" is a per-caregiver watermark, not a delete
---

# Clearing the caregiver alert feed is a watermark, never a delete

The dashboard "Clear" action stores an `alertsClearedAt` ISO timestamp on the
CAREGIVER's own `users/{uid}` doc; the feed hides entries at/before it.

**Why:** `recentAlerts[]` lives on the RECIPIENT's user doc, which (a) the
caregiver cannot write — firestore.rules only allow users to update their own
doc (or admin) — and (b) is shared by every caregiver of that recipient, so a
real delete would wipe other caregivers' views and destroy HIPAA-relevant
history. The watermark is non-destructive, needs no rules change, and syncs
across the caregiver's devices.

**How to apply:** any future "clear/hide history" feature on shared recipient
data should use the same per-viewer watermark pattern on the viewer's own doc.
Clears are audit-logged (`alert_history_cleared` in AuditAction). Watermark is
loaded once on mount (getDoc, not onSnapshot) — cross-device clears show after
refresh/remount only.
