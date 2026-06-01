---
name: Video call mode (publish/view) is NOT the account role
description: camera-stream `mode` is the media role on a device, decoupled from caregiver/recipient; targetUserId is always the room owner (recipient)
---

# `mode` (publish/view) ≠ account role

`camera-stream.tsx`'s `mode` param is the MEDIA role on *that* device, not the
user's account role. Either party can publish depending on call direction:
- Caregiver-initiated emergency: recipient publishes, caregiver views.
- Recipient-initiated "Call My Caregiver": caregiver publishes, recipient views
  (recipient wanted to *see* the caregiver).

**Rule:** never derive `targetUserId`, the "other party" name, or audit role
labels from `mode`. The Twilio room is always keyed on the care-recipient's uid
(the room "owner"); the server's `/api/video/token` requires
`targetUserId == recipient uid` for BOTH sides of a `tc-call-*` / `tc-emrg-*`
room and does not care who publishes. So `targetUserId = receiverId ?? user.id`
(explicit room-owner param, falling back to the signed-in uid only on the
recipient-publishes flows that omit it). Pass an explicit `otherPartyName` from
every navigator; derive self-label from `user.role`, not `mode`.

**Why:** the original code conflated publish==recipient. Flipping the call
direction (so the caregiver publishes) silently sent the caregiver's uid as
targetUserId and broke the token mint + showed the wrong banner name.

# Publisher must hold camera+mic OS perms or Android connect hangs

Whichever device publishes (`enableVideo`/`enableAudio` true) needs OS CAMERA +
RECORD_AUDIO. On Android, `Twilio.connect()` with those enabled but ungranted
hangs forever (stuck on "Joining room…"). The recipient gets perms via the
consent flow, but the caregiver tablet does not — so the publish path in
camera-stream lazily `require("expo-camera")` and requests both perms before
connect, bailing with a visible error if denied. Already-granted perms are a
no-op, so this is safe for the recipient-publish flows too.
