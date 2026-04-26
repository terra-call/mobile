import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/services/firebase";

export type EventType = "checkin" | "missed" | "emergency" | "manual_emergency";

// Lightweight, fire-and-forget event logger. Writes to the top-level
// `events` collection so the admin dashboard can compute counts and
// build a recent-activity feed. Failures are swallowed — event logging
// must never block a check-in or emergency action.
export async function logEvent(
  userId: string,
  userName: string,
  type: EventType,
): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await addDoc(collection(db, "events"), {
      userId,
      userName,
      type,
      createdAt: serverTimestamp(),
    });
  } catch {
    // non-fatal — admin metrics will simply miss this event
  }
}
