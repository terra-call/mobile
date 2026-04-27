// FUTURE — Organization/Medicaid support (v1.1)
// New collection — does not affect existing users or invites.
// Stores periodic care-activity rollups for caregivers, organizations,
// and Medicaid billing/audit purposes.
// Do not modify existing user or invite collections.

import {
  Timestamp,
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/services/firebase";

export interface CareReport {
  reportId: string; // mirrors the Firestore document id
  careReceiverId: string;
  caregiverIds: string[];
  organizationId?: string;
  reportPeriodStart: Timestamp;
  reportPeriodEnd: Timestamp;
  totalCheckIns: number;
  missedCheckIns: number;
  emergencyAlerts: number;
  imNotOkAlerts: number;
  averageResponseTime: number; // minutes
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
