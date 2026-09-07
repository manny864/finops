"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { useMsal } from "@azure/msal-react";
import {
    IconBuilding,
    IconCheck,
    IconCrown,
    IconLayersLinked,
    IconLoader2,
    IconPlus,
    IconShieldCheck,
    IconUsers,
    IconX,
    IconAlertCircle,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { normalizeTier, SUBSCRIPTION_LIMITS, USER_LIMITS } from "@/lib/tierLogic";

interface AddContractTenantModalProps {
    parentTenantId: string;
    parentTenantName: string;
    currentTier: string;
    isOpen: boolean;
    onClose: () => void;
    onTenantAdded?: (newTenantId: string) => void;
}

export default function AddContractTenantModal({
    parentTenantId,
    parentTenantName,
    currentTier,
    isOpen,
    onClose,
    onTenantAdded,
}: AddContractTenantModalProps) {
    const t = useTranslations("AdminContractTenant");
    const [mounted, setMounted] = useState(false);
    const [newEntraId, setNewEntraId] = useState("");
    const [organizationName, setOrganizationName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { instance, accounts } = useMsal();
    const { tenants } = useTenant();

    useEffect(() => {
        setMounted(true);
    }, []);

    const tier = normalizeTier(currentTier) || "Professional";
    const subLimit = SUBSCRIPTION_LIMITS[tier] ?? 2;
    const userLimit = USER_LIMITS[tier] ?? 3;
    const subLimitText = Number.isFinite(subLimit) ? `${subLimit} suscripciones Azure` : "Suscripciones ilimitadas";
    const userLimitText = Number.isFinite(userLimit) ? `Hasta ${userLimit} usuarios` : "Usuarios ilimitados";

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isValidGuid = uuidRegex.test(newEntraId.trim());
    const isFormValid = isValidGuid && organizationName.trim().length >= 2;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isFormValid || isSubmitting || accounts.length === 0) return;

        setIsSubmitting(true);
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/admin/tenants/contract-tenant", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    parentTenantId,
                    newTenantId: newEntraId.trim(),
                    organizationName: organizationName.trim(),
                }),
            });

            const json = await res.json();

            if (res.ok) {
                toast.success(json.message || "Tenant agregado exitosamente al contrato.");
                setNewEntraId("");
                setOrganizationName("");
                onClose();
                if (onTenantAdded) {
                    onTenantAdded(json.tenant?.id || newEntraId.trim());
                }
            } else {
                toast.error(json.error || "No se pudo agregar el tenant al contrato.");
            }
        } catch (err: any) {
            console.error("Error al vincular tenant al contrato:", err);
            toast.error(t("connectionError"));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen || !mounted) return null;

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                onClick={() => !isSubmitting && onClose()}
                aria-hidden="true"
            />

            {/* Modal Box */}
            <div
                className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800 z-10 my-8"
                role="dialog"
                aria-modal="true"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-blue-100 dark:bg-blue-950/60 text-[#0078D4] rounded-xl">
                            <IconBuilding size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold font-['Montserrat',sans-serif] text-slate-900 dark:text-white">
                                {t("title")}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Contrato titular: <span className="font-semibold text-slate-700 dark:text-slate-200">{parentTenantName}</span>
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"
                    >
                        <IconX size={18} />
                    </button>
                </div>

                {/* Body Form */}
                <form onSubmit={handleSubmit}>
                    <div className="p-6 space-y-4 text-left">
                        {/* Banner de Capacidad Heredada */}
                        <div className="p-4 bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-slate-800/60 border border-blue-200 dark:border-blue-800 rounded-xl space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1 text-xs font-extrabold text-[#0078D4] dark:text-blue-400 uppercase tracking-wider">
                                    <IconCrown size={14} />
                                    Capacidad Heredada del Plan {tier}
                                </span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                                    Mismo Contrato
                                </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                                {t("capacityNote")}
                            </p>
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white/80 dark:bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-blue-100 dark:border-slate-700">
                                    <IconLayersLinked size={15} className="text-[#0078D4] shrink-0" />
                                    <span>{subLimitText}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white/80 dark:bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-blue-100 dark:border-slate-700">
                                    <IconUsers size={15} className="text-emerald-600 shrink-0" />
                                    <span>{userLimitText}</span>
                                </div>
                            </div>
                        </div>

                        {/* Entra Tenant ID */}
                        <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                Microsoft Entra Tenant ID (GUID) <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={newEntraId}
                                onChange={(e) => setNewEntraId(e.target.value)}
                                placeholder="00000000-0000-0000-0000-000000000000"
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                            />
                            {newEntraId.trim() && !isValidGuid && (
                                <p className="text-[11px] text-rose-500 flex items-center gap-1 mt-0.5">
                                    <IconAlertCircle size={12} />
                                    {t("invalidGuid")}
                                </p>
                            )}
                        </div>

                        {/* Nombre de la Empresa / Entorno */}
                        <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                {t("companyLabel")} <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={organizationName}
                                onChange={(e) => setOrganizationName(e.target.value)}
                                placeholder={t("companyPlaceholder")}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                            />
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 text-[11.5px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
                            <IconShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                            <span>
                                {t("adminNote")}
                            </span>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={!isFormValid || isSubmitting}
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0078D4] hover:bg-[#0060AA] text-white rounded-xl text-xs font-bold shadow-sm transition-all hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <IconLoader2 size={14} className="animate-spin text-white" />
                            ) : (
                                <IconPlus size={14} className="text-white" />
                            )}
                            <span>{isSubmitting ? "Registrando..." : "Agregar al Contrato"}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
