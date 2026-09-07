"use client";
import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { IconLoader2, IconSearch, IconUserPlus, IconUsersGroup, IconX } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import type { EntraGroupSearchResult, TenantUserRole } from "@/types/tenantUsers.types";

/**
 * Modal de sincronización con Entra ID, en dos modos.
 *
 *  - `users`: el listado completo del directorio con selección múltiple y rol
 *    por usuario. Es el flujo que ya existía y se preserva.
 *  - `groups`: elige un grupo de seguridad y aprovisiona a sus miembros con un
 *    rol común. Escala mucho mejor para un directorio grande.
 *
 * El rol Owner no se ofrece en el modo grupo: la transferencia de propiedad es
 * individual y la ruta la rechaza igual si llegara por acá.
 */

export interface EntraDirectoryUser {
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
}

const GROUP_ROLES: TenantUserRole[] = ["READER", "CONTRIBUTOR", "ADMIN"];

export default function EntraSyncModal({
    open,
    loading,
    users,
    groups,
    selection,
    setSelection,
    provisioning,
    canAssignOwner,
    isMasterTenant,
    onClose,
    onProvisionUsers,
    onProvisionGroup,
    onSearchGroups,
}: {
    open: boolean;
    loading: boolean;
    users: EntraDirectoryUser[];
    groups: EntraGroupSearchResult[];
    selection: Record<string, { selected: boolean; role: string; user: EntraDirectoryUser }>;
    setSelection: React.Dispatch<React.SetStateAction<Record<string, { selected: boolean; role: string; user: EntraDirectoryUser }>>>;
    provisioning: boolean;
    canAssignOwner: boolean;
    isMasterTenant: boolean;
    onClose: () => void;
    onProvisionUsers: () => Promise<void>;
    onProvisionGroup: (groupId: string, role: TenantUserRole) => Promise<void>;
    onSearchGroups: (q: string) => Promise<void>;
}) {
    const t = useTranslations("AdminUsers");
    const [mode, setMode] = useState<"users" | "groups">("users");
    const [filter, setFilter] = useState("");
    const [groupQuery, setGroupQuery] = useState("");
    const [selectedGroup, setSelectedGroup] = useState("");
    const [groupRole, setGroupRole] = useState<TenantUserRole>("READER");

    const filteredUsers = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return users;
        return users.filter(
            (u) =>
                (u.displayName || "").toLowerCase().includes(q) ||
                (u.mail || "").toLowerCase().includes(q) ||
                (u.userPrincipalName || "").toLowerCase().includes(q)
        );
    }, [users, filter]);

    const selectedCount = Object.values(selection).filter((s) => s.selected).length;

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => !provisioning && onClose()}>
            <div
                className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[92vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 shrink-0">
                    <div>
                        <h2 className="font-heading font-bold text-[17px] text-slate-900 dark:text-white flex items-center">
                            <IconUsersGroup size={20} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                            {t("entraSyncTitle")}
                            <InfoTooltip content={t("entraSyncHelp")} />
                        </h2>
                        <div className="flex items-center gap-1 mt-3">
                            <button
                                onClick={() => setMode("users")}
                                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white dark:bg-slate-900 cursor-pointer ${mode === "users" ? "border-[#0078D4] text-[#0078D4]" : "border-slate-300 dark:border-slate-700 text-slate-500"
                                    }`}
                            >
                                {t("entraModeUsers")}
                            </button>
                            <button
                                onClick={() => {
                                    setMode("groups");
                                    if (groups.length === 0) onSearchGroups("");
                                }}
                                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white dark:bg-slate-900 cursor-pointer ${mode === "groups" ? "border-[#00AEEF] text-[#00AEEF]" : "border-slate-300 dark:border-slate-700 text-slate-500"
                                    }`}
                            >
                                {t("entraModeGroups")}
                            </button>
                        </div>
                    </div>
                    <button onClick={() => !provisioning && onClose()} aria-label={t("close")} className="cursor-pointer shrink-0">
                        <IconX size={20} stroke={1.5} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {loading ? (
                        <div className="flex items-center gap-2 text-slate-500 text-[13px]">
                            <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                        </div>
                    ) : mode === "users" ? (
                        <>
                            <div className="relative mb-3 max-w-sm">
                                <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value)}
                                    placeholder={t("filterDirectory")}
                                    className="w-full pl-8 pr-3 py-1.5 text-[12.5px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                                />
                            </div>
                            {filteredUsers.length === 0 ? (
                                <p className="text-[13px] text-slate-500">{t("noDirectoryUsers")}</p>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    {filteredUsers.map((u) => {
                                        const entry = selection[u.id];
                                        return (
                                            <div
                                                key={u.id}
                                                className="flex items-center gap-3 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(entry?.selected)}
                                                    onChange={() =>
                                                        setSelection((prev) => ({
                                                            ...prev,
                                                            [u.id]: {
                                                                selected: !prev[u.id]?.selected,
                                                                role: prev[u.id]?.role || "Reader",
                                                                user: u,
                                                            },
                                                        }))
                                                    }
                                                    className="accent-[#0054A6] cursor-pointer"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">
                                                        {u.displayName || u.userPrincipalName}
                                                    </div>
                                                    <div className="text-[11.5px] text-slate-500 truncate">{u.mail || u.userPrincipalName}</div>
                                                </div>
                                                <select
                                                    value={entry?.role || "Reader"}
                                                    onChange={(e) =>
                                                        setSelection((prev) => ({
                                                            ...prev,
                                                            [u.id]: { selected: prev[u.id]?.selected ?? false, role: e.target.value, user: u },
                                                        }))
                                                    }
                                                    className="text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 px-2 py-1.5 cursor-pointer"
                                                >
                                                    <option value="Reader">{t("roleReader")}</option>
                                                    <option value="Colaborador">{t("roleCollaborator")}</option>
                                                    <option value="Admin">{t("roleAdmin")}</option>
                                                    <option value="Owner" disabled={!canAssignOwner}>
                                                        {t("roleOwner")}
                                                    </option>
                                                    {isMasterTenant && <option value="SuperAdmin">{t("roleSuperAdmin")}</option>}
                                                </select>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 mb-3">
                                <div className="relative flex-1 max-w-sm">
                                    <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={groupQuery}
                                        onChange={(e) => setGroupQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && onSearchGroups(groupQuery)}
                                        placeholder={t("searchGroups")}
                                        className="w-full pl-8 pr-3 py-1.5 text-[12.5px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                                    />
                                </div>
                                <button
                                    onClick={() => onSearchGroups(groupQuery)}
                                    className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] dark:text-blue-400 bg-white dark:bg-slate-900 px-3 py-1.5 cursor-pointer"
                                >
                                    {t("search")}
                                </button>
                            </div>

                            <div className="text-[12px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mb-3">
                                {t("groupSyncNote")}
                            </div>

                            {groups.length === 0 ? (
                                <p className="text-[13px] text-slate-500">{t("noGroups")}</p>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    {groups.map((g) => (
                                        <label
                                            key={g.id}
                                            className="flex items-center gap-3 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                        >
                                            <input
                                                type="radio"
                                                name="entra-group"
                                                checked={selectedGroup === g.id}
                                                onChange={() => setSelectedGroup(g.id)}
                                                className="accent-[#0054A6] cursor-pointer"
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[13px] font-semibold text-slate-900 dark:text-white truncate">
                                                    {g.displayName}
                                                </span>
                                                {g.description && <span className="block text-[11.5px] text-slate-500 truncate">{g.description}</span>}
                                            </span>
                                            {typeof g.memberCount === "number" && (
                                                <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800">
                                                    {t("membersCount", { count: g.memberCount })}
                                                </span>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            )}

                            <div className="mt-4">
                                <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("groupDefaultRole")}</label>
                                <select
                                    value={groupRole}
                                    onChange={(e) => setGroupRole(e.target.value as TenantUserRole)}
                                    className="w-full max-w-xs mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] cursor-pointer"
                                >
                                    {GROUP_ROLES.map((r) => (
                                        <option key={r} value={r}>
                                            {t(`roleOption_${r}` as never)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}
                </div>

                <div className="p-5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
                    <span className="text-[12px] text-slate-500">
                        {mode === "users" ? t("selectedCount", { count: selectedCount }) : ""}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            disabled={provisioning}
                            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold text-[13px] cursor-pointer disabled:opacity-50"
                        >
                            {t("cancel")}
                        </button>
                        <button
                            onClick={() => (mode === "users" ? onProvisionUsers() : onProvisionGroup(selectedGroup, groupRole))}
                            disabled={provisioning || (mode === "users" ? selectedCount === 0 : !selectedGroup)}
                            className="bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold px-5 py-2 rounded-lg text-[13px] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {provisioning ? <IconLoader2 size={16} className="animate-spin" /> : <IconUserPlus size={16} stroke={1.5} />}
                            {provisioning ? t("provisioning") : t("provision")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
