// AuditLogTab — HIPAA audit trail viewer.
// Server-side: orderBy timestamp desc + optional date range + cursor pagination.
// Client-side: action filter and free-text search across user/details/target.
// Export: CSV of the filtered set currently in memory.
import { Feather } from "@expo/vector-icons";
import { Timestamp } from "firebase/firestore";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  type AuditAction,
  type AuditLogEntry,
  listAuditLogs,
} from "@/services/audit";
import { listUsers, type AdminUserView } from "@/services/users";
import { COLORS } from "./shared";

// Order roughly matches the AuditAction union — anything else lands in TEAL.
const ACTION_OPTIONS: { label: string; value: AuditAction | "all" }[] = [
  { label: "All actions", value: "all" },
  { label: "Login", value: "login" },
  { label: "Logout", value: "logout" },
  { label: "Account created", value: "account_created" },
  { label: "Check-in", value: "checkin" },
  { label: "Missed check-in", value: "alert_missed" },
  { label: "Emergency alert", value: "alert_emergency" },
  { label: "I'm not OK", value: "alert_im_not_ok" },
  { label: "Data accessed", value: "data_accessed" },
  { label: "Profile updated", value: "profile_updated" },
  { label: "Org created", value: "organization_created" },
  { label: "Org updated", value: "organization_updated" },
  { label: "User updated", value: "user_updated" },
  { label: "Report generated", value: "care_report_generated" },
  { label: "Report exported", value: "care_report_exported" },
];

const PAGE_SIZE = 50;

function actionColor(action: string): string {
  if (
    action === "alert_emergency" ||
    action === "alert_missed" ||
    action === "alert_im_not_ok"
  ) {
    return COLORS.RED;
  }
  if (
    action === "checkin" ||
    action === "login" ||
    action === "account_created"
  ) {
    return COLORS.GREEN;
  }
  if (action === "logout") return COLORS.MUTED;
  return COLORS.TEAL;
}

function actionLabel(action: string): string {
  return action.replace(/_/g, " ");
}

function fmtTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== "function") return "—";
  return ts.toDate().toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseInputDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
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

