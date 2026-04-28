// FUTURE — Organization/Medicaid support (v1.1)
// HIPAA audit logger. Append-only — entries are never updated or deleted once written.
// Fire-and-forget: failures must NEVER block the action being logged.
// Do not modify existing user or invite collections.

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Platform } from "react-native";
import { db, isFirebaseConfigured } from "@/services/firebase";

export type AuditAction =
  | "login"
  | "logout"
  | "account_created"
  | "checkin"
  | "alert_missed"
  | "alert_emergency"
  | "alert_im_not_ok"
  | "data_accessed"
  | "profile_updated"
  | "organization_created"
  | "organization_updated"
  | "user_updated"
  | "care_report_generated"
  | "care_report_exported";

export interface LogAuditParams {
  userId: string;
  action: AuditAction;
  details: string;
  targetUserId?: string;
  organizationId?: string;
}

/**
 * Write a single immutable entry to the `auditLogs` collection.
 *
 * Schema (HIPAA requirement):
 *   - logId          (auto, document id)
 *   - userId         (string)  — who performed the action
 *   - action         (string)  — see AuditAction above
 *   - targetUserId   (string?) — who was affected
 *   - organizationId (string?) — for org-scoped actions
 *   - timestamp      (server timestamp)
 *   - ipAddress      (string?) — client cannot reliably know its public IP;
 *                                left undefined here, populated by future
 *                                Cloud Function audit pipeline (v1.1).
 *   - deviceInfo     (string)  — "ios 17.4", "android 14", "web", etc.
 *   - details        (string)  — plain-English description
 */
export async function logAudit(params: LogAuditParams): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    const entry: Record<string, unknown> = {
      userId: params.userId,
      action: params.action,
      timestamp: serverTimestamp(),
      deviceInfo: `${Platform.OS} ${String(Platform.Version)}`,
      details: params.details,
    };
    if (params.targetUserId) entry.targetUserId = params.targetUserId;
    if (params.organizationId) entry.organizationId = params.organizationId;
    await addDoc(collection(db, "auditLogs"), entry);
  } catch {
    // non-fatal — never block the actual action being audited
  }
}
