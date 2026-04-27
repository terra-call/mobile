// FUTURE — Organization/Medicaid support (v1.1)
// New collection — does not affect existing users or invites.
// Used for B2B accounts: home health agencies, MCOs (Medicaid managed care
// organizations), hospices, and direct consumer billing.
// Do not modify existing user or invite collections.

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/services/firebase";

export type OrganizationType =
  | "home_health_agency"
  | "mco"
  | "hospice"
  | "consumer";

export type SubscriptionTier = "basic" | "family" | "pro" | "enterprise";

export type SubscriptionStatus = "active" | "inactive" | "trial";

export interface Organization {
  organizationId: string; // mirrors the Firestore document id
  organizationName: string;
  organizationType: OrganizationType;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  pmpmRate: number; // per-member-per-month; 0 for consumer accounts
  contractStartDate: Timestamp | null;
  contractEndDate: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  isActive: boolean;
}

export type CreateOrganizationInput = Omit<
  Organization,
  "organizationId" | "createdAt" | "updatedAt"
>;

/** Create a new organization. Returns the new document id. */
export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<string | null> {
  if (!isFirebaseConfigured || !db) return null;
  const ref = await addDoc(collection(db, "organizations"), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Fetch a single organization by id. */
export async function getOrganization(
  organizationId: string,
): Promise<Organization | null> {
  if (!isFirebaseConfigured || !db) return null;
  const snap = await getDoc(doc(db, "organizations", organizationId));
  if (!snap.exists()) return null;
  return { organizationId: snap.id, ...(snap.data() as Omit<Organization, "organizationId">) };
}