// CSV-injection safe — same approach as reportExport.
function csvEscape(value: string | number): string {
  let s = String(value);
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function AuditLogTab() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Pagination cursor — kept in a ref so refresh-vs-load-more cannot race.
  const cursorRef = useRef<Awaited<ReturnType<typeof listAuditLogs>>["cursor"]>(
    null,
  );
  const [done, setDone] = useState(false);

  // Request-version guard. Every refresh / date-range change bumps this; an
  // in-flight loadNextPage that captured an older value will be discarded so
  // it cannot append stale rows after a refresh has reset state.
  const requestIdRef = useRef(0);

  // User name lookup cache for friendlier rows.
  const [userMap, setUserMap] = useState<Map<string, AdminUserView>>(new Map());

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((list) => {
        if (cancelled) return;
        const map = new Map<string, AdminUserView>();
        list.forEach((u) => map.set(u.id, u));
        setUserMap(map);
      })
      .catch((err) => console.warn("[audit-log] user lookup failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const buildRange = useCallback((): { start?: Date; end?: Date } | null => {
    const start = startDate.trim() ? parseInputDate(startDate) : null;
    const end = endDate.trim() ? parseInputDate(endDate) : null;
    if (startDate.trim() && !start) return null;
    if (endDate.trim() && !end) return null;
    if (start && end && end < start) return null;
    const endInclusive = end ? new Date(end) : undefined;
    if (endInclusive) endInclusive.setHours(23, 59, 59, 999);
    return {
      start: start ?? undefined,
      end: endInclusive,
    };
  }, [startDate, endDate]);

  const loadFirstPage = useCallback(async () => {
    // Bump the request version so any in-flight load-more is invalidated.
    const myRequestId = ++requestIdRef.current;
    setError(null);
    const range = buildRange();
    if (!range) {
      setError("Date range is invalid. Use YYYY-MM-DD; end must be after start.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const result = await listAuditLogs({
        pageSize: PAGE_SIZE,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      // A newer refresh has started since we kicked off — discard our results.
      if (myRequestId !== requestIdRef.current) return;
      cursorRef.current = result.cursor;
      setEntries(result.entries);
      setDone(result.done);
    } catch (err) {
      console.warn("[audit-log] first page failed", err);
      if (myRequestId !== requestIdRef.current) return;
      setError(
        "Could not load audit log. Check your connection and admin Firestore rules.",
      );
      setEntries([]);
      setDone(true);
    } finally {
      if (myRequestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [buildRange]);

  // Refetch when the date range changes (action/search are client-side only).
  useEffect(() => {
    setLoading(true);
    cursorRef.current = null;
    setDone(false);
    loadFirstPage();
  }, [loadFirstPage]);

  const loadNextPage = useCallback(async () => {
    // Block when no cursor exists yet, or while a refresh / first page is in
    // flight (loading=true means a fresh fetch will replace state imminently).
    if (loadingMore || done || loading || refreshing) return;
    const myRequestId = requestIdRef.current;
    setLoadingMore(true);
    const range = buildRange();
    if (!range) {
      setLoadingMore(false);
      return;
    }
    try {
      const result = await listAuditLogs({
        pageSize: PAGE_SIZE,
        rangeStart: range.start,
        rangeEnd: range.end,
        cursor: cursorRef.current,
      });
      // If a refresh started while we were fetching, our response is stale —
      // do NOT mutate entries / cursor / done.
      if (myRequestId !== requestIdRef.current) return;
      cursorRef.current = result.cursor;
      setEntries((prev) => [...prev, ...result.entries]);
      setDone(result.done);
    } catch (err) {
      console.warn("[audit-log] next page failed", err);
      if (myRequestId === requestIdRef.current) {
        Alert.alert("Load failed", "Could not load more entries.");
      }
    } finally {
      if (myRequestId === requestIdRef.current) {
        setLoadingMore(false);
      }
    }
  }, [buildRange, loadingMore, done, loading, refreshing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!q) return true;
      const userName = userMap.get(e.userId)?.name?.toLowerCase() ?? "";
      const userEmail = userMap.get(e.userId)?.email?.toLowerCase() ?? "";
      return (
        e.userId.toLowerCase().includes(q) ||
        userName.includes(q) ||
        userEmail.includes(q) ||
        e.details.toLowerCase().includes(q) ||
        (e.targetUserId?.toLowerCase().includes(q) ?? false) ||
        (e.organizationId?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [entries, actionFilter, search, userMap]);

  const handleClearFilters = () => {
    setActionFilter("all");
    setSearch("");
    setStartDate("");
    setEndDate("");
  };

  const handleExport = async () => {
    if (filtered.length === 0) {
      Alert.alert("Nothing to export", "No entries match the current filters.");
      return;
    }
    // Be explicit — the CSV only contains the pages currently loaded into the
    // tab. Loading more pages first will include them in the next export.
    if (!done) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Export loaded entries?",
          `Only the ${filtered.length} entries currently loaded will be exported. Tap "Load more" first if you need older entries included.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Export", onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }
    const header = [
      "Timestamp",
      "User ID",
      "User Name",
      "Action",
      "Target User",
      "Organization",
      "Device",
      "Details",
    ];
    const rows = [header];
    filtered.forEach((e) => {
      const u = userMap.get(e.userId);
      rows.push([
        fmtTimestamp(e.timestamp),
        e.userId,
        u?.name ?? "",
        actionLabel(e.action),
        e.targetUserId ?? "",
        e.organizationId ?? "",
        e.deviceInfo ?? "",
        e.details,
      ]);
    });
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const stamp = new Date();
    const filename = `audit_log_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}.csv`;

    if (Platform.OS === "web") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    const dir = FileSystem.cacheDirectory;
    if (!dir) {
      Alert.alert("Export failed", "No writable cache directory available.");
      return;
    }
    const path = `${dir}${filename}`;
    try {
      await FileSystem.writeAsStringAsync(path, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: "text/csv",
          dialogTitle: "Export Audit Log (CSV)",
          UTI: "public.comma-separated-values-text",
        });
      }
    } catch (err) {
      console.warn("[audit-log] export failed", err);
      Alert.alert("Export failed", "Could not export the audit log.");
    } finally {
      // PHI hygiene — drop the temp file once the share sheet closes.
      try {
        await FileSystem.deleteAsync(path, { idempotent: true });
      } catch {
        /* best-effort */
      }
    }
  };

  const activeFilterCount =
    (actionFilter !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0) +
    (startDate.trim() ? 1 : 0) +
    (endDate.trim() ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.BG }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              cursorRef.current = null;
              setDone(false);
              loadFirstPage();
            }}
            tintColor={COLORS.TEAL}
          />
        }
      >
        {/* Filter bar — quick search always visible; advanced collapses. */}
        <View style={s.filterCard}>
          <View style={s.searchWrap}>
            <Feather name="search" size={14} color={COLORS.MUTED} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search user, details, target…"
              placeholderTextColor={COLORS.MUTED}
              style={s.searchInput}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch("")} hitSlop={8}>
                <Feather name="x" size={14} color={COLORS.MUTED} />
              </Pressable>
            )}
          </View>

          <View style={s.filterRow}>
            <Pressable
              onPress={() => setShowFilters((v) => !v)}
              style={s.filterToggle}
            >
              <Feather name="sliders" size={14} color={COLORS.TEAL} />
              <Text style={s.filterToggleText}>
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Text>
              <Feather
                name={showFilters ? "chevron-up" : "chevron-down"}
                size={14}
                color={COLORS.TEAL}
              />
            </Pressable>
            <Pressable onPress={handleExport} style={s.exportBtn}>
              <Feather name="download" size={14} color={COLORS.TEAL} />
              <Text style={s.exportBtnText}>Export CSV</Text>
            </Pressable>
          </View>

          {showFilters && (
            <View style={{ marginTop: 12 }}>
              <Text style={s.fieldLabel}>Action</Text>
              <Pressable
                onPress={() => setShowActionPicker(true)}
                style={s.dropdownTrigger}
              >
                <Text style={s.dropdownText}>
                  {ACTION_OPTIONS.find((o) => o.value === actionFilter)?.label ??
                    "All actions"}
                </Text>
                <Feather name="chevron-down" size={14} color={COLORS.MUTED} />
              </Pressable>

              <View style={s.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Start (YYYY-MM-DD)</Text>
                  <TextInput
                    value={startDate}
                    onChangeText={setStartDate}
                    placeholder="2025-01-01"
                    placeholderTextColor={COLORS.MUTED}
                    autoCapitalize="none"
                    style={s.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>End (YYYY-MM-DD)</Text>
                  <TextInput
                    value={endDate}
                    onChangeText={setEndDate}
                    placeholder="2025-12-31"
                    placeholderTextColor={COLORS.MUTED}
                    autoCapitalize="none"
                    style={s.input}
                  />
                </View>
              </View>

              {activeFilterCount > 0 && (
                <Pressable onPress={handleClearFilters} style={s.clearBtn}>
                  <Feather name="x-circle" size={14} color={COLORS.MUTED} />
                  <Text style={s.clearBtnText}>Clear filters</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Feather name="alert-circle" size={16} color={COLORS.RED} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={COLORS.TEAL} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <Feather name="file-text" size={36} color={COLORS.MUTED} />
            <Text style={s.emptyTitle}>No matching entries</Text>
            <Text style={s.emptyText}>
              {entries.length === 0
                ? "No audit log entries yet. Actions like logins, check-ins, and admin edits will appear here."
                : "Adjust the filters above to see more results."}
            </Text>
          </View>
        ) : (
          <>
            <Text style={s.countLine}>
              {filtered.length}
              {filtered.length !== entries.length
                ? ` of ${entries.length} loaded`
                : " entries"}
            </Text>

            {filtered.map((e) => {
              const u = userMap.get(e.userId);
              const target = e.targetUserId
                ? (userMap.get(e.targetUserId)?.name ?? e.targetUserId)
                : null;
              return (
                <View key={e.logId} style={s.row}>
                  <View style={s.rowHeader}>
                    <View
                      style={[
                        s.actionBadge,
                        { borderColor: actionColor(e.action) },
                      ]}
                    >
                      <Text
                        style={[
                          s.actionBadgeText,
                          { color: actionColor(e.action) },
                        ]}
                      >
                        {actionLabel(e.action)}
                      </Text>
                    </View>
                    <Text style={s.rowTimestamp}>
                      {fmtTimestamp(e.timestamp)}
                    </Text>
                  </View>
                  <Text style={s.rowDetails}>{e.details || "(no details)"}</Text>
                  <View style={s.rowMeta}>
                    <Text style={s.rowMetaText}>
                      <Text style={s.rowMetaLabel}>By </Text>
                      {u?.name ?? "Unknown"}
                      <Text style={s.rowMetaLabel}>
                        {" · "}
                        {e.userId.slice(0, 8)}
                      </Text>
                    </Text>
                    {target && (
                      <Text style={s.rowMetaText}>
                        <Text style={s.rowMetaLabel}>Target: </Text>
                        {target}
                      </Text>
                    )}
                    {e.organizationId && (
                      <Text style={s.rowMetaText}>
                        <Text style={s.rowMetaLabel}>Org: </Text>
                        {e.organizationId.slice(0, 12)}
                      </Text>
                    )}
                    {e.deviceInfo && (
                      <Text style={s.rowMetaText}>
                        <Text style={s.rowMetaLabel}>Device: </Text>
                        {e.deviceInfo}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}

            {!done ? (
              <Pressable
                onPress={loadNextPage}
                style={[s.loadMore, loadingMore && { opacity: 0.6 }]}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator color={COLORS.TEAL} />
                ) : (
                  <>
                    <Feather name="chevron-down" size={14} color={COLORS.TEAL} />
                    <Text style={s.loadMoreText}>Load more</Text>
                  </>
                )}
              </Pressable>
            ) : entries.length > 0 ? (
              <Text style={s.endText}>End of audit log</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Action picker modal */}
      <Modal
        visible={showActionPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionPicker(false)}
      >
        <Pressable
          style={s.modalBackdrop}
          onPress={() => setShowActionPicker(false)}
        >
          <Pressable style={s.modalCard} onPress={() => {}}>
            <Text style={s.modalTitle}>Filter by action</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {ACTION_OPTIONS.map((o) => {
                const active = o.value === actionFilter;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => {
                      setActionFilter(o.value);
                      setShowActionPicker(false);
                    }}
                    style={[s.modalRow, active && s.modalRowActive]}
                  >
                    <Text style={s.modalRowText}>{o.label}</Text>
                    {active && (
                      <Feather name="check" size={16} color={COLORS.TEAL} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  center: { padding: 32, alignItems: "center" },

  filterCard: {
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
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
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  filterToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.TEAL,
    backgroundColor: "rgba(0, 151, 167, 0.10)",
  },
  filterToggleText: { color: COLORS.TEAL, fontWeight: "700", fontSize: 13 },
  exportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.TEAL,
    backgroundColor: "rgba(0, 151, 167, 0.10)",
  },
  exportBtnText: { color: COLORS.TEAL, fontWeight: "700", fontSize: 13 },

  fieldLabel: {
    color: COLORS.SUB,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    marginTop: 6,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.PANEL_DARK,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownText: { color: COLORS.TEXT, fontSize: 13 },

  dateRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  input: {
    backgroundColor: COLORS.PANEL_DARK,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: COLORS.TEXT,
    fontSize: 13,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    marginTop: 10,
  },
  clearBtnText: { color: COLORS.MUTED, fontSize: 12, fontWeight: "600" },

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

  countLine: {
    color: COLORS.MUTED,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 8,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  row: {
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 10,
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  actionBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  rowTimestamp: {
    color: COLORS.MUTED,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  rowDetails: { color: COLORS.TEXT, fontSize: 13, lineHeight: 18 },
  rowMeta: { marginTop: 8, gap: 2 },
  rowMetaText: { color: COLORS.SUB, fontSize: 11 },
  rowMetaLabel: { color: COLORS.MUTED },

  loadMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.TEAL,
    backgroundColor: "rgba(0, 151, 167, 0.10)",
    marginTop: 8,
  },
  loadMoreText: { color: COLORS.TEAL, fontWeight: "700", fontSize: 13 },
  endText: {
    color: COLORS.MUTED,
    fontSize: 11,
    textAlign: "center",
    marginTop: 12,
    fontStyle: "italic",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 14,
    padding: 16,
    width: "100%",
    maxWidth: 360,
  },
  modalTitle: {
    color: COLORS.TEXT,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  modalRowActive: { backgroundColor: "rgba(0, 151, 167, 0.12)" },
  modalRowText: { color: COLORS.TEXT, fontSize: 13 },
});
