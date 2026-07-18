// Best-effort location capture for care recipients.
//
// Design (user-approved July 2026): location is captured ONLY at explicit
// check-in moments — when the recipient taps "I'M OK" or triggers an
// emergency. There is NO background tracking. The captured point is written
// to the recipient's own Firestore user doc (`location: { lat, lng }`),
// which the caregiver map already reads.
//
// Everything here is fire-and-forget: a denied permission, disabled GPS, or
// slow fix must never block or delay the check-in / emergency flow itself.
import * as Location from "expo-location";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/services/firebase";

const FIX_TIMEOUT_MS = 15000;

/** Returns current coordinates, or null if permission denied / unavailable. */
export async function captureCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (fix?.coords) {
      return { lat: fix.coords.latitude, lng: fix.coords.longitude };
    }

    // Fall back to the OS's last known position (instant, may be stale).
    const last = await Location.getLastKnownPositionAsync();
    if (last?.coords) {
      return { lat: last.coords.latitude, lng: last.coords.longitude };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Captures the device's location and saves it to the user's Firestore doc.
 * Silent no-op on permission denial, timeout, or any error — callers should
 * NOT await this in a way that blocks check-in/emergency UX.
 */
export async function captureAndSaveLocation(userId: string): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  const coords = await captureCurrentLocation();
  if (!coords) return;
  try {
    await updateDoc(doc(db, "users", userId), {
      location: coords,
      locationUpdatedAt: serverTimestamp(),
    });
  } catch {
    // Best-effort only.
  }
}
