// FUTURE — Organization/Medicaid support (v1.1)
// New collection — does not affect existing users or invites.
// Stores periodic care-activity rollups for caregivers, organizations,
// and Medicaid billing/audit purposes.
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
  where,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/services/firebase";

export interface CareReport {
  reportId: string; // mirrors the Firestore document id
  careReceiverId: string;
  careReceiverName?: string; // denormalized for export readability
  caregiverIds: string[];
  organizationId?: string;
  reportPeriodStart: Timestamp;
  reportPeriodEnd: Timestamp;
  totalCheckIns: number;
  missedCheckIns: number;
  emergencyAlerts: number;
  imNotOkAlerts: number;
  averageResponseTime: number; // minutes — 0 until response-time tracking ships
  generatedAt: Timestamp | null;
  generatedBy: string; // userId who requested the report
}

export type CreateCareReportInput = Omit<CareReport, "reportId" | "generatedAt">;

/** Persist a generated care-activity report. Returns the new document id. */
export async function createCareReport(
  input: CreateCareReportInput,
): Promise<string | null> {
  if (!isFirebaseConfigured || !db) return null;
  const ref = await addDoc(collection(db, "careReports"), {
    ...input,
    generatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Fetch a single care report by its document id. */
export async function getCareReportById(
  reportId: string,
): Promise<CareReport | null> {
  if (!isFirebaseConfigured || !db) return null;
  const snap = await getDoc(doc(db, "careReports", reportId));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return {
    reportId: snap.id,
    careReceiverId: (data.careReceiverId as string) ?? "",
    careReceiverName: (data.careReceiverName as string) ?? undefined,
    caregiverIds: (data.caregiverIds as string[]) ?? [],
    organizationId: (data.organizationId as string) ?? undefined,
    reportPeriodStart: data.reportPeriodStart as Timestamp,
    reportPeriodEnd: data.reportPeriodEnd as Timestamp,
    totalCheckIns: Number(data.totalCheckIns ?? 0),
    missedCheckIns: Number(data.missedCheckIns ?? 0),
    emergencyAlerts: Number(data.emergencyAlerts ?? 0),
    imNotOkAlerts: Number(data.imNotOkAlerts ?? 0),
    averageResponseTime: Number(data.averageResponseTime ?? 0),
    generatedAt: (data.generatedAt as Timestamp | null) ?? null,
    generatedBy: (data.generatedBy as string) ?? "",
  };
}

/** List every saved care report, most recent first. */
export async function listCareReports(): Promise<CareReport[]> {
  if (!isFirebaseConfigured || !db) return [];
  const snap = await getDocs(collection(db, "careReports"));
  const reports: CareReport[] = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      reportId: d.id,
      careReceiverId: (data.careReceiverId as string) ?? "",
      careReceiverName: (data.careReceiverName as string) ?? undefined,
      caregiverIds: (data.caregiverIds as string[]) ?? [],
      organizationId: (data.organizationId as string) ?? undefined,
      reportPeriodStart: data.reportPeriodStart as Timestamp,
      reportPeriodEnd: data.reportPeriodEnd as Timestamp,
      totalCheckIns: Number(data.totalCheckIns ?? 0),
      missedCheckIns: Number(data.missedCheckIns ?? 0),
      emergencyAlerts: Number(data.emergencyAlerts ?? 0),
      imNotOkAlerts: Number(data.imNotOkAlerts ?? 0),
      averageResponseTime: Number(data.averageResponseTime ?? 0),
      generatedAt: (data.generatedAt as Timestamp | null) ?? null,
      generatedBy: (data.generatedBy as string) ?? "",
    };
  });
  reports.sort((a, b) => {
    const ta = a.generatedAt?.toMillis?.() ?? 0;
    const tb = b.generatedAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return reports;
}

/** Aggregate care activity for one user in a date range. Does NOT save —
 *  caller decides whether to persist via createCareReport(). */
export async function generateCareReportData(args: {
  careReceiverId: string;
  careReceiverName: string;
  organizationId?: string;
  rangeStart: Date;
  rangeEnd: Date;
  generatedBy: string;
}): Promise<CreateCareReportInput | null> {
  if (!isFirebaseConfigured || !db) return null;
  const startTs = Timestamp.fromDate(args.rangeStart);
  const endTs = Timestamp.fromDate(args.rangeEnd);

  let totalCheckIns = 0;
  let missedCheckIns = 0;
  let emergencyAlerts = 0;
  let imNotOkAlerts = 0;

  // Fail closed — if the event aggregation cannot complete, throw so the
  // caller can surface an error. Returning a zero-filled report would risk
  // saving/exporting inaccurate data for compliance or billing workflows.
  const eventsSnap = await getDocs(
    query(
      collection(db, "events"),
      where("userId", "==", args.careReceiverId),
      where("createdAt", ">=", startTs),
      where("createdAt", "<=", endTs),
    ),
  );
  eventsSnap.forEach((d) => {
    const t = (d.data() as { type?: string }).type;
    if (t === "checkin") totalCheckIns += 1;
    else if (t === "missed") missedCheckIns += 1;
    else if (t === "emergency") emergencyAlerts += 1;
    else if (t === "manual_emergency") imNotOkAlerts += 1;
  });

  return {
    careReceiverId: args.careReceiverId,
    careReceiverName: args.careReceiverName,
    caregiverIds: [],
    organizationId: args.organizationId,
    reportPeriodStart: startTs,
    reportPeriodEnd: endTs,
    totalCheckIns,
    missedCheckIns,
    emergencyAlerts,
    imNotOkAlerts,
    // Response-time tracking is not yet recorded on events; placeholder = 0.
    averageResponseTime: 0,
    generatedBy: args.generatedBy,
  };
}
