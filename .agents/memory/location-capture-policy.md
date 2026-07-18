---
name: Location capture policy
description: Care-recipient location is captured only at explicit check-in/emergency moments — no background tracking.
---

- User-approved (July 2026): location is captured ONLY when the recipient taps "I'M OK" or triggers an emergency — never in the background. Do not add periodic/background tracking without explicit sign-off.
- **Why:** privacy/HIPAA posture; caregiver map only needs last-known check-in spot.
- **How to apply:** capture is fire-and-forget and best-effort — permission denial, timeout, or GPS failure must never block or delay the check-in/emergency flow.
- Known follow-up: Firestore `users` read rule is broad (`isSignedIn()`), so location (like name/status before it) is readable by any authenticated account; tightening requires coordinated query+rules changes and manual Firebase Console deploy.
