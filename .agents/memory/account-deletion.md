---
name: Account deletion flow
description: Self-service delete-account design, its Firestore rules dependency, and demo review accounts
---

# Self-service account deletion (store compliance)

- Client-side flow: re-auth with password → audit log → **PHI scrub via tombstone
  setDoc MUST succeed before `deleteUser`** (otherwise a PHI doc is orphaned with
  no owner able to remove it) → caregiver cascade removes self from recipients'
  `permittedCaregivers`/`permittedCaregiverIds` → best-effort deleteDoc →
  best-effort `/api/notify/schedule/remove` for recipients → deleteUser → local cache clear.
- **Deployed Firestore rules dependency**: the live rules (published manually in
  Firebase Console — repo `firestore.rules` is only a reference) must include
  (a) self-delete on users docs and (b) the caregiver self-removal update clause
  (affectedKeys hasOnly link fields + resulting ID list == old minus caller uid).
  Until published, deleteDoc and cascade silently no-op; the tombstone scrub still
  removes PHI, so the flow degrades safely.
- `account_deleted` is a valid AuditAction.

# Apple review demo accounts

- Live linked pair created via Firebase Auth REST (script `scripts/create-demo-accounts.mjs`,
  re-runnable/idempotent): review.caregiver@terra-call.com and
  review.recipient@terra-call.com; credentials recorded in
  `attached_assets/store-submission/store-listing-copy.md` reviewer notes.
