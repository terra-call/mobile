// Fill in the App Store listing for Terra Call via the ASC API.
import { asc } from "./asc.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const APP_ID = "6800145154";
const VERSION_ID = "dc520e0e-90de-4ca3-9d4f-6f4022f8298e";
const VER_LOC_ID = "1d1efd62-1179-422e-b7d1-765576b16ae8";
const APP_INFO_ID = "d9cb65f1-3861-4d15-892b-3d2c50ea84fe";
const INFO_LOC_ID = "c91d34ff-4e02-464e-ade0-d39a21bc2ed0";
const BUILD_ID = "cbbfa322-baf8-4870-b8a6-1453702f244f";
const REVIEW_RECORDING_PATH = process.env.ASC_REVIEW_RECORDING_PATH
  || "attached_assets/0_ScreenRecording_08-22-2026_08-23-37_1_1787407985358.MP4";
const TEST_DEVICES = process.env.ASC_TEST_DEVICES
  || "iPhone 15 Pro — iOS 18.x; Samsung Galaxy Tab A — Android 14";

const description = `Terra Call keeps care recipients safe and caregivers at peace — with one big button.

FOR CARE RECIPIENTS
- Tap "I'M OK" once a day to let your loved ones know you're safe
- Tap "I'M NOT OK" to instantly alert every caregiver on your care team
- Call your caregiver by video with a single tap
- Quick access to 911 in an emergency
- Gentle reminders if you forget to check in

FOR CAREGIVERS & FAMILY
- Live dashboard showing every loved one's status at a glance
- Instant push and text alerts for missed check-ins and emergencies
- Automatic emergency video: when a loved one needs help, see and talk to them immediately
- Optional home camera support for an extra layer of reassurance
- Map view of your loved one's last check-in location

PRIVACY FIRST
- Location is shared only when your loved one checks in or calls for help — never continuous tracking
- Camera activates only with consent
- Text alerts sent only with the care recipient's permission
- Built with HIPAA-grade audit logging

FOR CARE ORGANIZATIONS
Home health agencies and Medicaid providers can manage clients, generate care activity reports, and maintain compliant audit trails.

Terra Call — peace of mind, one tap away.`;

const reviewNotes = `PHYSICAL-DEVICE RECORDING
The attached file "Terra-Call-Physical-Device-Review-Recording.mp4" was captured on a physical iPhone. It starts at app launch and demonstrates login, the recipient check-in and emergency flow, caregiver dashboard and alerts, video-call flow, settings, notification configuration, and account deletion.

TESTED DEVICES
${TEST_DEVICES}

FUNCTIONS, AUDIENCE, AND VALUE
Terra Call is designed for older adults, people living independently, family caregivers, and care organizations. A care recipient can confirm they are safe with one tap, request help, and start a video call. Linked caregivers receive status updates and emergency alerts, can view the last user-approved check-in location, and can communicate by video. Terra Call supplements family caregiving; it does not diagnose, treat, or replace emergency services.

ACCESS AND MAIN FEATURES
Terra Call links care recipients with caregivers. Two linked demo accounts are provided:
- Caregiver: review.caregiver@terra-call.com / AppleReview2026!Cg
- Care recipient: review.recipient@terra-call.com / AppleReview2026!Cr

The accounts are already linked and require no setup or sample files. Log in as the care recipient to see the check-in screen; log in as the caregiver on a second device to see the dashboard. Tapping "I'M NOT OK" on the recipient account triggers an emergency alert and video-call flow for the caregiver. The optional home-camera feature requires separately owned Reolink hardware; without it, the app uses phone-to-phone video. Location is captured only during a user-initiated check-in or emergency and only with permission. Camera, microphone, location, and notification permissions are requested only when the corresponding feature is used.

EXTERNAL SERVICES
- Google Firebase Authentication for accounts
- Google Cloud Firestore for app data
- Firebase Cloud Messaging and Expo Notifications for push alerts
- Twilio Video for calls and Twilio SMS for consented backup alerts
- Replit-hosted Terra Call API services
- Optional user-owned Reolink camera hardware
- Apple device location and mapping services
The app has no advertising, analytics, payment processor, subscription, or AI service.

REGIONAL BEHAVIOR
Check-ins, caregiver status, alerts, and video calls function consistently in supported regions. Terra Call is currently intended for use in the United States. The emergency shortcut calls 911, and SMS backup alerts use U.S. telephony.

REGULATORY / THIRD-PARTY CONTENT
Terra Call is a caregiver communication and welfare-check tool, not a medical device, healthcare provider, diagnostic service, treatment service, or emergency-dispatch service. It does not provide medical advice and contains no protected third-party content. No additional professional license, regulatory authorization, or third-party content authorization is applicable.`;

const step = process.argv[2] || "all";
const log = (...a) => console.log(...a);

