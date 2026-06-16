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

# Both sides need mic OS perm (calls are two-way audio); publisher also needs camera

Calls are two-way audio: BOTH the publish and view sides connect with
`enableAudio: true` and must therefore hold OS RECORD_AUDIO. Only the publisher
also needs CAMERA (`enableVideo` is true only for `mode === "publish"`). On
Android, `Twilio.connect()` with audio/video enabled but the matching OS perm
ungranted hangs forever (stuck on "Joining room…"), so camera-stream lazily
`require("expo-camera")` and requests perms *before* connect on every native
platform: mic on both modes, camera only when publishing — bailing with a
visible error if denied. Already-granted perms are a no-op.

**Why:** the viewer originally connected audio-only-off, so the caregiver could
see but not talk to the recipient (and vice-versa). Enabling remote+local audio
on both sides requires the viewer's mic perm too, or the Android hang reappears
on the viewer. Speaker routing/remote audio is reinforced in `onRoomDidConnect`
(`toggleSoundSetup(true)` + `setRemoteAudioEnabled(true)`) and in
`onParticipantAddedAudioTrack` for late-joining tracks.
