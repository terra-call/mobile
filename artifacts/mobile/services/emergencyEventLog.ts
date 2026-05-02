// EMERGENCY CALL FLOW — events lifecycle tracking (Prompt 2 / Task 2)
// ─────────────────────────────────────────────────────────────────────────────
// Writes a single document to the top-level `events` collection per emergency
// call session, then mutates that same document as the call progresses through
// its lifecycle. Schema is intentionally separate from the lightweight
// check-in events written by services/events.ts — those use `userId`/`type`,
// these use `caregiverId`/`careReceiverId`/`status` because they describe a
// two-party interaction.
//
// All functions are fire-and-forget. Failure to write to Firestore must NEVER
// block an emergency action — the caregiver still needs to be able to dial
// 911 even if Firestore is offline.
// ─────────────────────────────────────────────────────────────────────────────

import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/services/firebase";
import type { CameraConsent } from "@/services/video";

export type EmergencyCallStatus =
  | "initiated"
  | "unanswered"
  | "video_connected"
  | "resolved"
  | "dismissed";

export interface CreateEmergencyEventInput {
  caregiverId: string;
  careReceiverId: string;
  roomName: string;
}

/**
 * Create the events doc when the caregiver taps "Call Their Device".
 * Returns the new document id (or null on failure) so subsequent lifecycle
 * updates can target the same row.
 */
export async function createEmergencyEvent(
  input: CreateEmergencyEventInput,
): Promise<string | null> {
  if (!isFirebaseConfigured || !db) return null;
  try {
    const ref = await addDoc(collection(db, "events"), {
      type: "emergency_call_initiated",
      caregiverId: input.caregiverId,
      careReceiverId: input.careReceiverId,
      roomName: input.roomName,
      status: "initiated" as EmergencyCallStatus,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    return ref.id;
  } catch {
    return null;
  }
}

/**
 * Patch the existing event doc when the 15-second unanswered timer expires.
 * `cameraActivated` reflects whether the activation push was successfully
 * dispatched. `consentStatus` records what the receiver had pre-set.
 */
export async function markEmergencyEventUnanswered(
  eventId: string | null,
  fields: { cameraActivated: boolean; consentStatus: CameraConsent },
): Promise<void> {
  if (!eventId || !isFirebaseConfigured || !db) return;
  try {
    await updateDoc(doc(db, "events", eventId), {
      status: "unanswered" as EmergencyCallStatus,
      cameraActivated: fields.cameraActivated,
      consentStatus: fields.consentStatus,
      unansweredAt: serverTimestamp(),
    });
  } catch {
    /* non-fatal */
  }
}

/** Patch the event doc when the caregiver successfully connects to the room. */
export async function markEmergencyEventVideoConnected(
  eventId: string | null,
): Promise<void> {
  if (!eventId || !isFirebaseConfigured || !db) return;
  try {
    await updateDoc(doc(db, "events", eventId), {
      status: "video_connected" as EmergencyCallStatus,
      connectedAt: serverTimestamp(),
    });
  } catch {
    /* non-fatal */
  }
}

/** Patch the event doc when the caregiver ends the live stream. */
export async function markEmergencyEventResolved(
  eventId: string | null,
): Promise<void> {
  if (!eventId || !isFirebaseConfigured || !db) return;
  try {
    await updateDoc(doc(db, "events", eventId), {
      status: "resolved" as EmergencyCallStatus,
      resolvedAt: serverTimestamp(),
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * Patch the event doc when the caregiver dismisses BEFORE the 15s timer
 * elapses (so we have a clean record that no escalation occurred).
 */
export async function markEmergencyEventDismissed(
  eventId: string | null,
): Promise<void> {
  if (!eventId || !isFirebaseConfigured || !db) return;
  try {
    await updateDoc(doc(db, "events", eventId), {
      status: "dismissed" as EmergencyCallStatus,
      dismissedAt: serverTimestamp(),
    });
  } catch {
    /* non-fatal */
  }
}