if (step === "all" || step === "text") {
  await asc("PATCH", `/v1/appStoreVersionLocalizations/${VER_LOC_ID}`, {
    data: { type: "appStoreVersionLocalizations", id: VER_LOC_ID, attributes: {
      description,
      keywords: "caregiver,elderly,check in,senior safety,emergency alert,aging,care,welfare check,family",
      promotionalText: "New: cleaner emergency screen with instant video calling — with or without a home camera. Faster alerts, smoother calls.",
      supportUrl: "https://terra-call.com",
      marketingUrl: "https://terra-call.com",
    } },
  });
  log("version localization updated");

  await asc("PATCH", `/v1/appInfoLocalizations/${INFO_LOC_ID}`, {
    data: { type: "appInfoLocalizations", id: INFO_LOC_ID, attributes: {
      subtitle: "Check-ins & emergency alerts",
      privacyPolicyUrl: "https://terra-call.com/legal/privacy",
    } },
  });
  log("app info localization updated");
}

if (step === "all" || step === "category") {
  await asc("PATCH", `/v1/appInfos/${APP_INFO_ID}`, {
    data: { type: "appInfos", id: APP_INFO_ID, relationships: {
      primaryCategory: { data: { type: "appCategories", id: "LIFESTYLE" } },
      secondaryCategory: { data: { type: "appCategories", id: "MEDICAL" } },
    } },
  });
  log("categories set");
}

if (step === "all" || step === "age") {
  const attrs = {};
  const enums = ["alcoholTobaccoOrDrugUseOrReferences","contests","gamblingSimulated","gunsOrOtherWeapons","medicalOrTreatmentInformation","profanityOrCrudeHumor","sexualContentGraphicAndNudity","sexualContentOrNudity","horrorOrFearThemes","matureOrSuggestiveThemes","violenceCartoonOrFantasy","violenceRealisticProlongedGraphicOrSadistic","violenceRealistic"];
  const bools = ["gambling","lootBox","unrestrictedWebAccess","advertising","parentalControls","messagingAndChat","socialMedia","userGeneratedContent","healthOrWellnessTopics"];
  for (const k of enums) attrs[k] = "NONE";
  for (const k of bools) attrs[k] = false;
  attrs.ageAssurance = false;
  const declaration = await asc("GET", `/v1/appInfos/${APP_INFO_ID}/ageRatingDeclaration`);
  await asc("PATCH", `/v1/ageRatingDeclarations/${declaration.data.id}`, {
    data: { type: "ageRatingDeclarations", id: declaration.data.id, attributes: attrs },
  });
  log("age rating declared");
}

if (step === "all" || step === "screenshots") {
  const dir = "attached_assets/store-submission/screenshots/ios67";
  // find or create the APP_IPHONE_67 set
  const sets = await asc("GET", `/v1/appStoreVersionLocalizations/${VER_LOC_ID}/appScreenshotSets`);
  let set = sets.data.find((s) => s.attributes.screenshotDisplayType === "APP_IPHONE_67");
  if (!set) {
    set = (await asc("POST", "/v1/appScreenshotSets", {
      data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: "APP_IPHONE_67" }, relationships: {
        appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: VER_LOC_ID } },
      } },
    })).data;
  }
  log("screenshot set", set.id);
  const existing = await asc("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
  const have = new Set(existing.data.map((s) => s.attributes.fileName));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const ids = existing.data.map((s) => s.id);
  for (const f of files) {
    if (have.has(f)) { log("skip existing", f); continue; }
    const buf = fs.readFileSync(path.join(dir, f));
    const res = await asc("POST", "/v1/appScreenshots", {
      data: { type: "appScreenshots", attributes: { fileName: f, fileSize: buf.length }, relationships: {
        appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } },
      } },
    });
    for (const op of res.data.attributes.uploadOperations) {
      const headers = {};
      for (const h of op.requestHeaders) headers[h.name] = h.value;
      const chunk = buf.subarray(op.offset, op.offset + op.length);
      const up = await fetch(op.url, { method: op.method, headers, body: chunk });
      if (!up.ok) throw new Error(`upload ${f} -> ${up.status}: ${await up.text()}`);
    }
    await asc("PATCH", `/v1/appScreenshots/${res.data.id}`, {
      data: { type: "appScreenshots", id: res.data.id, attributes: {
        uploaded: true, sourceFileChecksum: crypto.createHash("md5").update(buf).digest("hex"),
      } },
    });
    ids.push(res.data.id);
    log("uploaded", f);
  }
}

