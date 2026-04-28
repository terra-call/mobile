// FUTURE — Admin user management (v1.1)
// Read all users + update admin-controlled fields (organization assignment,
// role, HIPAA consent flag). Auth account itself (email/password) is owned
// by Firebase Auth and is NOT touched here — admins can only edit profile
// fields stored in the Firestore `users` document.

import {
  Timestamp,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/services/firebase";
import type { UserRole } from "@/contexts/AuthContext";

export type OrganizationRole =
  | "case_manager"
  | "agency_admin"
  | "member"
  | null;

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone: string;
  organizationId: string | null;
  organizationRole: OrganizationRole;
  hipaaConsentSigned: boolean;
  hipaaConsentDate: Timestamp | null;
  npiNumber: string | null;
  createdAt: Timestamp | null;
  lastCheckIn: Timestamp | null;
}

export interface AdminUserUpdate {
  name?: string;
  phone?: string;
  role?: UserRole;
  organizationId?: string | null;
  organizationRole?: OrganizationRole;
  hipaaConsentSigned?: boolean;
  hipaaConsentDate?: Timestamp | null;
  npiNumber?: string | null;
}

/** List every user document. Sorted client-side by name so docs missing a
 *  field still appear. Throws on permission/network errors. */
export async function listUsers(): Promise<AdminUserView[]> {
  if (!isFirebaseConfigured || !db) return [];
  const snap = await getDocs(collection(db, "users"));
  const users: AdminUserView[] = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      email: (data.email as string) ?? "",
      name: (data.name as string) ?? "",
      role: ((data.role as UserRole) ?? "caregiver") as UserRole,
      phone: (data.phone as string) ?? "",
      organizationId: (data.organizationId as string | null) ?? null,
      organizationRole:
        (data.organizationRole as OrganizationRole) ?? null,
      hipaaConsentSigned: Boolean(data.hipaaConsentSigned),
      hipaaConsentDate: (data.hipaaConsentDate as Timestamp | null) ?? null,
      npiNumber: (data.npiNumber as string | null) ?? null,
      createdAt: (data.createdAt as Timestamp | null) ?? null,
      lastCheckIn: (data.lastCheckIn as Timestamp | null) ?? null,
    };
  });
  users.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return users;
}

/** Apply an admin-controlled update to a single user's Firestore doc. */
export async function updateUserAdmin(
  userId: string,
  update: AdminUserUpdate,
): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  // If admin flips HIPAA consent on, stamp it. If they flip it off, clear it.
  const payload: Record<string, unknown> = { ...update };
  if (update.hipaaConsentSigned === true && update.hipaaConsentDate === undefined) {
    payload.hipaaConsentDate = serverTimestamp();
  } else if (update.hipaaConsentSigned === false) {
    payload.hipaaConsentDate = null;
  }
  payload.updatedAt = serverTimestamp();
  await updateDoc(doc(db, "users", userId), payload);
}
