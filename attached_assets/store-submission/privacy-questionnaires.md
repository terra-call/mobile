# Terra Call — Privacy Questionnaire Answers

Based on what the app actually collects: Firebase Auth (email, name, phone), Firestore
(check-in status, events, location at check-in/emergency), Twilio (video/SMS), push tokens,
encrypted Reolink credentials, audit logs. No ads, no analytics SDKs, no data sale.

---

## APPLE — App Privacy (App Store Connect → App Privacy)

Answer "Yes, we collect data from this app."

### Data types collected

**Contact Info**
- Name — Collected, Linked to identity, App Functionality. Not used for tracking.
- Email Address — Collected, Linked, App Functionality.
- Phone Number — Collected, Linked, App Functionality (SMS alerts, gated by consent).

**Location**
- Precise Location — Collected, Linked, App Functionality. NOT continuous: captured only
  on check-in/emergency. Not used for tracking.

**Health & Fitness** — NOT collected. (Check-in status is a safety/welfare signal, not
health data; do NOT declare Health & Fitness unless you add health features.)

**User Content**
- Photos or Videos — Collected (live video streams during calls), Linked, App Functionality.
  Note: streams are real-time via Twilio; if not stored, you may still declare as collected
  since it's transmitted off device.
- Audio Data — Collected (video call audio), Linked, App Functionality.

**Identifiers**
- User ID — Collected, Linked, App Functionality (Firebase UID, push tokens).

**Usage Data / Diagnostics** — Not collected (no analytics SDK). If you later add
crash reporting, update this.

### Tracking
"No, we do not use data for tracking purposes." (No ads, no data brokers, no cross-app tracking.)

---

## GOOGLE — Data safety form (Play Console → App content → Data safety)

- Does your app collect or share user data? **Yes, collects. No sharing for ads.**
- Is all data encrypted in transit? **Yes** (HTTPS/TLS everywhere; camera creds AES-GCM at rest).
- Can users request data deletion? **Yes** — you must provide a deletion path/URL
  (account deletion is an Apple requirement too — see gaps below).

### Data types
| Data type | Collected | Shared | Purpose |
|---|---|---|---|
| Name | Yes | No | App functionality, Account management |
| Email address | Yes | No | App functionality, Account management |
| Phone number | Yes | No | App functionality (SMS alerts w/ consent) |
| Precise location | Yes | No | App functionality (emergency/check-in only) |
| Photos/videos (live video) | Yes | No | App functionality (video calls) |
| Voice/audio (call audio) | Yes | No | App functionality (video calls) |
| User IDs | Yes | No | App functionality |
| App interactions (check-in events) | Yes | No | App functionality |

Twilio/Firebase are service providers (processors), not "sharing" in Play's definition
(sharing = transferring to third parties for their own purposes — you don't).

### Play permission declarations
- CAMERA / RECORD_AUDIO: video check-in calls with consent (core feature).
- ACCESS_FINE_LOCATION: emergency/check-in location sharing (core feature). NOT background location — do not declare background access.
- POST_NOTIFICATIONS: safety alerts.

---

## GAPS TO CLOSE BEFORE/DURING REVIEW (both stores)

1. **Account deletion**: Apple (5.1.1(v)) and Google both require an in-app way to
   delete the account, or at minimum a clearly linked web flow. If the app doesn't
   have one yet, add "Delete my account" to settings before submitting — this is a
   common rejection reason.
2. **Demo accounts** for Apple review (caregiver + recipient pair, linked).
3. Privacy policy URL must be reachable without login and mention: what's collected,
   video/audio transmission, location, SMS consent, retention, deletion contact.
4. If the recipient app is intended for seniors, keep age rating 4+/Everyone; no
   restricted content applies.