if (step === "all" || step === "review") {
  let detailId;
  try {
    const d = await asc("GET", `/v1/appStoreVersions/${VERSION_ID}/appStoreReviewDetail`);
    detailId = d?.data?.id;
  } catch {}
  if (!detailId) {
    throw new Error("App Review contact details must be created in App Store Connect before running this step");
  }
  const attributes = {
    demoAccountName: "review.caregiver@terra-call.com",
    demoAccountPassword: "AppleReview2026!Cg",
    demoAccountRequired: true,
    notes: reviewNotes,
  };
  await asc("PATCH", `/v1/appStoreReviewDetails/${detailId}`, {
    data: { type: "appStoreReviewDetails", id: detailId, attributes },
  });

  if (fs.existsSync(REVIEW_RECORDING_PATH)) {
    const fileName = "Terra-Call-Physical-Device-Review-Recording.mp4";
    const existing = await asc("GET", `/v1/appStoreReviewDetails/${detailId}/appStoreReviewAttachments?limit=50`);
    let attachment = existing.data.find((item) => item.attributes.fileName === fileName);
    if (!attachment) {
      const fileSize = fs.statSync(REVIEW_RECORDING_PATH).size;
      attachment = (await asc("POST", "/v1/appStoreReviewAttachments", {
        data: {
          type: "appStoreReviewAttachments",
          attributes: { fileName, fileSize },
          relationships: {
            appStoreReviewDetail: { data: { type: "appStoreReviewDetails", id: detailId } },
          },
        },
      })).data;
      const fd = fs.openSync(REVIEW_RECORDING_PATH, "r");
      try {
        for (const operation of attachment.attributes.uploadOperations) {
          const chunk = Buffer.allocUnsafe(operation.length);
          fs.readSync(fd, chunk, 0, operation.length, operation.offset);
          const headers = Object.fromEntries(operation.requestHeaders.map((header) => [header.name, header.value]));
          const response = await fetch(operation.url, { method: operation.method, headers, body: chunk });
          if (!response.ok) throw new Error(`Review recording upload failed: ${response.status}`);
        }
      } finally {
        fs.closeSync(fd);
      }
      const checksum = crypto.createHash("md5");
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(REVIEW_RECORDING_PATH);
        stream.on("data", (data) => checksum.update(data));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      await asc("PATCH", `/v1/appStoreReviewAttachments/${attachment.id}`, {
        data: {
          type: "appStoreReviewAttachments",
          id: attachment.id,
          attributes: { uploaded: true, sourceFileChecksum: checksum.digest("hex") },
        },
      });
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      attachment = (await asc("GET", `/v1/appStoreReviewAttachments/${attachment.id}`)).data;
      const state = attachment.attributes.assetDeliveryState?.state;
      if (state === "COMPLETE") break;
      if (state === "FAILED") throw new Error(JSON.stringify(attachment.attributes.assetDeliveryState));
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    if (attachment.attributes.assetDeliveryState?.state !== "COMPLETE") {
      throw new Error("Review recording did not finish processing");
    }
    log("physical-device review recording attached");
  }
  log("review detail saved");
}

if (step === "all" || step === "build") {
  await asc("PATCH", `/v1/appStoreVersions/${VERSION_ID}/relationships/build`, {
    data: { type: "builds", id: BUILD_ID },
  });
  log("build attached");
}

if (step === "all" || step === "submission") {
  let version = (await asc("GET", `/v1/appStoreVersions/${VERSION_ID}`)).data;
  if (version.attributes.appStoreState === "WAITING_FOR_REVIEW") {
    log("submission already waiting for review");
  } else {
    const submissions = await asc("GET", `/v1/apps/${APP_ID}/reviewSubmissions?include=items&limit=50`);
    const unresolved = submissions.data.find((item) => item.attributes.state === "UNRESOLVED_ISSUES");
    if (unresolved) {
      const rejected = (submissions.included || []).find((item) => item.attributes.state === "REJECTED");
      if (!rejected) throw new Error("Unresolved submission has no rejected item to resolve");
      await asc("PATCH", `/v1/reviewSubmissionItems/${rejected.id}`, {
        data: { type: "reviewSubmissionItems", id: rejected.id, attributes: { resolved: true } },
      });
      await asc("PATCH", `/v1/reviewSubmissions/${unresolved.id}`, {
        data: { type: "reviewSubmissions", id: unresolved.id, attributes: { submitted: true } },
      });
    } else {
      let submission = submissions.data.find((item) => item.attributes.state === "READY_FOR_REVIEW");
      if (!submission) {
        submission = (await asc("POST", "/v1/reviewSubmissions", {
          data: {
            type: "reviewSubmissions",
            attributes: { platform: "IOS" },
            relationships: { app: { data: { type: "apps", id: APP_ID } } },
          },
        })).data;
      }
      await asc("POST", "/v1/reviewSubmissionItems", {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
            appStoreVersion: { data: { type: "appStoreVersions", id: VERSION_ID } },
          },
        },
      });
      await asc("PATCH", `/v1/reviewSubmissions/${submission.id}`, {
        data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } },
      });
    }
    version = (await asc("GET", `/v1/appStoreVersions/${VERSION_ID}`)).data;
    if (version.attributes.appStoreState !== "WAITING_FOR_REVIEW") {
      throw new Error(`Unexpected App Store version state: ${version.attributes.appStoreState}`);
    }
    log("submitted for Apple review");
  }
}

log("done");
