"use client";
import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
    IconAdjustments,
    IconTrash,
    IconChartPie,
    IconEye,
    IconLoader2,
    IconLock,
    IconSettings,
    IconShieldLock,
    IconX,
} from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import type { SaaSModuleKey, TenantUserItem } from "@/types/tenantUsers.types";
import { ALL_MODULES } from "@/types/tenantUsers.types";

/**
 * Drawer de permisos granulares por módulo y alcance de suscripciones.
 *
 * Cada toggle representa un grupo de páginas del SaaS. Al guardar, la ruta
 * traduce los módulos a `RoleTag` y los escribe en `Users.permissions`, que es
 * lo que efectivamente filtra el Sidebar y `RouteTierGate`: las casillas de acá
 * cambian lo que el usuario ve de verdad, no una preferencia decorativa.
 */

const MODULE_ICON: Record<SaaSModuleKey, React.ComponentType<{ size?: number; className?: string; stroke?: number }>> = {
    VISIBILITY: IconEye,
    FINOPS_ANALYTICS: IconChartPie,
    CLOUD_CLEANUP: IconTrash,
    GOVERNANCE: IconShieldLock,
    SECURITY: IconLock,
    ADMINISTRATION: IconSettings,
};

export default function UserPermissionsDrawer({
    user,
    availableSubscriptions,
    onClose,
    onSave,
}: {
    user: TenantUserItem;
    /** Suscripciones del tenant. Vacío = no se pudo enumerar; el selector se oculta. */
    availableSubscriptions: { id: string; name: string }[];
    onClose: () => void;
    onSave: (modules: SaaSModuleKey[], subscriptionIds: string[]) => Promise<void>;
}) {
    const t = useTranslations("AdminUsers");
    const [modules, setModules] = useState<SaaSModuleKey[]>(user.allowedModules);
    const [subs, setSubs] = useState<string[]>(user.allowedSubscriptionIds || []);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        function onEsc(e: KeyboardEvent) {
            if (e.key === "Escape" && !saving) onClose();
        }
        document.addEventListener("keydown", onEsc);
        return () => document.removeEventListener("keydown", onEsc);
    }, [onClose, saving]);

    const toggle = (m: SaaSModuleKey) =>
        setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

    const save = async () => {
        setSaving(true);
        try {
            await onSave(modules, subs);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={() => !saving && onClose()} />
            <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-50 flex flex-col h-full shadow-2xl">
                <div className="p-5 border-b border-slate-200 dark:border-slate-800 shrink-0 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="font-heading font-bold text-[16px] text-slate-900 dark:text-white flex items-center">
                            <IconAdjustments size={20} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                            {t("granularPermissions")}
                            <InfoTooltip content={t("granularPermissionsHelp")} />
                        </h2>
                        <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1 truncate" title={user.email}>
                            {user.displayName} · {user.email}
                        </p>
                    </div>
                    <button onClick={() => !saving && onClose()} aria-label={t("close")} className="cursor-pointer shrink-0">
                        <IconX size={20} stroke={1.5} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                    {user.isSuperAdmin && (
                        <div className="text-[12px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                            {t("superAdminScopeNote")}
                        </div>
                    )}

                    <div>
                        <h3 className="text-[13px] font-bold text-slate-900 dark:text-white mb-2 flex items-center">
                            {t("moduleAccess")}
                            <InfoTooltip content={t("moduleAccessHelp")} />
                        </h3>
                        <div className="flex flex-col gap-2">
                            {ALL_MODULES.map((m) => {
                                const Icon = MODULE_ICON[m];
                                const on = modules.includes(m);
                                return (
                                    <label
                                        key={m}
                                        className="flex items-start gap-3 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={() => toggle(m)}
                                            className="mt-0.5 accent-[#0054A6] cursor-pointer"
                                        />
                                        <span className="min-w-0">
                                            <span className="text-[13px] font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                                <Icon size={16} stroke={1.5} className="text-[#0078D4]" />
                                                {t(`module_${m}` as never)}
                                            </span>
                                            <span className="block text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                {t(`module_${m}_desc` as never)}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {availableSubscriptions.length > 0 && (
                        <div>
                            <h3 className="text-[13px] font-bold text-slate-900 dark:text-white mb-2 flex items-center">
                                {t("allowedSubscriptions")}
                                <InfoTooltip content={t("allowedSubscriptionsHelp")} />
                            </h3>
                            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mb-2">{t("allowedSubscriptionsEmptyMeansAll")}</p>
                            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                                {availableSubscriptions.map((s) => (
                                    <label
                                        key={s.id}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={subs.includes(s.id)}
                                            onChange={() =>
                                                setSubs((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                                            }
                                            className="accent-[#0054A6] cursor-pointer"
                                        />
                                        <span className="truncate" title={s.name}>
                                            {s.name}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-5 border-t border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold text-[13px] cursor-pointer disabled:opacity-50"
                    >
                        {t("cancel")}
                    </button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold px-5 py-2 rounded-lg text-[13px] flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                        {saving && <IconLoader2 size={16} className="animate-spin" />}
                        {t("savePermissions")}
                    </button>
                </div>
            </div>
        </>
    );
}
