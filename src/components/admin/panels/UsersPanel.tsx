"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import {
    IconAdjustments,
    IconCheck,
    IconCopy,
    IconEye,
    IconKey,
    IconLoader2,
    IconRefresh,
    IconSearch,
    IconShieldLock,
    IconTrash,
    IconUserPlus,
    IconUsers,
    IconUsersGroup,
} from "@tabler/icons-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import { CELL, ColumnMenu, SCROLL_X, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
import { KpiCard } from "@/components/support/supportUi";
import UserPermissionsDrawer from "@/components/admin/users/UserPermissionsDrawer";
import EntraSyncModal, { type EntraDirectoryUser } from "@/components/admin/users/EntraSyncModal";
import { roleToDb, scopeLabel, shortOid } from "@/services/tenantUsers.service";
import type {
    EntraGroupSearchResult,
    EntraUserSearchResult,
    SaaSModuleKey,
    TenantUserItem,
    TenantUserRole,
    TenantUsersPayload,
} from "@/types/tenantUsers.types";
import { MODULE_PRESETS } from "@/types/tenantUsers.types";

/**
 * Usuarios y Permisos.
 *
 * Vive dentro del hub `/admin/access`, que ya provee las 5 sub-pestañas
 * (Usuarios, Seguridad 2FA, SSO SAML, Onboarding, Lighthouse) — acá no se
 * duplica esa navegación.
 *
 * RBAC de la propia pantalla: sólo Admin/Owner del tenant o SuperAdmin pueden
 * operar. `canAssignOwner` restringe la transferencia de propiedad a un Owner
 * existente o SuperAdmin, para que un Admin no se autopromocione a dueño. El
 * backend revalida las tres condiciones: acá es UX.
 *
 * Tenant real sin usuarios: se muestra el estado vacío legítimo. Nunca se
 * inyectan mocks como rescate visual.
 */

const USER_COLUMNS: TableColumnConfig[] = [
    { id: "name", label: "Nombre", visible: true },
    { id: "email", label: "Email / UPN", visible: true },
    { id: "oid", label: "Entra ID (OID)", visible: true },
    { id: "role", label: "Rol en plataforma", visible: true },
    { id: "scope", label: "Alcance de páginas", visible: true },
    { id: "mfa", label: "Estado 2FA", visible: true },
    { id: "lastLogin", label: "Último acceso", visible: true },
    { id: "actions", label: "Acciones", visible: true },
];

const ROLE_BADGE: Record<TenantUserRole, string> = {
    OWNER: "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800",
    ADMIN: "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800",
    CONTRIBUTOR: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700",
    READER: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
};

const MASTER_TENANT_ID = "8b41364f-581a-4e43-b7cb-13138dac5517";
const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";

