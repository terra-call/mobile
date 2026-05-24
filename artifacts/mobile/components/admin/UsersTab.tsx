// UsersTab — admin user management.
// Two internal views: list (browse + filter) and edit (assign org / role /
// HIPAA consent). Email cannot be changed here — that's owned by Firebase Auth.
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
import { useAuth, type UserRole } from "@/contexts/AuthContext";
import { logAudit } from "@/services/audit";
import {
  type Organization,
  listOrganizations,
} from "@/services/organizations";
import {
  type AdminUserUpdate,
  type AdminUserView,
  type OrganizationRole,
  listUsers,
  updateUserAdmin,
} from "@/services/users";
import { COLORS } from "./shared";

type ViewMode = "list" | "edit";

const ROLE_FILTER_OPTIONS: { value: UserRole | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admin" },
  { value: "caregiver", label: "Caregiver" },
  { value: "care-receiver", label: "Care Recipient" },
  { value: "family", label: "Family" },
];

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "caregiver", label: "Caregiver" },
  { value: "care-receiver", label: "Care Recipient" },
  { value: "family", label: "Family" },
];

const ORG_ROLE_OPTIONS: {
  value: NonNullable<OrganizationRole> | "none";
  label: string;
}[] = [
  { value: "none", label: "—" },
  { value: "case_manager", label: "Case Manager" },
  { value: "agency_admin", label: "Agency Admin" },
  { value: "member", label: "Member" },
];

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  caregiver: "Caregiver",
  "care-receiver": "Care Recipient",
  family: "Family",
};

const ROLE_COLOR: Record<UserRole, string> = {
  admin: COLORS.RED,
  caregiver: COLORS.TEAL,
  "care-receiver": COLORS.GREEN,
  family: "#00C8FF", // electric blue from brand spec
};

export default function UsersTab() {
  const [view, setView] = useState<ViewMode>("list");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const goToList = () => {
    setEditingUserId(null);
    setView("list");
    setRefreshKey((k) => k + 1);
  };

  const goToEdit = (userId: string) => {
    setEditingUserId(userId);
    setView("edit");
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.BG }}>
      {view === "list" && (
        <UserList key={refreshKey} onSelect={goToEdit} />
      )}
      {view === "edit" && editingUserId && (
        <UserEditForm
          userId={editingUserId}
          onSaved={goToList}
          onCancel={goToList}
        />
      )}
    </View>
  );
}

// ── LIST VIEW ────────────────────────────────────────────────────────────────

