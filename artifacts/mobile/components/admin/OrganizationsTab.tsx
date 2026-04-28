// OrganizationsTab — B2B account management.
// Three internal views: list (browse), form (add/edit), detail (drill in).
// All data reads & writes go through services/organizations.ts which scopes
// to the new `organizations` collection — does not touch users/invites.
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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/services/audit";
import {
  type CreateOrganizationInput,
  type Organization,
  type OrganizationStats,
  type OrganizationType,
  type SubscriptionStatus,
  type SubscriptionTier,
  createOrganization,
  getOrganizationMemberCounts,
  getOrganizationStats,
  listOrganizationMembers,
  listOrganizations,
  updateOrganization,
} from "@/services/organizations";
import { COLORS } from "./shared";

type ViewMode = "list" | "form" | "detail";

const TYPE_OPTIONS: { value: OrganizationType; label: string }[] = [
  { value: "home_health_agency", label: "Home Health Agency" },
  { value: "mco", label: "MCO" },
  { value: "hospice", label: "Hospice" },
  { value: "consumer", label: "Consumer" },
];

const TIER_OPTIONS: { value: SubscriptionTier; label: string }[] = [
  { value: "basic", label: "Basic" },
  { value: "family", label: "Family" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
];

const STATUS_OPTIONS: { value: SubscriptionStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "trial", label: "Trial" },
  { value: "inactive", label: "Inactive" },
];

const TYPE_LABELS: Record<OrganizationType, string> = {
  home_health_agency: "Home Health Agency",
  mco: "MCO",
  hospice: "Hospice",
  consumer: "Consumer",
};

const TIER_LABELS: Record<SubscriptionTier, string> = {
  basic: "Basic",
  family: "Family",
  pro: "Pro",
  enterprise: "Enterprise",
};

export default function OrganizationsTab() {
  const [view, setView] = useState<ViewMode>("list");
  const [editing, setEditing] = useState<Organization | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<"list" | "detail">("list");
  const [refreshKey, setRefreshKey] = useState(0);

  const goToList = () => {
    setEditing(null);
    setSelectedId(null);
    setReturnTo("list");
    setView("list");
    setRefreshKey((k) => k + 1);
  };

  const goToAdd = () => {
    setEditing(null);
    setReturnTo("list");
    setView("form");
  };

  const goToEditFromDetail = (org: Organization) => {
    setEditing(org);
    setSelectedId(org.organizationId);
    setReturnTo("detail");
    setView("form");
  };

  const goToDetail = (orgId: string) => {
    setSelectedId(orgId);
    setView("detail");
  };

  // After saving, return to wherever we came from. If from detail, refresh the
  // detail view via key bump so the edited fields/stats are re-fetched.
  const handleSaved = () => {
    if (returnTo === "detail" && selectedId) {
      setEditing(null);
      setRefreshKey((k) => k + 1);
      setView("detail");
    } else {
      goToList();
    }
  };

  // Cancel always returns to the prior view without re-fetching.
  const handleCancel = () => {
    if (returnTo === "detail" && selectedId) {
      setEditing(null);
      setView("detail");
    } else {
      goToList();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.BG }}>
      {view === "list" && (
        <OrgList key={refreshKey} onAdd={goToAdd} onSelect={goToDetail} />
      )}
      {view === "form" && (
        <OrgForm
          initial={editing}
          onSaved={handleSaved}
          onCancel={handleCancel}
        />
      )}
      {view === "detail" && selectedId && (
        <OrgDetail
          key={`${selectedId}-${refreshKey}`}
          organizationId={selectedId}
          onBack={goToList}
          onEdit={goToEditFromDetail}
        />
      )}
    </View>
  );
}

// ── LIST VIEW ────────────────────────────────────────────────────────────────

