---
name: Native incoming call constraints
description: Why native call delivery uses separate push credentials and preserves the existing Expo/OS compatibility.
---

Use CallKeep for system call UI while keeping Twilio Video as the media layer
and Firestore as authenticated signaling. Preserve Expo SDK 54 and its OS
minimums rather than adopting a replacement that requires a framework upgrade.

**Why:** Native incoming calls were explicitly requested without a broader
Expo migration. CallKit/ConnectionService alone cannot wake a closed app.
They require separate PushKit/APNs VoIP and high-priority FCM delivery paths.

**How to apply:** Native changes require a new runtime and signed native
candidate; do not treat browser previews, JavaScript export or configuration
generation as proof that lock-screen calls or call audio work.

APNs provider keys are not App Store Connect API keys. FCM credentials uploaded
to Expo's push service are also not automatically available to this backend.
The separate FCM-only Firebase project must not replace the app's original
Auth/Firestore project.

**Why:** Confusing these credentials can leave foreground calls working while
closed-app incoming calls fail, which is particularly costly for this product.

**How to apply:** Verify actual push delivery with the new native devices
before release, including ordinary Expo alerts alongside native call data.
Keep all provider keys server-only. Respect unlock/camera permission and
Android force-stop limitations; native call UI cannot override them.
