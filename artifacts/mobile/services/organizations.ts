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
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
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

export type UpdateOrganizationInput = Partial<
  Omit<Organization, "organizationId" | "createdAt" | "updatedAt">
>;

export interface OrganizationStats {
  memberCount: number;
  activeMembers: number;
  totalCheckIns: number;
  totalMissed: number;
  totalEmergencies: number;
  totalManualEmergencies: number;
}

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

/** Update an existing organization document by id. */
export async function updateOrganization(
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  await updateDoc(doc(db, "organizations", organizationId), {
    ...input,
    updatedAt: serverTimestamp(),
  });
}

/** Fetch a single organization by id. */
export async function getOrganization(
  organizationId: string,
): Promise<Organization | null> {
  if (!isFirebaseConfigured || !db) return null;
  const snap = await getDoc(doc(db, "organizations", organizationId));
  if (!snap.exists()) return null;
  return {
    organizationId: snap.id,
    ...(snap.data() as Omit<Organization, "organizationId">),
  };
}

/** List every organization, sorted by name (client-side so docs missing
 *  organizationName are still returned). Throws on permission-denied / network
 *  errors so the caller can show an error state. */
export async function listOrganizations(): Promise<Organization[]> {
  if (!isFirebaseConfigured || !db) return [];
  const snap = await getDocs(collection(db, "organizations"));
  const orgs = snap.docs.map((d) => ({
    organizationId: d.id,
    ...(d.data() as Omit<Organization, "organizationId">),
  }));
  orgs.sort((a, b) =>
    (a.organizationName ?? "").localeCompare(b.organizationName ?? ""),
  );
  return orgs;
}

/** Build a map of organizationId → member count by scanning all users once. */
export async function getOrganizationMemberCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!isFirebaseConfigured || !db) return counts;
  try {
    const snap = await getDocs(collection(db, "users"));
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const orgId = data.organizationId as string | undefined;
      if (typeof orgId === "string" && orgId.length > 0) {
        counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
      }
    });
  } catch {
    // best-effort
  }
  return counts;
}

/** Aggregate stats for a single organization (members + activity). */
export async function getOrganizationStats(
  organizationId: string,
): Promise<OrganizationStats> {
  const stats: OrganizationStats = {
    memberCount: 0,
    activeMembers: 0,
    totalCheckIns: 0,
    totalMissed: 0,
    totalEmergencies: 0,
    totalManualEmergencies: 0,
  };
  if (!isFirebaseConfigured || !db) return stats;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const memberIds: string[] = [];

  try {
    const usersSnap = await getDocs(
      query(collection(db, "users"), where("organizationId", "==", organizationId)),
    );
    usersSnap.forEach((d) => {
      memberIds.push(d.id);
      stats.memberCount += 1;
      const data = d.data() as Record<string, unknown>;
      const lastCheckIn = (data.lastCheckIn as { toMillis?: () => number } | undefined)?.toMillis?.();
      if (typeof lastCheckIn === "number" && lastCheckIn >= sevenDaysAgo) {
        stats.activeMembers += 1;
      }
    });
  } catch {
    // best-effort
  }

  if (memberIds.length === 0) return stats;

  // Firestore `in` queries support up to 30 values per query — chunk if needed.
  const chunks: string[][] = [];
  for (let i = 0; i < memberIds.length; i += 30) {
    chunks.push(memberIds.slice(i, i + 30));
  }

  try {
    for (const chunk of chunks) {
      const eventsSnap = await getDocs(
        query(collection(db, "events"), where("userId", "in", chunk)),
      );
      eventsSnap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const t = data.type as string;
        if (t === "checkin") stats.totalCheckIns += 1;
        else if (t === "missed") stats.totalMissed += 1;
        else if (t === "emergency") stats.totalEmergencies += 1;
        else if (t === "manual_emergency") stats.totalManualEmergencies += 1;
      });
    }
  } catch {
    // best-effort
  }

  return stats;
}

/** List the user docs that belong to a given organization. */
export async function listOrganizationMembers(
  organizationId: string,
): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
  if (!isFirebaseConfigured || !db) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "users"), where("organizationId", "==", organizationId)),
    );
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: (data.name as string) ?? "Unknown",
        email: (data.email as string) ?? "",
        role: (data.role as string) ?? "",
      };
    });
  } catch {
    return [];
  }
}