/** `DD/MM/YYYY HH:mm`, o el label de "Nunca" si no hay fecha. */
function formatLastLogin(iso: string | undefined, neverLabel: string): string {
    if (!iso) return neverLabel;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return neverLabel;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export default function UsersPanel() {
    const t = useTranslations("AdminUsers");
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "";
    const isMock = isMockTenant(tenantId);

    const [payload, setPayload] = useState<TenantUsersPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [refreshingMfa, setRefreshingMfa] = useState(false);
    const [search, setSearch] = useState("");

    // Formulario de alta con autocompletado contra Graph.
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<EntraUserSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [picked, setPicked] = useState<EntraUserSearchResult | null>(null);
    const [newRole, setNewRole] = useState("Reader");
    const [newModules, setNewModules] = useState<SaaSModuleKey[]>(MODULE_PRESETS.FINOPS_ONLY);
    const [presetKey, setPresetKey] = useState("FINOPS_ONLY");
    const [inviting, setInviting] = useState(false);

    // Modal de sincronización y drawer de permisos.
    const [showEntraModal, setShowEntraModal] = useState(false);
    const [entraLoading, setEntraLoading] = useState(false);
    const [entraUsers, setEntraUsers] = useState<EntraDirectoryUser[]>([]);
    const [entraGroups, setEntraGroups] = useState<EntraGroupSearchResult[]>([]);
    const [selection, setSelection] = useState<Record<string, { selected: boolean; role: string; user: EntraDirectoryUser }>>({});
    const [provisioning, setProvisioning] = useState(false);
    const [drawerUser, setDrawerUser] = useState<TenantUserItem | null>(null);

    const cols = useColumnConfig(`table_columns_config_tenant_users_${tenantId}`, USER_COLUMNS);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Owner es superset de Admin: sin incluirlo, el creador del tenant queda
    // bloqueado de su propia pantalla de usuarios.
    const isAdmin = userRole === "Admin" || userRole === "Owner" || systemRole === "SUPERADMIN";
    const canAssignOwner = userRole === "Owner" || systemRole === "SUPERADMIN";
    const isMasterTenant = tenantId === MASTER_TENANT_ID;

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const canFetch = Boolean(tenantId) && tenantId !== "default" && (isMock || accounts.length > 0);

    const loadUsers = useCallback(
        async (refreshMfa = false) => {
            if (!canFetch) return;
            setLoading(true);
            try {
                const headers = await authHeaders();
                const res = await fetch(
                    `/api/admin/config/users?tenantId=${encodeURIComponent(tenantId)}${refreshMfa ? "&refreshMfa=true" : ""}`,
                    { headers }
                );
                const json = await res.json();
                if (!res.ok) throw new Error(json.error);
                setPayload(json as TenantUsersPayload);
                if (json.warning) toast.warning(String(json.warning));
            } catch (e) {
                toast.error(errorMessage(e) || t("errorConnection"));
            } finally {
                setLoading(false);
            }
        },
        [canFetch, authHeaders, tenantId, t]
    );

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    // Autocompletado con debounce: sin él, cada tecla sería un request a Graph.
    useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        const q = query.trim();
        if (q.length < 2) {
            setSuggestions([]);
            return;
        }
        searchTimer.current = setTimeout(async () => {
            setSearching(true);
            try {
                const headers = await authHeaders();
                const res = await fetch(
                    `/api/admin/users/search-entra?tenantId=${encodeURIComponent(tenantId)}&q=${encodeURIComponent(q)}`,
                    { headers }
                );
                const json = await res.json();
                if (res.ok) setSuggestions(json.users || []);
                else toast.error(json.error || t("errorSyncingEntra"));
            } catch {
                // Búsqueda fallida: el administrador puede seguir pegando el OID a mano.
            } finally {
                setSearching(false);
            }
        }, 350);
        return () => {
            if (searchTimer.current) clearTimeout(searchTimer.current);
        };
    }, [query, tenantId, authHeaders, t]);

    const applyPreset = (key: string) => {
        setPresetKey(key);
        if (key !== "CUSTOM") setNewModules(MODULE_PRESETS[key] || []);
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!picked) {
            toast.error(t("errorPickUserFirst"));
            return;
        }
        setInviting(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/config/users", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    email: picked.mail || picked.userPrincipalName,
                    entraOid: picked.id,
                    displayName: picked.displayName,
                    role: newRole,
                    allowedModules: newModules,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("successUserAdded"));
            setQuery("");
            setPicked(null);
            setSuggestions([]);
            setNewRole("Reader");
            applyPreset("FINOPS_ONLY");
            await loadUsers();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorAddingUser"));
        } finally {
            setInviting(false);
        }
    };

    const handleDelete = async (user: TenantUserItem) => {
        if (!confirm(t("confirmRevokeAccess", { email: user.email }))) return;
        // Optimista: la fila desaparece ya. Si el DELETE falla se recarga y vuelve.
        const previous = payload;
        setPayload((p) =>
            p
                ? { ...p, summary: { ...p.summary, users: p.summary.users.filter((u) => u.id !== user.id) } }
                : p
        );
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/config/users?tenantId=${encodeURIComponent(tenantId)}&userId=${user.id}`, {
                method: "DELETE",
                headers,
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(json.message || t("defaultUserDeletedMessage"));
            await loadUsers();
        } catch (e) {
            setPayload(previous);
            toast.error(errorMessage(e) || t("errorDeletingUser"));
        }
    };

    const handleRoleChange = async (user: TenantUserItem, dbRole: string) => {
        const previous = payload;
        setPayload((p) =>
            p
                ? {
                    ...p,
                    summary: {
                        ...p.summary,
                        users: p.summary.users.map((u) =>
                            u.id === user.id ? { ...u, role: (dbRole === "Colaborador" ? "CONTRIBUTOR" : dbRole.toUpperCase()) as TenantUserRole } : u
                        ),
                    },
                }
                : p
        );
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/config/users", {
                method: "PUT",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, userId: user.id, role: dbRole }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("successRoleUpdated"));
            await loadUsers();
        } catch (e) {
            setPayload(previous);
            toast.error(errorMessage(e) || t("errorUpdatingRole"));
        }
    };

    const savePermissions = async (user: TenantUserItem, modules: SaaSModuleKey[], subscriptionIds: string[]) => {
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/config/users", {
                method: "PUT",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, userId: user.id, allowedModules: modules, allowedSubscriptionIds: subscriptionIds }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("successPermissionsUpdated"));
            await loadUsers();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorUpdatingRole"));
        }
    };

    const openEntraModal = async () => {
        setShowEntraModal(true);
        setEntraLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/config/users/entra-sync", { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            const list: EntraDirectoryUser[] = json.users || [];
            setEntraUsers(list);
            setSelection(Object.fromEntries(list.map((u) => [u.id, { selected: false, role: "Reader", user: u }])));
            if (json.warning) toast.warning(String(json.warning));
        } catch (e) {
            toast.error(errorMessage(e) || t("errorSyncingEntra"));
        } finally {
            setEntraLoading(false);
        }
    };

    const searchGroups = async (q: string) => {
        setEntraLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/users/sync-group?tenantId=${encodeURIComponent(tenantId)}&q=${encodeURIComponent(q)}`, {
                headers,
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setEntraGroups(json.groups || []);
        } catch (e) {
            toast.error(errorMessage(e) || t("errorSyncingEntra"));
        } finally {
            setEntraLoading(false);
        }
    };

    const provisionUsers = async () => {
        const toProvision = Object.values(selection)
            .filter((s) => s.selected)
            .map((s) => ({
                entraOid: s.user.id,
                email: s.user.mail || s.user.userPrincipalName,
                displayName: s.user.displayName,
                role: s.role,
            }));
        if (toProvision.length === 0) {
            toast.error(t("errorSelectAtLeastOneUser"));
            return;
        }
        setProvisioning(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/config/users", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, users: toProvision }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(json.message || t("defaultUsersProvisionedMessage"));
            setShowEntraModal(false);
            await loadUsers();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorProvisioningUsers"));
        } finally {
            setProvisioning(false);
        }
    };

    const provisionGroup = async (groupId: string, role: TenantUserRole) => {
        if (!groupId) return;
        setProvisioning(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/users/sync-group", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, groupId, role: roleToDb(role), allowedModules: newModules }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(
                json.skipped > 0
                    ? t("groupSyncPartial", { provisioned: json.provisioned, skipped: json.skipped })
                    : t("groupSyncOk", { provisioned: json.provisioned })
            );
            setShowEntraModal(false);
            await loadUsers();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorProvisioningUsers"));
        } finally {
            setProvisioning(false);
        }
    };

    const users = payload?.summary.users || [];
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return users;
        return users.filter(
            (u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.entraObjectId.toLowerCase().includes(q)
        );
    }, [users, search]);

    const pg = usePagination(filtered, 15);
    const summary = payload?.summary;

    // Suscripciones del tenant para el drawer de alcance. Si el provider no las
    // expone, el selector se oculta en vez de mostrarse vacío.
    const availableSubscriptions = useMemo(() => {
        const raw = (selectedTenant as { subscriptions?: { id?: string; subscriptionId?: string; name?: string; displayName?: string }[] })?.subscriptions;
        if (!Array.isArray(raw)) return [];
        return raw
            .map((s) => ({ id: String(s.id || s.subscriptionId || ""), name: String(s.name || s.displayName || s.id || s.subscriptionId || "") }))
            .filter((s) => s.id);
    }, [selectedTenant]);

    if (!isAdmin) {
        return (
            <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
                    <IconShieldLock size={40} stroke={1.5} className="text-[#0078D4] mx-auto mb-3" />
                    <div className="font-bold text-[15px] text-slate-900 dark:text-white">{t("notAuthorizedTitle")}</div>
                    <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{t("notAuthorizedBody")}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-5">
                <h1 className="font-heading font-extrabold text-[20px] text-slate-900 dark:text-white flex items-center">
                    <IconUsersGroup size={24} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                    {t("title")}
                    <InfoTooltip content={t("titleHelp")} />
                </h1>
                <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">
                    {payload?.userLimit == null ? t("subtitleUnlimited") : t("subtitleLimited", { limit: payload.userLimit })}
                </p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <KpiCard
                    icon={IconUsers}
                    label={t("kpiRegistered")}
                    value={summary?.totalUsersCount ?? 0}
                    tone="#0078D4"
                    hint={payload?.userLimit == null ? t("kpiNoLimit") : t("kpiOfLimit", { limit: payload.userLimit })}
                    tooltip={<InfoTooltip content={t("kpiRegisteredHelp")} />}
                />
                <KpiCard
                    icon={IconShieldLock}
                    label={t("kpiAdmins")}
                    value={(summary?.ownersCount ?? 0) + (summary?.adminsCount ?? 0)}
                    tone="#2563EB"
                    hint={t("kpiAdminsHint", { owners: summary?.ownersCount ?? 0, admins: summary?.adminsCount ?? 0 })}
                    tooltip={<InfoTooltip content={t("kpiAdminsHelp")} />}
                />
                <KpiCard
                    icon={IconEye}
                    label={t("kpiReaders")}
                    value={summary?.readersCount ?? 0}
                    tone="#0284C7"
                    tooltip={<InfoTooltip content={t("kpiReadersHelp")} />}
                />
                <KpiCard
                    icon={IconKey}
                    label={t("kpiMfa")}
                    value={`${summary?.mfaAdoptionPercentage ?? 0}%`}
                    tone="#1B2A41"
                    hint={
                        (summary?.mfaUnknownCount ?? 0) > 0
                            ? t("kpiMfaUnknown", { count: summary?.mfaUnknownCount ?? 0 })
                            : t("kpiMfaKnown")
                    }
                    tooltip={<InfoTooltip content={t("kpiMfaHelp")} />}
                />
            </div>

            {/* Alta de usuario */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl mb-5">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                    <h2 className="font-heading font-bold text-[15px] text-slate-900 dark:text-white flex items-center">
                        <IconUserPlus size={18} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                        {t("addUserTitle")}
                        <InfoTooltip content={t("addUserHelp")} />
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => loadUsers(true)}
                            disabled={refreshingMfa || loading}
                            className="text-xs font-semibold rounded-lg border border-[#00AEEF] text-[#00AEEF] bg-white dark:bg-slate-900 px-3 py-2 cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                            <IconKey size={16} stroke={1.5} className="inline mr-1.5" />
                            {t("refreshMfa")}
                        </button>
                        <button
                            onClick={openEntraModal}
                            className="bg-slate-800 text-white hover:bg-slate-900 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap"
                        >
                            <IconRefresh size={16} stroke={1.5} className="inline mr-1.5" />
                            {t("syncFromEntra")}
                        </button>
                    </div>
                </div>

                <form onSubmit={handleInvite} className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <div className="relative">
                            <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("userSearchLabel")}</label>
                            <div className="relative mt-1">
                                <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={query}
                                    onChange={(e) => {
                                        setQuery(e.target.value);
                                        setPicked(null);
                                    }}
                                    placeholder={t("userSearchPlaceholder")}
                                    className="w-full pl-8 pr-8 py-2.5 text-[13px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                                />
                                {searching && (
                                    <IconLoader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-[#0078D4]" />
                                )}
                            </div>

                            {suggestions.length > 0 && !picked && (
                                <div className="absolute left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-[100]">
                                    {suggestions.map((s) => (
                                        <button
                                            type="button"
                                            key={s.id}
                                            disabled={s.alreadyProvisioned}
                                            onClick={() => {
                                                setPicked(s);
                                                setQuery(s.displayName);
                                                setSuggestions([]);
                                            }}
                                            className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <div className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">
                                                {s.displayName}
                                                {s.alreadyProvisioned && (
                                                    <span className="ml-2 text-[10px] font-bold uppercase text-slate-500">{t("alreadyAdded")}</span>
                                                )}
                                                {!s.accountEnabled && (
                                                    <span className="ml-2 text-[10px] font-bold uppercase text-amber-600">{t("accountDisabled")}</span>
                                                )}
                                            </div>
                                            <div className="text-[11.5px] text-slate-500 truncate">
                                                {s.mail || s.userPrincipalName}
                                                {s.jobTitle ? ` · ${s.jobTitle}` : ""}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                                {t("oidLabel")}
                                <InfoTooltip content={t("oidHelp")} />
                            </label>
                            <div className="relative mt-1">
                                <input
                                    value={picked?.id || ""}
                                    readOnly
                                    placeholder={t("oidPlaceholder")}
                                    className="w-full pr-8 px-3 py-2.5 text-[12.5px] font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 outline-none"
                                />
                                {picked && (
                                    <IconCheck size={16} stroke={2.5} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-600" />
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("baseRoleLabel")}</label>
                            <select
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value)}
                                className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] cursor-pointer"
                            >
                                <option value="Reader">{t("roleReaderFull")}</option>
                                <option value="Colaborador">{t("roleCollaborator")}</option>
                                <option value="Admin">{t("roleAdmin")}</option>
                                <option value="Owner" disabled={!canAssignOwner}>
                                    {t("roleOwner")}
                                </option>
                                {isMasterTenant && <option value="SuperAdmin">{t("roleSuperAdminGlobal")}</option>}
                            </select>
                        </div>
                    </div>

                    <div className="flex items-end justify-between gap-3 flex-wrap">
                        <div className="min-w-[260px]">
                            <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 flex items-center">
                                {t("pagePermissionsLabel")}
                                <InfoTooltip content={t("pagePermissionsHelp")} />
                            </label>
                            <select
                                value={presetKey}
                                onChange={(e) => applyPreset(e.target.value)}
                                className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] cursor-pointer"
                            >
                                <option value="FULL">{t("presetFull")}</option>
                                <option value="FINOPS_ONLY">{t("presetFinOps")}</option>
                                <option value="CLEANUP_GOVERNANCE">{t("presetCleanupGovernance")}</option>
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={inviting || !picked}
                            className="bg-[#0078D4] text-white hover:bg-[#0060AA] px-5 py-2.5 font-semibold rounded-lg text-[13px] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {inviting ? <IconLoader2 size={16} className="animate-spin" /> : <IconUserPlus size={16} stroke={1.5} />}
                            {t("addUserButton")}
                        </button>
                    </div>
                </form>
            </div>

            {/* Tabla */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="p-3 flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 dark:border-slate-800">
                    <h2 className="font-heading font-bold text-[14px] text-slate-900 dark:text-white flex items-center">
                        {t("registeredUsers", { count: summary?.totalUsersCount ?? 0 })}
                        <InfoTooltip content={t("registeredUsersHelp")} />
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative">
                            <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t("searchUsersPlaceholder")}
                                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] w-56"
                            />
                        </div>
                        <ColumnMenu {...cols} label={t("customizeColumns")} />
                    </div>
                </div>

                {loading ? (
                    <div className="p-6 flex items-center gap-2 text-slate-500 text-[13px]">
                        <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <IconUsers size={40} stroke={1.5} className="text-[#0078D4] mx-auto mb-3" />
                        <div className="font-bold text-[15px] text-slate-900 dark:text-white">{t("emptyTitle")}</div>
                        <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{t("emptyBody")}</div>
                    </div>
                ) : (
                    <>
                        <div className={SCROLL_X}>
                            <table className="w-full table-fixed">
                                <thead className="bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        {USER_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                                            <ResizableTh key={c.id} minWidth={100} className={TH}>
                                                {t(`col_${c.id}` as never)}
                                                <InfoTooltip content={t(`col_${c.id}_help` as never)} />
                                            </ResizableTh>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pg.paged.map((u) => {
                                        const scope = scopeLabel(u.allowedModules);
                                        return (
                                            <tr
                                                key={u.id}
                                                className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                                            >
                                                {cols.isVisible("name") && (
                                                    <td className={TD}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] text-[11px] font-bold grid place-items-center border border-blue-200 dark:border-blue-800 shrink-0">
                                                                {initials(u.displayName)}
                                                            </span>
                                                            <span className="min-w-0">
                                                                <span className={`block font-semibold text-slate-900 dark:text-white ${CELL}`} title={u.displayName}>
                                                                    {u.displayName}
                                                                </span>
                                                                <span className="block text-[11px] text-slate-500">
                                                                    {u.isSuperAdmin ? t("accountSuperAdmin") : t(`status_${u.accountStatus}` as never)}
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </td>
                                                )}
                                                {cols.isVisible("email") && (
                                                    <td className={TD}>
                                                        <span className={`${CELL} inline-block`} title={u.email}>
                                                            {u.email}
                                                        </span>
                                                    </td>
                                                )}
                                                {cols.isVisible("oid") && (
                                                    <td className={TD}>
                                                        <span className="font-mono text-[11.5px]" title={u.entraObjectId}>
                                                            {shortOid(u.entraObjectId)}
                                                        </span>
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard?.writeText(u.entraObjectId);
                                                                toast.success(t("oidCopied"));
                                                            }}
                                                            aria-label={t("copyOid")}
                                                            className="cursor-pointer"
                                                        >
                                                            <IconCopy size={13} className="inline ml-1 text-slate-400 hover:text-[#0078D4]" />
                                                        </button>
                                                    </td>
                                                )}
                                                {cols.isVisible("role") && (
                                                    <td className={TD}>
                                                        <select
                                                            value={u.role === "CONTRIBUTOR" ? "Colaborador" : u.role.charAt(0) + u.role.slice(1).toLowerCase()}
                                                            onChange={(e) => handleRoleChange(u, e.target.value)}
                                                            className={`text-[11px] font-semibold px-2 py-[3px] rounded-md cursor-pointer ${ROLE_BADGE[u.role]}`}
                                                        >
                                                            <option value="Reader">{t("roleReader")}</option>
                                                            <option value="Colaborador">{t("roleCollaborator")}</option>
                                                            <option value="Admin">{t("roleAdmin")}</option>
                                                            <option value="Owner" disabled={!canAssignOwner}>
                                                                {t("roleOwner")}
                                                            </option>
                                                            {isMasterTenant && <option value="SuperAdmin">{t("roleSuperAdmin")}</option>}
                                                        </select>
                                                    </td>
                                                )}
                                                {cols.isVisible("scope") && (
                                                    <td className={TD}>
                                                        <span
                                                            className={`text-[11px] font-semibold px-2 py-[3px] rounded-md ${scope.key === "full"
                                                                ? "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800"
                                                                : scope.key === "none"
                                                                    ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                                                                    : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700"
                                                                }`}
                                                        >
                                                            {scope.key === "full"
                                                                ? t("scopeFull")
                                                                : scope.key === "none"
                                                                    ? t("scopeNone")
                                                                    : t("scopePartial", { count: scope.count })}
                                                        </span>
                                                    </td>
                                                )}
                                                {cols.isVisible("mfa") && (
                                                    <td className={TD}>
                                                        {!u.mfaKnown ? (
                                                            <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                                {t("mfaUnknown")}
                                                            </span>
                                                        ) : u.mfaEnabled ? (
                                                            <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                                                {t("mfaActive")}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                                {t("mfaPending")}
                                                            </span>
                                                        )}
                                                    </td>
                                                )}
                                                {cols.isVisible("lastLogin") && <td className={TD}>{formatLastLogin(u.lastLoginAt, t("never"))}</td>}
                                                {cols.isVisible("actions") && (
                                                    <td className={TD}>
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <button
                                                                onClick={() => setDrawerUser(u)}
                                                                className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                            >
                                                                <IconAdjustments size={16} stroke={1.5} className="inline mr-1 text-[#0078D4]" />
                                                                {t("granularPermissionsShort")}
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(u)}
                                                                className="text-xs font-semibold rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 hover:text-rose-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                            >
                                                                <IconTrash size={16} stroke={1.5} className="inline mr-1" />
                                                                {t("revokeAccess")}
                                                            </button>
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-3">
                            <Pagination {...pg} pageSizes={[15, 30, 45, 60]} />
                        </div>
                    </>
                )}
            </div>

            <EntraSyncModal
                open={showEntraModal}
                loading={entraLoading}
                users={entraUsers}
                groups={entraGroups}
                selection={selection}
                setSelection={setSelection}
                provisioning={provisioning}
                canAssignOwner={canAssignOwner}
                isMasterTenant={isMasterTenant}
                onClose={() => setShowEntraModal(false)}
                onProvisionUsers={provisionUsers}
                onProvisionGroup={provisionGroup}
                onSearchGroups={searchGroups}
            />

            {drawerUser && (
                <UserPermissionsDrawer
                    user={drawerUser}
                    availableSubscriptions={availableSubscriptions}
                    onClose={() => setDrawerUser(null)}
                    onSave={(modules, subs) => savePermissions(drawerUser, modules, subs)}
                />
            )}
        </div>
    );
}
