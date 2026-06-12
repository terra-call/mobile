---
name: Caregiver alert history
description: Why per-press emergency alerts live on the recipient user doc, not the events collection
---

# Caregiver-visible alert history lives on the recipient user doc

Per-press emergency alerts that caregivers see are stored as a capped, newest-first
`recentAlerts[]` array (plus `lastEmergencyAt`) **on the recipient's `users/{uid}` doc**,
NOT in the `events` collection.

**Why:** the `events` collection is admin-only readable in `firestore.rules`
(`allow read: if isAdmin()`), so caregivers can never read it. Caregivers already
subscribe to recipient user docs via `onSnapshot`, so writing alerts onto the user
doc gives real-time caregiver visibility with **no new Firestore rules/collection/index**
to deploy manually. The admin-facing `events` write (`logEvent("manual_emergency")`)
is kept in parallel — admins still get per-press events there.

**How to apply:**
- Append must be atomic — use `runTransaction` on the user doc (read prev array +
  smsConsent, write merged array + status + lastEmergencyAt in one tx). A plain
  getDoc→updateDoc loses updates under rapid repeated presses (each press is its
  own row, so a lost update = a missing alert). There is a best-effort direct-write
  fallback if the transaction throws (offline/contention).
- `serverTimestamp()` CANNOT live inside an array element, so each `AlertEntry.at`
  is a client ISO-8601 UTC string (display-only; clock skew tolerated). `lastEmergencyAt`
  (a top-level field) does use `serverTimestamp()`.
- Each entry carries a stable `id` (`${Date.now()}-${random}`) used as the React
  list key in the caregiver feed; `id` is optional for backward-compat (feed falls
  back to a composite `${recipientId}-${at}-${idx}` key).
- StatusCard shows `lastEmergencyAt` (not `lastCheckIn`) when status === "emergency"
  — emergencies don't touch lastCheckIn, so using lastCheckIn showed a stale time.
