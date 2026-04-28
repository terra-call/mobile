// FUTURE — Organization/Medicaid support (v1.1)
// HIPAA audit logger. Append-only — entries are never updated or deleted once written.
// Fire-and-forget: failures must NEVER block the action being logged.
// Do not modify existing user or invite collections.

import {
  type DocumentSnapshot,
  Timestamp,
  addDoc,
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  where,
} from "firebase/firestore";
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

// ── Read API for the admin Audit Log tab ─────────────────────────────────────

export interface AuditLogEntry {
  logId: string;
  userId: string;
  action: AuditAction | string;
  timestamp: Timestamp | null;
  deviceInfo?: string;
  details: string;
  targetUserId?: string;
  organizationId?: string;
}

export interface ListAuditLogsResult {
  entries: AuditLogEntry[];
  /** Pass back into the next call to fetch the following page. */
  cursor: DocumentSnapshot | null;
  /** True when fewer than `pageSize` rows were returned — no more pages. */
  done: boolean;
}

export interface ListAuditLogsParams {
  pageSize?: number;
  /** Optional inclusive lower-bound on the entry timestamp. */
  rangeStart?: Date;
  /** Optional inclusive upper-bound on the entry timestamp. */
  rangeEnd?: Date;
  /** From a previous result, to fetch the next page. */
  cursor?: DocumentSnapshot | null;
}

/**
 * Read a page of audit log entries, newest first. Supports server-side date
 * filtering and cursor pagination. Action and user filters are applied
 * client-side to avoid requiring a compound Firestore index per filter combo.
 */
export async function listAuditLogs(
  params: ListAuditLogsParams = {},
): Promise<ListAuditLogsResult> {
  if (!isFirebaseConfigured || !db) {
    return { entries: [], cursor: null, done: true };
  }
  const pageSize = Math.max(1, Math.min(params.pageSize ?? 50, 200));

  const constraints = [];
  if (params.rangeStart) {
    constraints.push(
      where("timestamp", ">=", Timestamp.fromDate(params.rangeStart)),
    );
  }
  if (params.rangeEnd) {
    constraints.push(
      where("timestamp", "<=", Timestamp.fromDate(params.rangeEnd)),
    );
  }
  constraints.push(orderBy("timestamp", "desc"));
  if (params.cursor) constraints.push(startAfter(params.cursor));
  constraints.push(fsLimit(pageSize));

  const snap = await getDocs(query(collection(db, "auditLogs"), ...constraints));

  const entries: AuditLogEntry[] = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      logId: d.id,
      userId: (data.userId as string) ?? "",
      action: (data.action as string) ?? "unknown",
      timestamp: (data.timestamp as Timestamp | null) ?? null,
      deviceInfo: (data.deviceInfo as string) ?? undefined,
      details: (data.details as string) ?? "",
      targetUserId: (data.targetUserId as string) ?? undefined,
      organizationId: (data.organizationId as string) ?? undefined,
    };
  });

  const lastDoc = snap.docs[snap.docs.length - 1] ?? null;
  return {
    entries,
    cursor: lastDoc,
    done: snap.docs.length < pageSize,
  };
}
