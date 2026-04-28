// CareReportsTab — admin care-activity reporting.
// Three internal views:
//   - "list":    every saved report, most recent first
//   - "generate": pick user + date range → preview stats → save / export
//   - "detail":  open a saved report → view stats / export CSV / export PDF
import { Feather } from "@expo/vector-icons";
import { Timestamp } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/services/audit";
import {
  type CareReport,
  type CreateCareReportInput,
  createCareReport,
  generateCareReportData,
  getCareReportById,
  listCareReports,
} from "@/services/careReports";
import {
  exportReportAsCSV,
  exportReportAsPDF,
} from "@/services/reportExport";
import { listUsers, type AdminUserView } from "@/services/users";
import { COLORS } from "./shared";

type ViewMode = "list" | "generate" | "detail";

export default function CareReportsTab() {
  const [view, setView] = useState<ViewMode>("list");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const goToList = () => {
    setSelectedReportId(null);
    setView("list");
    setRefreshKey((k) => k + 1);
  };

  const goToGenerate = () => {
    setSelectedReportId(null);
    setView("generate");
  };

  const goToDetail = (reportId: string) => {
    setSelectedReportId(reportId);
    setView("detail");
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.BG }}>
      {view === "list" && (
        <ReportList
          key={refreshKey}
          onGenerate={goToGenerate}
          onSelect={goToDetail}
        />
      )}
      {view === "generate" && (
        <GenerateForm onSaved={goToList} onCancel={goToList} />
      )}
      {view === "detail" && selectedReportId && (
        <ReportDetail reportId={selectedReportId} onBack={goToList} />
      )}
    </View>
  );
}

// ── LIST VIEW ────────────────────────────────────────────────────────────────