function UserList({ onSelect }: { onSelect: (id: string) => void }) {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [userList, orgList] = await Promise.all([
        listUsers(),
        listOrganizations(),
      ]);
      setUsers(userList);
      setOrgs(orgList);
    } catch (err) {
      console.warn("[users-list] load failed", err);
      setError("Could not load users. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgNameById = useMemo(() => {
    const map = new Map<string, string>();
    orgs.forEach((o) => map.set(o.organizationId, o.organizationName));
    return map;
  }, [orgs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter]);

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
      <View style={s.searchWrap}>
        <Feather name="search" size={16} color={COLORS.MUTED} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or email"
          placeholderTextColor={COLORS.MUTED}
          style={s.searchInput}
          autoCapitalize="none"
        />
      </View>

      <View style={s.filterRow}>
        {ROLE_FILTER_OPTIONS.map((opt) => {
          const active = opt.value === roleFilter;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setRoleFilter(opt.value)}
              style={[s.filterPill, active && s.filterPillActive]}
            >
              <Text
                style={[
                  s.filterPillText,
                  active && s.filterPillTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={s.countLine}>
        Showing {filtered.length} of {users.length} users
      </Text>

      {error ? (
        <View style={s.errorBox}>
          <Feather name="alert-circle" size={16} color={COLORS.RED} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.empty}>
          <Feather name="users" size={36} color={COLORS.MUTED} />
          <Text style={s.emptyTitle}>
            {users.length === 0 ? "No users yet" : "No matches"}
          </Text>
          <Text style={s.emptyText}>
            {users.length === 0
              ? "Users will appear here as they sign up."
              : "Try a different search or role filter."}
          </Text>
        </View>
      ) : (
        filtered.map((u) => {
          const orgName = u.organizationId
            ? orgNameById.get(u.organizationId) ?? "Unknown org"
            : null;
          return (
            <Pressable
              key={u.id}
              onPress={() => onSelect(u.id)}
              style={s.userCard}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>
                  {(u.name || u.email || "?").charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.userHeader}>
                  <Text style={s.userName} numberOfLines={1}>
                    {u.name || "(no name)"}
                  </Text>
                  <View
                    style={[
                      s.roleBadge,
                      { borderColor: ROLE_COLOR[u.role] },
                    ]}
                  >
                    <Text
                      style={[
                        s.roleBadgeText,
                        { color: ROLE_COLOR[u.role] },
                      ]}
                    >
                      {ROLE_LABEL[u.role]}
                    </Text>
                  </View>
                </View>
                <Text style={s.userEmail} numberOfLines={1}>
                  {u.email || "(no email)"}
                </Text>
                <Text style={s.userMeta} numberOfLines={1}>
                  {orgName ? `${orgName}` : "No organization"}
                  {u.hipaaConsentSigned ? "  ·  HIPAA ✓" : ""}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={COLORS.MUTED} />
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

// ── EDIT VIEW ────────────────────────────────────────────────────────────────

interface EditState {
  name: string;
  phone: string;
  role: UserRole;
  organizationId: string | null;
  organizationRole: OrganizationRole;
  hipaaConsentSigned: boolean;
  npiNumber: string;
}

function fromUser(u: AdminUserView): EditState {
  return {
    name: u.name,
    phone: u.phone ?? "",
    role: u.role,
    organizationId: u.organizationId,
    organizationRole: u.organizationRole,
    hipaaConsentSigned: u.hipaaConsentSigned,
    npiNumber: u.npiNumber ?? "",
  };
}

function UserEditForm({
  userId,
  onSaved,
  onCancel,
}: {
  userId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { user: actor } = useAuth();
  const [target, setTarget] = useState<AdminUserView | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [form, setForm] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [userList, orgList] = await Promise.all([
          listUsers(),
          listOrganizations(),
        ]);
        if (cancelled) return;
        const found = userList.find((u) => u.id === userId) ?? null;
        setTarget(found);
        setOrgs(orgList);
        if (found) setForm(fromUser(found));
      } catch (err) {
        console.warn("[user-edit] load failed", err);
        if (!cancelled) {
          setLoadError("Could not load this user. Check your connection.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <View style={[s.center, { flex: 1 }]}>
        <ActivityIndicator size="large" color={COLORS.TEAL} />
      </View>
    );
  }

  if (loadError || !target || !form) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={s.formHeader}>
          <Pressable onPress={onCancel} hitSlop={8} style={s.backBtn}>
            <Feather name="arrow-left" size={18} color={COLORS.MUTED} />
            <Text style={s.backBtnText}>Back</Text>
          </Pressable>
        </View>
        <View style={s.empty}>
          <Feather name="alert-circle" size={36} color={COLORS.RED} />
          <Text style={s.emptyTitle}>
            {loadError ? "Couldn't load user" : "User not found"}
          </Text>
          <Text style={s.emptyText}>
            {loadError ??
              "This user may have been deleted or you may not have access."}
          </Text>
          <Pressable onPress={onCancel} style={s.emptyCta}>
            <Text style={s.emptyCtaText}>Back to list</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const update = <K extends keyof EditState>(key: K, value: EditState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async () => {
    if (!form || !target) return;
    if (!form.name.trim()) {
      Alert.alert("Required", "Name cannot be empty.");
      return;
    }

    // Build an update payload that includes only fields that actually changed,
    // so the audit detail line is meaningful and we don't blindly stamp
    // unchanged fields.
    const update: AdminUserUpdate = {};
    const changes: string[] = [];

    if (form.name.trim() !== target.name) {
      update.name = form.name.trim();
      changes.push("name");
    }
    // Compare trimmed → trimmed so whitespace-only edits aren't false positives.
    const formPhone = form.phone.trim();
    const targetPhone = (target.phone ?? "").trim();
    if (formPhone !== targetPhone) {
      update.phone = formPhone;
      changes.push("phone");
    }
    if (form.role !== target.role) {
      // Self-demotion guard — an admin demoting themselves locks them out of
      // this UI on the next session. Block it explicitly so it's a deliberate
      // out-of-band action (another admin must do it).
      if (actor && actor.id === userId && target.role === "admin" && form.role !== "admin") {
        Alert.alert(
          "Blocked",
          "You can't demote yourself out of the admin role. Ask another admin to do this for you.",
        );
        return;
      }
      update.role = form.role;
      changes.push(`role→${form.role}`);
    }
    if ((form.organizationId ?? null) !== (target.organizationId ?? null)) {
      update.organizationId = form.organizationId;
      const newOrgName = form.organizationId
        ? orgs.find((o) => o.organizationId === form.organizationId)
            ?.organizationName ?? form.organizationId
        : "none";
      changes.push(`org→${newOrgName}`);
    }
    if ((form.organizationRole ?? null) !== (target.organizationRole ?? null)) {
      update.organizationRole = form.organizationRole;
      changes.push(`orgRole→${form.organizationRole ?? "none"}`);
    }
    if (form.hipaaConsentSigned !== target.hipaaConsentSigned) {
      update.hipaaConsentSigned = form.hipaaConsentSigned;
      changes.push(`hipaa→${form.hipaaConsentSigned ? "signed" : "cleared"}`);
    }
    const formNpi = form.npiNumber.trim();
    const targetNpi = (target.npiNumber ?? "").trim();
    if (formNpi !== targetNpi) {
      update.npiNumber = formNpi || null;
      changes.push("npi");
    }

    if (changes.length === 0) {
      Alert.alert("No changes", "Nothing to save.");
      return;
    }

    setSaving(true);
    try {
      await updateUserAdmin(userId, update);
      if (actor) {
        logAudit({
          userId: actor.id,
          targetUserId: userId,
          organizationId: form.organizationId ?? undefined,
          action: "user_updated",
          details: `Updated ${target.email || target.name || userId}: ${changes.join(", ")}`,
        }).catch(() => {});
      }
      onSaved();
    } catch (err) {
      console.warn("[user-edit] save failed", err);
      Alert.alert(
        "Save failed",
        "Could not save the changes. If this is an admin editing another user, the live Firestore users rule may still be self-write-only — publish the updated rule in Firebase Console (allow update: if isSelf(userId) || isAdmin()).",
      );
    } finally {
      setSaving(false);
    }
  };

  const orgOptions: { value: string | null; label: string }[] = [
    { value: null, label: "— None —" },
    ...orgs.map((o) => ({
      value: o.organizationId,
      label: o.organizationName,
    })),
  ];

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
          <Text style={s.formTitle}>Edit User</Text>
        </View>

        <View style={s.targetCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>
              {(target.name || target.email || "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.targetEmail}>{target.email}</Text>
            <Text style={s.targetMeta}>
              {target.createdAt ? `Joined ${formatDate(target.createdAt)}` : "Created date unknown"}
            </Text>
          </View>
        </View>

        <FormCard title="Profile" icon="user">
          <FormField label="Name" required>
            <TextInput
              value={form.name}
              onChangeText={(v) => update("name", v)}
              placeholder="Full name"
              placeholderTextColor={COLORS.MUTED}
              style={s.input}
            />
          </FormField>
          <FormField label="Phone">
            <TextInput
              value={form.phone}
              onChangeText={(v) => update("phone", v)}
              placeholder="+1 555 555 1234"
              placeholderTextColor={COLORS.MUTED}
              keyboardType="phone-pad"
              style={s.input}
            />
          </FormField>
          <FormField label="Role">
            <OptionRow
              options={ROLE_OPTIONS}
              value={form.role}
              onChange={(v) => update("role", v)}
            />
          </FormField>
        </FormCard>

        <FormCard title="Organization" icon="briefcase">
          <FormField label="Assigned Organization">
            {orgs.length === 0 ? (
              <Text style={s.helperText}>
                No organizations exist yet. Create one in the Organizations tab first.
              </Text>
            ) : (
              <View style={s.optionRow}>
                {orgOptions.map((opt) => {
                  const active = opt.value === form.organizationId;
                  return (
                    <Pressable
                      key={String(opt.value)}
                      onPress={() => update("organizationId", opt.value)}
                      style={[s.optionPill, active && s.optionPillActive]}
                    >
                      <Text
                        style={[
                          s.optionText,
                          active && s.optionTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </FormField>
          <FormField label="Organization Role">
            <View style={s.optionRow}>
              {ORG_ROLE_OPTIONS.map((opt) => {
                const current = form.organizationRole ?? "none";
                const active = opt.value === current;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() =>
                      update(
                        "organizationRole",
                        opt.value === "none" ? null : opt.value,
                      )
                    }
                    style={[s.optionPill, active && s.optionPillActive]}
                  >
                    <Text
                      style={[
                        s.optionText,
                        active && s.optionTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FormField>
          <FormField label="NPI Number (optional)">
            <TextInput
              value={form.npiNumber}
              onChangeText={(v) => update("npiNumber", v)}
              placeholder="National Provider Identifier"
              placeholderTextColor={COLORS.MUTED}
              keyboardType="number-pad"
              style={s.input}
            />
          </FormField>
        </FormCard>

        <FormCard title="HIPAA Compliance" icon="shield">
          <FormField label="HIPAA Consent">
            <View style={s.switchRow}>
              <Switch
                value={form.hipaaConsentSigned}
                onValueChange={(v) => update("hipaaConsentSigned", v)}
                trackColor={{ false: COLORS.PANEL_BORDER, true: COLORS.TEAL_DARK }}
                thumbColor={form.hipaaConsentSigned ? COLORS.TEAL : COLORS.MUTED}
              />
              <Text style={s.switchLabel}>
                {form.hipaaConsentSigned
                  ? "Consent signed (date will be stamped on save)"
                  : "Consent not on file"}
              </Text>
            </View>
            {target.hipaaConsentDate && (
              <Text style={s.helperText}>
                Last signed: {formatDate(target.hipaaConsentDate)}
              </Text>
            )}
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
              <Text style={s.saveBtnText}>Save Changes</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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

// ── HELPERS ──────────────────────────────────────────────────────────────────

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

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: COLORS.TEXT,
    fontSize: 14,
    paddingVertical: 0,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
    backgroundColor: COLORS.PANEL_DARK,
  },
  filterPillActive: {
    borderColor: COLORS.TEAL,
    backgroundColor: "rgba(0, 151, 167, 0.18)",
  },
  filterPillText: { color: COLORS.MUTED, fontSize: 12, fontWeight: "600" },
  filterPillTextActive: { color: COLORS.TEXT },
  countLine: {
    color: COLORS.MUTED,
    fontSize: 11,
    marginBottom: 10,
    marginLeft: 4,
  },

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

  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.PANEL_DARK,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.PANEL_BORDER,
  },
  avatarText: {
    color: COLORS.TEXT,
    fontSize: 16,
    fontWeight: "700",
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  userName: {
    color: COLORS.TEXT,
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  userEmail: {
    color: COLORS.SUB,
    fontSize: 12,
  },
  userMeta: {
    color: COLORS.MUTED,
    fontSize: 11,
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 9,
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

  targetCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.CARD_BG,
    borderWidth: 1,
    borderColor: COLORS.CARD_BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  targetEmail: { color: COLORS.TEXT, fontSize: 14, fontWeight: "700" },
  targetMeta: { color: COLORS.MUTED, fontSize: 11, marginTop: 2 },

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
  helperText: {
    color: COLORS.MUTED,
    fontSize: 11,
    marginTop: 6,
    fontStyle: "italic",
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
  switchLabel: { color: COLORS.SUB, fontSize: 13, flex: 1 },

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
});