function OrgList({
  onAdd,
  onSelect,
}: {
  onAdd: () => void;
  onSelect: (id: string) => void;
}) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [memberCounts, setMemberCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const [list, counts] = await Promise.all([
      listOrganizations(),
      getOrganizationMemberCounts(),
    ]);
    setOrgs(list);
    setMemberCounts(counts);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) => o.organizationName.toLowerCase().includes(q));
  }, [orgs, search]);

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
      <View style={s.toolbar}>
        <View style={s.searchWrap}>
          <Feather name="search" size={16} color={COLORS.MUTED} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by organization name"
            placeholderTextColor={COLORS.MUTED}
            style={s.searchInput}
            autoCapitalize="none"
          />
        </View>
        <Pressable onPress={onAdd} style={s.addBtn} hitSlop={8}>
          <Feather name="plus" size={16} color={COLORS.TEXT} />
          <Text style={s.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {filtered.length === 0 ? (
        <View style={s.empty}>
          <Feather name="briefcase" size={36} color={COLORS.MUTED} />
          <Text style={s.emptyTitle}>
            {orgs.length === 0 ? "No organizations yet" : "No matches"}
          </Text>
          <Text style={s.emptyText}>
            {orgs.length === 0
              ? "Add your first home health agency, MCO, hospice, or consumer account."
              : "Try a different search term."}
          </Text>
          {orgs.length === 0 && (
            <Pressable onPress={onAdd} style={s.emptyCta}>
              <Text style={s.emptyCtaText}>Add Organization</Text>
            </Pressable>
          )}
        </View>
      ) : (
        filtered.map((org) => (
          <Pressable
            key={org.organizationId}
            onPress={() => onSelect(org.organizationId)}
            style={s.orgCard}
          >
            <View style={{ flex: 1 }}>
              <View style={s.orgCardHeader}>
                <Text style={s.orgName} numberOfLines={1}>
                  {org.organizationName}
                </Text>
                <View
                  style={[
                    s.statusBadge,
                    {
                      backgroundColor: org.isActive
                        ? "rgba(34, 255, 110, 0.12)"
                        : "rgba(136, 146, 176, 0.12)",
                      borderColor: org.isActive ? COLORS.GREEN : COLORS.MUTED,
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.statusBadgeText,
                      { color: org.isActive ? COLORS.GREEN : COLORS.MUTED },
                    ]}
                  >
                    {org.isActive ? "Active" : "Inactive"}
                  </Text>
                </View>
              </View>
              <Text style={s.orgMeta}>
                {TYPE_LABELS[org.organizationType]} · {TIER_LABELS[org.subscriptionTier]}
              </Text>
              <View style={s.orgFooterRow}>
                <Text style={s.orgFooter}>
                  {memberCounts.get(org.organizationId) ?? 0} members
                </Text>
                <Text style={s.orgFooter}>
                  ends {formatDate(org.contractEndDate)}
                </Text>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={COLORS.MUTED} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

// ── ADD / EDIT FORM ──────────────────────────────────────────────────────────

interface FormState {
  organizationName: string;
  organizationType: OrganizationType;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  pmpmRate: string;
  contractStartDate: string;
  contractEndDate: string;
  isActive: boolean;
}

function emptyForm(): FormState {
  return {
    organizationName: "",
    organizationType: "home_health_agency",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    subscriptionTier: "basic",
    subscriptionStatus: "trial",
    pmpmRate: "0",
    contractStartDate: "",
    contractEndDate: "",
    isActive: true,
  };
}

function fromOrganization(org: Organization): FormState {
  return {
    organizationName: org.organizationName,
    organizationType: org.organizationType,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    address: org.address,
    subscriptionTier: org.subscriptionTier,
    subscriptionStatus: org.subscriptionStatus,
    pmpmRate: String(org.pmpmRate ?? 0),
    contractStartDate: tsToInputDate(org.contractStartDate),
    contractEndDate: tsToInputDate(org.contractEndDate),
    isActive: org.isActive,
  };
}

function OrgForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Organization | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(() =>
    initial ? fromOrganization(initial) : emptyForm(),
  );
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const name = form.organizationName.trim();
    if (!name) {
      Alert.alert("Required", "Organization name is required.");
      return;
    }

    const startDate = parseInputDate(form.contractStartDate);
    const endDate = parseInputDate(form.contractEndDate);
    if (form.contractStartDate && !startDate) {
      Alert.alert("Invalid date", "Contract start date must be YYYY-MM-DD.");
      return;
    }
    if (form.contractEndDate && !endDate) {
      Alert.alert("Invalid date", "Contract end date must be YYYY-MM-DD.");
      return;
    }

    const pmpm = Number(form.pmpmRate);
    if (Number.isNaN(pmpm) || pmpm < 0) {
      Alert.alert("Invalid", "PMPM rate must be a non-negative number.");
      return;
    }

    const payload: CreateOrganizationInput = {
      organizationName: name,
      organizationType: form.organizationType,
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      contactPhone: form.contactPhone.trim(),
      address: form.address.trim(),
      subscriptionTier: form.subscriptionTier,
      subscriptionStatus: form.subscriptionStatus,
      pmpmRate: pmpm,
      contractStartDate: startDate,
      contractEndDate: endDate,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      if (isEdit && initial) {
        await updateOrganization(initial.organizationId, payload);
        if (user) {
          logAudit({
            userId: user.id,
            action: "organization_updated",
            organizationId: initial.organizationId,
            details: `Updated organization "${name}"`,
          }).catch(() => {});
        }
      } else {
        const newId = await createOrganization(payload);
        if (user && newId) {
          logAudit({
            userId: user.id,
            action: "organization_created",
            organizationId: newId,
            details: `Created organization "${name}"`,
          }).catch(() => {});
        }
      }
      onSaved();
    } catch (err) {
      console.warn("[org-form] save failed", err);
      Alert.alert(
        "Save failed",
        "Could not save the organization. Check your connection and Firestore rules.",
      );
    } finally {
      setSaving(false);
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
          <Text style={s.formTitle}>
            {isEdit ? "Edit Organization" : "Add Organization"}
          </Text>
        </View>

        <FormCard title="Basic Info" icon="briefcase">
          <FormField label="Organization Name" required>
            <TextInput
              value={form.organizationName}
              onChangeText={(v) => update("organizationName", v)}
              placeholder="Acme Home Health"
              placeholderTextColor={COLORS.MUTED}
              style={s.input}
            />
          </FormField>
          <FormField label="Organization Type">
            <OptionRow
              options={TYPE_OPTIONS}
              value={form.organizationType}
              onChange={(v) => update("organizationType", v)}
            />
          </FormField>
        </FormCard>

        <FormCard title="Primary Contact" icon="user">
          <FormField label="Contact Name">
            <TextInput
              value={form.contactName}
              onChangeText={(v) => update("contactName", v)}
              placeholder="Jane Smith"
              placeholderTextColor={COLORS.MUTED}
              style={s.input}
            />
          </FormField>
          <FormField label="Contact Email">
            <TextInput
              value={form.contactEmail}
              onChangeText={(v) => update("contactEmail", v)}
              placeholder="jane@acme.com"
              placeholderTextColor={COLORS.MUTED}
              keyboardType="email-address"
              autoCapitalize="none"
              style={s.input}
            />
          </FormField>
          <FormField label="Contact Phone">
            <TextInput
              value={form.contactPhone}
              onChangeText={(v) => update("contactPhone", v)}
              placeholder="+1 555 555 1234"
              placeholderTextColor={COLORS.MUTED}
              keyboardType="phone-pad"
              style={s.input}
            />
          </FormField>
          <FormField label="Address">
            <TextInput
              value={form.address}
              onChangeText={(v) => update("address", v)}
              placeholder="123 Main St, Suite 200, Springfield, IL 62701"
              placeholderTextColor={COLORS.MUTED}
              multiline
              style={[s.input, { minHeight: 64, textAlignVertical: "top" }]}
            />
          </FormField>
        </FormCard>

        <FormCard title="Subscription" icon="credit-card">
          <FormField label="Tier">
            <OptionRow
              options={TIER_OPTIONS}
              value={form.subscriptionTier}
              onChange={(v) => update("subscriptionTier", v)}
            />
          </FormField>
          <FormField label="Status">
            <OptionRow
              options={STATUS_OPTIONS}
              value={form.subscriptionStatus}
              onChange={(v) => update("subscriptionStatus", v)}
            />
          </FormField>
          <FormField label="PMPM Rate ($/member/month)">
            <TextInput
              value={form.pmpmRate}
              onChangeText={(v) => update("pmpmRate", v)}
              placeholder="0"
              placeholderTextColor={COLORS.MUTED}
              keyboardType="decimal-pad"
              style={s.input}
            />
          </FormField>
        </FormCard>

        <FormCard title="Contract" icon="calendar">
          <FormField label="Contract Start Date">
            <TextInput
              value={form.contractStartDate}
              onChangeText={(v) => update("contractStartDate", v)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.MUTED}
              autoCapitalize="none"
              style={s.input}
            />
          </FormField>
          <FormField label="Contract End Date">
            <TextInput
              value={form.contractEndDate}
              onChangeText={(v) => update("contractEndDate", v)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.MUTED}
              autoCapitalize="none"
              style={s.input}
            />
          </FormField>
          <FormField label="Active">
            <View style={s.switchRow}>
              <Switch
                value={form.isActive}
                onValueChange={(v) => update("isActive", v)}
                trackColor={{ false: COLORS.PANEL_BORDER, true: COLORS.TEAL_DARK }}
                thumbColor={form.isActive ? COLORS.TEAL : COLORS.MUTED}
              />
              <Text style={s.switchLabel}>
                {form.isActive ? "Account is active" : "Account is suspended"}
              </Text>
            </View>
          </FormField>
        </FormCard>

        <Pressable
          onPress={handleSave}
          style={[s.saveBtn, saving && { opacity: 0.6 }]}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.TEXT} />
          ) : (
            <>
              <Feather name="save" size={16} color={COLORS.TEXT} />
              <Text style={s.saveBtnText}>
                {isEdit ? "Save Changes" : "Create Organization"}
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── DETAIL VIEW ──────────────────────────────────────────────────────────────

function OrgDetail({
  organizationId,
  onBack,
  onEdit,
}: {
  organizationId: string;
  onBack: () => void;
  onEdit: (org: Organization) => void;
}) {
  const [org, setOrg] = useState<Organization | null>(null);
  const [stats, setStats] = useState<OrganizationStats | null>(null);
  const [members, setMembers] = useState<
    Array<{ id: string; name: string; email: string; role: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [orgList, statsRes, memberList] = await Promise.all([
        listOrganizations(),
        getOrganizationStats(organizationId),
        listOrganizationMembers(organizationId),
      ]);
      const found =
        orgList.find((o) => o.organizationId === organizationId) ?? null;
      setOrg(found);
      setStats(statsRes);
      setMembers(memberList);
    } catch (err) {
      console.warn("[org-detail] load failed", err);
      setError("Could not load this organization. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

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

  if (error || !org || !stats) {
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
            {error ? "Couldn't load organization" : "Organization not found"}
          </Text>
          <Text style={s.emptyText}>
            {error ??
              "This organization may have been deleted or you may not have access."}
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
        <Pressable onPress={() => onEdit(org)} hitSlop={8} style={s.editBtn}>
          <Feather name="edit-2" size={14} color={COLORS.TEAL} />
          <Text style={s.editBtnText}>Edit</Text>
        </Pressable>
      </View>

      <Text style={s.detailTitle}>{org.organizationName}</Text>
      <Text style={s.detailSub}>
        {TYPE_LABELS[org.organizationType]} · {TIER_LABELS[org.subscriptionTier]}
      </Text>

      <View style={s.statGrid}>
        <DetailStat label="Members" value={stats.memberCount} />
        <DetailStat label="Active (7d)" value={stats.activeMembers} />
        <DetailStat label="Check-Ins" value={stats.totalCheckIns} />
        <DetailStat label="Alerts" value={stats.totalEmergencies + stats.totalManualEmergencies + stats.totalMissed} />
      </View>

      <FormCard title="Account Details" icon="info">
        <DetailRow label="Status" value={org.isActive ? "Active" : "Inactive"} />
        <DetailRow label="Subscription" value={`${TIER_LABELS[org.subscriptionTier]} (${org.subscriptionStatus})`} />
        <DetailRow label="PMPM Rate" value={`$${org.pmpmRate.toFixed(2)}`} />
        <DetailRow label="Contract Start" value={formatDate(org.contractStartDate)} />
        <DetailRow label="Contract End" value={formatDate(org.contractEndDate)} />
      </FormCard>

      <FormCard title="Primary Contact" icon="user">
        <DetailRow label="Name" value={org.contactName || "—"} />
        <DetailRow label="Email" value={org.contactEmail || "—"} />
        <DetailRow label="Phone" value={org.contactPhone || "—"} />
        <DetailRow label="Address" value={org.address || "—"} multiline />
      </FormCard>

      <FormCard title={`Members (${members.length})`} icon="users">
        {members.length === 0 ? (
          <Text style={s.emptyMembers}>
            No users assigned to this organization yet. Assign users from the Users tab.
          </Text>
        ) : (
          members.map((m) => (
            <View key={m.id} style={s.memberRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.memberName}>{m.name}</Text>
                <Text style={s.memberMeta}>
                  {m.email} · {m.role || "no role"}
                </Text>
              </View>
            </View>
          ))
        )}
      </FormCard>
    </ScrollView>
  );
}

// ── REUSABLE PIECES ──────────────────────────────────────────────────────────

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
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>
        {label}
        {required ? <Text style={{ color: COLORS.RED }}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function OptionRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.optionRow}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[s.optionPill, active && s.optionPillActive]}
          >
            <Text style={[s.optionText, active && s.optionTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DetailStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.detailStat}>
      <Text style={s.detailStatValue}>{value}</Text>
      <Text style={s.detailStatLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <View style={[s.detailRow, multiline && { alignItems: "flex-start" }]}>
      <Text style={s.detailRowLabel}>{label}</Text>
      <Text style={s.detailRowValue}>{value}</Text>
    </View>
  );
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function tsToInputDate(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== "function") return "";
  const d = ts.toDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseInputDate(value: string): Timestamp | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  // Reject normalized overflow dates (e.g. 2026-02-31 → Mar 3): require round-trip.
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return Timestamp.fromDate(d);
}

function formatDate(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== "function") return "—";
  const d = ts.toDate();
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── STYLES ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },

  toolbar: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: COLORS.TEXT,
    fontSize: 14,
    paddingVertical: 0,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.TEAL,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  addBtnText: { color: COLORS.TEXT, fontWeight: "700", fontSize: 14 },

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

  orgCard: {
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
  orgCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  orgName: {
    color: COLORS.TEXT,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  orgMeta: {
    color: COLORS.SUB,
    fontSize: 12,
    marginBottom: 6,
  },
  orgFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  orgFooter: {
    color: COLORS.MUTED,
    fontSize: 11,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

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
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.TEAL,
  },
  editBtnText: { color: COLORS.TEAL, fontWeight: "700", fontSize: 13 },

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
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
    backgroundColor: COLORS.PANEL_DARK,
  },
  optionPillActive: {
    backgroundColor: "rgba(0, 151, 167, 0.18)",
    borderColor: COLORS.TEAL,
  },
  optionText: { color: COLORS.MUTED, fontSize: 13, fontWeight: "600" },
  optionTextActive: { color: COLORS.TEXT },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchLabel: { color: COLORS.SUB, fontSize: 13 },

  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.TEAL,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 6,
  },
  saveBtnText: { color: COLORS.TEXT, fontWeight: "700", fontSize: 15 },

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
  detailStat: {
    flex: 1,
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  detailStatValue: {
    color: COLORS.TEAL,
    fontSize: 22,
    fontWeight: "800",
  },
  detailStatLabel: {
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
    width: 100,
    letterSpacing: 0.3,
  },
  detailRowValue: {
    color: COLORS.TEXT,
    fontSize: 14,
    flex: 1,
    textAlign: "right",
  },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.PANEL_BORDER,
  },
  memberName: { color: COLORS.TEXT, fontSize: 14, fontWeight: "600" },
  memberMeta: { color: COLORS.MUTED, fontSize: 11, marginTop: 2 },
  emptyMembers: {
    color: COLORS.MUTED,
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 18,
  },
});