function ReportList({
  onGenerate,
  onSelect,
}: {
  onGenerate: () => void;
  onSelect: (id: string) => void;
}) {
  const [reports, setReports] = useState<CareReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listCareReports();
      setReports(list);
    } catch (err) {
      console.warn("[care-reports] list failed", err);
      setError("Could not load reports. Check your connection.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={[s.center, { flex: 1 }]}>
        <ActivityIndicator size="large" color={COLORS.TEAL} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={COLORS.TEAL}
        />
      }
    >
      <Pressable onPress={onGenerate} style={s.generateBtn}>
        <Feather name="file-plus" size={16} color={COLORS.TEXT} />
        <Text style={s.generateBtnText}>Generate New Report</Text>
      </Pressable>

      {error ? (
        <View style={s.errorBox}>
          <Feather name="alert-circle" size={16} color={COLORS.RED} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : reports.length === 0 ? (
        <View style={s.empty}>
          <Feather name="file-text" size={36} color={COLORS.MUTED} />
          <Text style={s.emptyTitle}>No reports yet</Text>
          <Text style={s.emptyText}>
            Generate your first care-activity report to roll up a care receiver's
            check-ins, missed responses, and alerts over a date range.
          </Text>
        </View>
      ) : (
        reports.map((r) => {
          const total = r.totalCheckIns + r.missedCheckIns;
          const compliance =
            total > 0 ? `${Math.round((r.totalCheckIns / total) * 100)}%` : "—";
          return (
            <Pressable
              key={r.reportId}
              onPress={() => onSelect(r.reportId)}
              style={s.reportCard}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.reportName} numberOfLines={1}>
                  {r.careReceiverName ?? r.careReceiverId}
                </Text>
                <Text style={s.reportRange}>
                  {fmtDate(r.reportPeriodStart)} – {fmtDate(r.reportPeriodEnd)}
                </Text>
                <View style={s.reportMetricsRow}>
                  <Text style={s.reportMetric}>
                    <Text style={[s.reportMetricVal, { color: COLORS.GREEN }]}>
                      {r.totalCheckIns}
                    </Text>
                    {" check-ins"}
                  </Text>
                  <Text style={s.reportMetric}>
                    <Text style={[s.reportMetricVal, { color: COLORS.RED }]}>
                      {r.missedCheckIns}
                    </Text>
                    {" missed"}
                  </Text>
                  <Text style={s.reportMetric}>
                    <Text style={[s.reportMetricVal, { color: COLORS.TEAL }]}>
                      {compliance}
                    </Text>
                  </Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={COLORS.MUTED} />
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

// ── GENERATE FORM ────────────────────────────────────────────────────────────

function GenerateForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { user: actor } = useAuth();
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState(defaultEndDate());
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<CreateCareReportInput | null>(null);
  const [saving, setSaving] = useState(false);
  // Track exactly which inputs the current preview was generated from. If the
  // admin changes any input afterwards, the preview is considered stale and
  // Save/Export are disabled until the user regenerates.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const currentInputsKey = `${selectedUserId ?? ""}|${startDate}|${endDate}`;
  const previewIsStale = preview !== null && previewKey !== currentInputsKey;

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch((err) => {
        console.warn("[care-reports] user load failed", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users.slice(0, 25);
    return users
      .filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      )
      .slice(0, 25);
  }, [users, search]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  const handleGenerate = async () => {
    if (!actor) return;
    if (!selectedUser) {
      Alert.alert("Required", "Select a care receiver first.");
      return;
    }
    const start = parseInputDate(startDate);
    const end = parseInputDate(endDate);
    if (!start || !end) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD for both dates.");
      return;
    }
    if (end < start) {
      Alert.alert("Invalid range", "End date must be on or after start date.");
      return;
    }

    setGenerating(true);
    try {
      // Stretch end-date to end-of-day so events on the end date are included.
      const endInclusive = new Date(end);
      endInclusive.setHours(23, 59, 59, 999);
      const data = await generateCareReportData({
        careReceiverId: selectedUser.id,
        careReceiverName: selectedUser.name || selectedUser.email,
        organizationId: selectedUser.organizationId ?? undefined,
        rangeStart: start,
        rangeEnd: endInclusive,
        generatedBy: actor.id,
      });
      if (!data) {
        Alert.alert("Failed", "Could not generate report.");
        return;
      }
      setPreview(data);
      setPreviewKey(currentInputsKey);
    } catch (err) {
      console.warn("[care-reports] generate failed", err);
      // Clear any stale preview so the admin cannot save/export bad data.
      setPreview(null);
      setPreviewKey(null);
      Alert.alert(
        "Generate failed",
        "Could not compute the report. The event query failed — check your connection and Firestore rules, then try again.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!preview || !actor || previewIsStale) return;
    setSaving(true);
    try {
      const reportId = await createCareReport(preview);
      if (reportId && actor) {
        logAudit({
          userId: actor.id,
          targetUserId: preview.careReceiverId,
          organizationId: preview.organizationId,
          action: "care_report_generated",
          details: `Generated report for ${preview.careReceiverName ?? preview.careReceiverId} (${fmtDate(preview.reportPeriodStart)} – ${fmtDate(preview.reportPeriodEnd)})`,
        }).catch(() => {});
      }
      onSaved();
    } catch (err) {
      console.warn("[care-reports] save failed", err);
      Alert.alert(
        "Save failed",
        "Could not save the report. Check your connection and Firestore rules.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (kind: "csv" | "pdf") => {
    if (!preview || previewIsStale) return;
    try {
      if (kind === "csv") await exportReportAsCSV(preview);
      else await exportReportAsPDF(preview);
      if (actor) {
        logAudit({
          userId: actor.id,
          targetUserId: preview.careReceiverId,
          organizationId: preview.organizationId,
          action: "care_report_exported",
          details: `Exported ${kind.toUpperCase()} for ${preview.careReceiverName ?? preview.careReceiverId}`,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn(`[care-reports] export ${kind} failed`, err);
      Alert.alert("Export failed", `Could not export the report as ${kind.toUpperCase()}.`);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={s.formHeader}>
          <Pressable onPress={onCancel} hitSlop={8} style={s.backBtn}>
            <Feather name="arrow-left" size={18} color={COLORS.MUTED} />
            <Text style={s.backBtnText}>Cancel</Text>
          </Pressable>
          <Text style={s.formTitle}>Generate Care Report</Text>
        </View>

        <FormCard title="1. Care Receiver" icon="user">
          {loadingUsers ? (
            <ActivityIndicator color={COLORS.TEAL} />
          ) : (
            <>
              <View style={s.searchWrap}>
                <Feather name="search" size={14} color={COLORS.MUTED} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name or email"
                  placeholderTextColor={COLORS.MUTED}
                  style={s.searchInput}
                  autoCapitalize="none"
                />
              </View>
              <View style={{ marginTop: 8 }}>
                {filteredUsers.length === 0 ? (
                  <Text style={s.helperText}>No matching users.</Text>
                ) : (
                  filteredUsers.map((u) => {
                    const active = u.id === selectedUserId;
                    return (
                      <Pressable
                        key={u.id}
                        onPress={() => setSelectedUserId(u.id)}
                        style={[s.pickerRow, active && s.pickerRowActive]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={s.pickerName}>
                            {u.name || "(no name)"}
                          </Text>
                          <Text style={s.pickerMeta}>
                            {u.email} · {u.role}
                          </Text>
                        </View>
                        {active && (
                          <Feather
                            name="check"
                            size={18}
                            color={COLORS.TEAL}
                          />
                        )}
                      </Pressable>
                    );
                  })
                )}
                {!search && users.length > 25 && (
                  <Text style={s.helperText}>
                    Showing first 25 of {users.length} users — search to narrow down.
                  </Text>
                )}
              </View>
            </>
          )}
        </FormCard>

        <FormCard title="2. Date Range" icon="calendar">
          <FormField label="Start Date">
            <TextInput
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.MUTED}
              autoCapitalize="none"
              style={s.input}
            />
          </FormField>
          <FormField label="End Date">
            <TextInput
              value={endDate}
              onChangeText={setEndDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.MUTED}
              autoCapitalize="none"
              style={s.input}
            />
          </FormField>
        </FormCard>

        <Pressable
          onPress={handleGenerate}
          style={[s.primaryBtn, generating && { opacity: 0.6 }]}
          disabled={generating}
        >
          {generating ? (
            <ActivityIndicator color={COLORS.TEXT} />
          ) : (
            <>
              <Feather name="bar-chart-2" size={16} color={COLORS.TEXT} />
              <Text style={s.primaryBtnText}>
                {preview ? "Regenerate" : "Generate Report"}
              </Text>
            </>
          )}
        </Pressable>

        {preview && (
          <View style={{ marginTop: 14 }}>
            <FormCard title="Preview" icon="bar-chart-2">
              <ReportStats report={preview} />
            </FormCard>

            {previewIsStale && (
              <View style={s.staleWarning}>
                <Feather name="alert-triangle" size={14} color={COLORS.ORANGE} />
                <Text style={s.staleWarningText}>
                  Inputs changed since generation. Regenerate before saving or
                  exporting.
                </Text>
              </View>
            )}

            <Pressable
              onPress={handleSave}
              style={[
                s.primaryBtn,
                (saving || previewIsStale) && { opacity: 0.5 },
              ]}
              disabled={saving || previewIsStale}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.TEXT} />
              ) : (
                <>
                  <Feather name="save" size={16} color={COLORS.TEXT} />
                  <Text style={s.primaryBtnText}>Save Report</Text>
                </>
              )}
            </Pressable>

            <View style={s.exportRow}>
              <Pressable
                onPress={() => handleExport("csv")}
                style={[s.exportBtn, previewIsStale && { opacity: 0.5 }]}
                disabled={previewIsStale}
              >
                <Feather name="file-text" size={14} color={COLORS.TEAL} />
                <Text style={s.exportBtnText}>Export CSV</Text>
              </Pressable>
              <Pressable
                onPress={() => handleExport("pdf")}
                style={[s.exportBtn, previewIsStale && { opacity: 0.5 }]}
                disabled={previewIsStale}
              >
                <Feather name="file" size={14} color={COLORS.TEAL} />
                <Text style={s.exportBtnText}>Export PDF</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── DETAIL VIEW ──────────────────────────────────────────────────────────────

function ReportDetail({
  reportId,
  onBack,
}: {
  reportId: string;
  onBack: () => void;
}) {
  const { user: actor } = useAuth();
  const [report, setReport] = useState<CareReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch by document id rather than listing all reports — keeps the
        // detail view fast and avoids loading every report into memory.
        const found = await getCareReportById(reportId);
        if (cancelled) return;
        setReport(found);
      } catch (err) {
        console.warn("[care-reports] detail load failed", err);
        if (!cancelled) setError("Could not load this report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const handleExport = async (kind: "csv" | "pdf") => {
    if (!report) return;
    try {
      if (kind === "csv") await exportReportAsCSV(report);
      else await exportReportAsPDF(report);
      if (actor) {
        logAudit({
          userId: actor.id,
          targetUserId: report.careReceiverId,
          organizationId: report.organizationId,
          action: "care_report_exported",
          details: `Exported ${kind.toUpperCase()} for ${report.careReceiverName ?? report.careReceiverId}`,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn(`[care-reports] export ${kind} failed`, err);
      Alert.alert("Export failed", `Could not export the report as ${kind.toUpperCase()}.`);
    }
  };

  if (loading) {
    return (
      <View style={[s.center, { flex: 1 }]}>
        <ActivityIndicator size="large" color={COLORS.TEAL} />
      </View>
    );
  }

  if (error || !report) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={s.formHeader}>
          <Pressable onPress={onBack} hitSlop={8} style={s.backBtn}>
            <Feather name="arrow-left" size={18} color={COLORS.MUTED} />
            <Text style={s.backBtnText}>Back</Text>
          </Pressable>
        </View>
        <View style={s.empty}>
          <Feather name="alert-circle" size={36} color={COLORS.RED} />
          <Text style={s.emptyTitle}>
            {error ? "Couldn't load report" : "Report not found"}
          </Text>
          <Pressable onPress={onBack} style={s.emptyCta}>
            <Text style={s.emptyCtaText}>Back to list</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <View style={s.formHeader}>
        <Pressable onPress={onBack} hitSlop={8} style={s.backBtn}>
          <Feather name="arrow-left" size={18} color={COLORS.MUTED} />
          <Text style={s.backBtnText}>Back</Text>
        </Pressable>
      </View>

      <Text style={s.detailTitle}>
        {report.careReceiverName ?? report.careReceiverId}
      </Text>
      <Text style={s.detailSub}>
        {fmtDate(report.reportPeriodStart)} – {fmtDate(report.reportPeriodEnd)}
      </Text>

      <FormCard title="Activity" icon="bar-chart-2">
        <ReportStats report={report} />
      </FormCard>

      <FormCard title="Metadata" icon="info">
        <DetailRow label="Generated" value={fmtDate(report.generatedAt)} />
        <DetailRow label="Generated by" value={report.generatedBy} />
        {report.organizationId && (
          <DetailRow label="Organization" value={report.organizationId} />
        )}
        <DetailRow label="Care receiver ID" value={report.careReceiverId} />
      </FormCard>

      <View style={s.exportRow}>
        <Pressable onPress={() => handleExport("csv")} style={s.exportBtn}>
          <Feather name="file-text" size={14} color={COLORS.TEAL} />
          <Text style={s.exportBtnText}>Export CSV</Text>
        </Pressable>
        <Pressable onPress={() => handleExport("pdf")} style={s.exportBtn}>
          <Feather name="file" size={14} color={COLORS.TEAL} />
          <Text style={s.exportBtnText}>Export PDF</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── REUSABLE PIECES ──────────────────────────────────────────────────────────

function ReportStats({
  report,
}: {
  report: CareReport | CreateCareReportInput;
}) {
  const total = report.totalCheckIns + report.missedCheckIns;
  const compliance =
    total > 0 ? `${Math.round((report.totalCheckIns / total) * 100)}%` : "—";
  return (
    <>
      <View style={s.statGrid}>
        <Stat label="Check-Ins" value={report.totalCheckIns} color={COLORS.GREEN} />
        <Stat label="Missed" value={report.missedCheckIns} color={COLORS.RED} />
        <Stat label="Compliance" value={compliance} color={COLORS.TEAL} />
        <Stat
          label="Alerts"
          value={report.emergencyAlerts + report.imNotOkAlerts}
          color={COLORS.RED}
        />
      </View>
      <DetailRow label="Emergency alerts" value={String(report.emergencyAlerts)} />
      <DetailRow label={`"I'm not OK" alerts`} value={String(report.imNotOkAlerts)} />
      <DetailRow
        label="Avg response time"
        value={`${report.averageResponseTime} min`}
      />
    </>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailRowLabel}>{label}</Text>
      <Text style={s.detailRowValue}>{value}</Text>
    </View>
  );
}

function FormCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View style={s.formCard}>
      <View style={s.formCardHeader}>
        <Feather name={icon} size={16} color={COLORS.TEAL} />
        <Text style={s.formCardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultEndDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseInputDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

function fmtDate(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== "function") return "—";
  return ts.toDate().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── STYLES ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },

  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.TEAL,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  generateBtnText: { color: COLORS.TEXT, fontWeight: "700", fontSize: 14 },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255, 70, 90, 0.08)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.RED,
    padding: 12,
    marginBottom: 10,
  },
  errorText: { color: COLORS.RED, fontSize: 13, flex: 1 },

  empty: {
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 14,
    padding: 28,
    alignItems: "center",
    marginTop: 12,
  },
  emptyTitle: {
    color: COLORS.TEXT,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12,
  },
  emptyText: {
    color: COLORS.MUTED,
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  emptyCta: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: COLORS.TEAL,
    borderRadius: 10,
  },
  emptyCtaText: { color: COLORS.TEXT, fontWeight: "700" },

  reportCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  reportName: { color: COLORS.TEXT, fontSize: 15, fontWeight: "700" },
  reportRange: { color: COLORS.SUB, fontSize: 12, marginTop: 4 },
  reportMetricsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    flexWrap: "wrap",
  },
  reportMetric: { color: COLORS.MUTED, fontSize: 11 },
  reportMetricVal: { fontWeight: "700", fontSize: 12 },

  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backBtnText: { color: COLORS.MUTED, fontSize: 13, fontWeight: "600" },
  formTitle: {
    color: COLORS.TEXT,
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
    textAlign: "right",
  },

  formCard: {
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  formCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  formCardTitle: {
    color: COLORS.TEXT,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.PANEL_DARK,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: COLORS.TEXT,
    fontSize: 13,
    paddingVertical: 0,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    marginBottom: 4,
  },
  pickerRowActive: {
    borderColor: COLORS.TEAL,
    backgroundColor: "rgba(0, 151, 167, 0.12)",
  },
  pickerName: { color: COLORS.TEXT, fontSize: 13, fontWeight: "600" },
  pickerMeta: { color: COLORS.MUTED, fontSize: 11, marginTop: 2 },

  field: { marginBottom: 14 },
  fieldLabel: {
    color: COLORS.SUB,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: COLORS.PANEL_DARK,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.TEXT,
    fontSize: 14,
  },
  helperText: {
    color: COLORS.MUTED,
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 6,
  },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.TEAL,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 6,
  },
  primaryBtnText: { color: COLORS.TEXT, fontWeight: "700", fontSize: 15 },

  staleWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 159, 28, 0.10)",
    borderWidth: 1,
    borderColor: COLORS.ORANGE,
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
    marginBottom: 6,
  },
  staleWarningText: {
    color: COLORS.ORANGE,
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  exportRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  exportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.TEAL,
    backgroundColor: "rgba(0, 151, 167, 0.10)",
  },
  exportBtnText: { color: COLORS.TEAL, fontWeight: "700", fontSize: 13 },

  detailTitle: {
    color: COLORS.TEXT,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  detailSub: { color: COLORS.SUB, fontSize: 13, marginTop: 4, marginBottom: 16 },

  statGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  stat: {
    flex: 1,
    backgroundColor: COLORS.PANEL_DARK,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: {
    color: COLORS.MUTED,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.PANEL_BORDER,
    gap: 12,
  },
  detailRowLabel: {
    color: COLORS.MUTED,
    fontSize: 12,
    fontWeight: "600",
    width: 140,
    letterSpacing: 0.3,
  },
  detailRowValue: {
    color: COLORS.TEXT,
    fontSize: 13,
    flex: 1,
    textAlign: "right",
  },
});
