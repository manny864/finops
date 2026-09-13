"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import { useMfaChallenge } from "@/hooks/useMfaChallenge";
import { IconLoader2, IconArrowsExchange, IconX } from "@tabler/icons-react";

/**
 * Cambio de plan de un tenant que YA tiene suscripción en Paddle.
 *
 * Las dos rutas existían desde antes y nadie las llamaba: el botón "Modificar
 * Suscripción" abría un modal que no existía. Este es ese modal.
 *
 * Por qué no manda al checkout: abrir un checkout nuevo crearía una SEGUNDA
 * suscripción en Paddle. La capacidad comprada (slots de tenant y de
 * suscripción) se fija desde los ítems de la principal, así que la próxima
 * actualización de esa la pondría en cero. El cambio se hace modificando la
 * suscripción que ya existe.
 *
 * El prorrateo lo calcula Paddle, no nosotros: el preview es el mismo PATCH
 * pero contra `/preview`, así que el número que ve el usuario es exactamente el
 * que se le va a cobrar.
 */

type Tier = "Professional" | "Business";
type Billing = "monthly" | "yearly";

interface PreviewData {
    previewAvailable: boolean;
    currencyCode?: string;
    result?: { action: "charge" | "credit" | "none"; amount: string };
    immediateTotal?: string | null;
    nextBillTotal?: string | null;
    nextBillDate?: string | null;
    recurringTotal?: string | null;
}

/**
 * Paddle manda los montos en la denominación MÍNIMA de la divisa. Los decimales
 * salen de la propia divisa (USD 2, JPY 0) en vez de una lista a mano: dividir
 * siempre por 100 sería un error de 100× el día que haya un precio en yenes.
 */
export function montoLegible(minimos: string | null | undefined, moneda: string, locale: string): string | null {
    if (minimos === null || minimos === undefined || minimos === "") return null;
    const n = Number(minimos);
    if (!Number.isFinite(n)) return null;
    const fmt = new Intl.NumberFormat(locale, { style: "currency", currency: moneda });
    const decimales = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(Math.abs(n) / 10 ** decimales);
}

export default function ChangePlanModal({
    open,
    onClose,
    tenantId,
    currentTier,
    currentBillingCycle,
    onChanged,
}: {
    open: boolean;
    onClose: () => void;
    tenantId: string;
    currentTier: string;
    currentBillingCycle: "MONTHLY" | "ANNUAL";
    onChanged: () => void;
}) {
    const t = useTranslations("AdminBilling");
    const { instance, accounts } = useMsal();
    const { requestChallenge, mfaModal } = useMfaChallenge();

    const [mounted, setMounted] = useState(false);
    const [tier, setTier] = useState<Tier>(currentTier === "Business" ? "Professional" : "Business");
    const [billing, setBilling] = useState<Billing>(currentBillingCycle === "ANNUAL" ? "yearly" : "monthly");
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [applying, setApplying] = useState(false);

    useEffect(() => setMounted(true), []);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }, [instance, accounts]);

    // El preview se pide con cada cambio de tier o ciclo: es lo que el cliente
    // va a pagar, y cambia con las dos cosas.
    useEffect(() => {
        if (!open || !tenantId) return;
        let cancelado = false;

        (async () => {
            setLoadingPreview(true);
            setPreview(null);
            try {
                const res = await fetch(`/api/billing/subscription/preview?tenantId=${encodeURIComponent(tenantId)}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
                    body: JSON.stringify({ newTier: tier, billing, prorationBillingMode: "prorated_immediately" }),
                });
                const json = await res.json();
                if (cancelado) return;
                if (!res.ok) throw new Error(json.error || t("previewFailed"));
                setPreview(json);
            } catch (e) {
                if (!cancelado) {
                    // Sin preview igual se puede aplicar: Paddle prorratea con su
                    // regla estándar. Lo que no se puede es prometer un número.
                    setPreview({ previewAvailable: false });
                    toast.error(errorMessage(e));
                }
            } finally {
                if (!cancelado) setLoadingPreview(false);
            }
        })();

        return () => { cancelado = true; };
    }, [open, tenantId, tier, billing, authHeaders, t]);

    const aplicar = async () => {
        const { challengeId, cancelled } = await requestChallenge("change_plan", { tenantId });
        if (cancelled) return;

        setApplying(true);
        try {
            const res = await fetch(`/api/billing/subscription?tenantId=${encodeURIComponent(tenantId)}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...(await authHeaders()),
                    ...(challengeId ? { "X-MFA-Challenge-Id": challengeId } : {}),
                },
                body: JSON.stringify({ newTier: tier, billing, prorationBillingMode: "prorated_immediately" }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || t("changeFailed"));

            // El tier de la base lo escribe el webhook de Paddle, que es la única
            // fuente: puede tardar unos segundos en llegar.
            toast.success(t("changeApplied", { tier }));
            onChanged();
            onClose();
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setApplying(false);
        }
    };

    if (!open || !mounted) return null;

    const moneda = preview?.currencyCode || "USD";
    const locale = typeof navigator !== "undefined" ? navigator.language : "es";
    const accion = preview?.result?.action;
    const monto = montoLegible(preview?.result?.amount, moneda, locale);
    const proxima = montoLegible(preview?.nextBillTotal, moneda, locale);
    const recurrente = montoLegible(preview?.recurringTotal, moneda, locale);
    const mismoPlan = tier === currentTier && (billing === "yearly") === (currentBillingCycle === "ANNUAL");

    const contenido = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !applying && onClose()} aria-hidden="true" />

            <div
                className="relative z-10 w-full max-w-lg my-8 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <IconArrowsExchange className="w-5 h-5 text-[#0078D4]" />
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">{t("changePlanTitle")}</h3>
                    </div>
                    <button type="button" onClick={onClose} disabled={applying} className="text-slate-400 hover:text-slate-600 disabled:opacity-50">
                        <IconX className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                    <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("changePlanTarget")}</span>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            {(["Professional", "Business"] as Tier[]).map((opcion) => (
                                <button
                                    key={opcion}
                                    type="button"
                                    onClick={() => setTier(opcion)}
                                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                                        tier === opcion
                                            ? "border-[#0078D4] bg-[#0078D4]/10 text-[#0078D4]"
                                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300"
                                    }`}
                                >
                                    {opcion}
                                    {opcion === currentTier && (
                                        <span className="block text-[10px] font-normal opacity-70">{t("changePlanCurrent")}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("changePlanCycle")}</span>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            {(["monthly", "yearly"] as Billing[]).map((opcion) => (
                                <button
                                    key={opcion}
                                    type="button"
                                    onClick={() => setBilling(opcion)}
                                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                                        billing === opcion
                                            ? "border-[#0078D4] bg-[#0078D4]/10 text-[#0078D4]"
                                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300"
                                    }`}
                                >
                                    {opcion === "monthly" ? t("changePlanMonthly") : t("changePlanYearly")}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-sm">
                        {loadingPreview ? (
                            <span className="flex items-center gap-2 text-slate-500">
                                <IconLoader2 className="w-4 h-4 animate-spin" />
                                {t("previewLoading")}
                            </span>
                        ) : preview?.previewAvailable === false ? (
                            <span className="text-slate-600 dark:text-slate-300">{t("previewUnavailable")}</span>
                        ) : (
                            <div className="space-y-1.5 text-slate-700 dark:text-slate-300">
                                {accion === "charge" && monto && (
                                    <p className="font-semibold text-[#1B2A41] dark:text-white">{t("previewCharge", { amount: monto })}</p>
                                )}
                                {accion === "credit" && monto && (
                                    <p className="font-semibold text-emerald-600">{t("previewCredit", { amount: monto })}</p>
                                )}
                                {accion === "none" && <p>{t("previewNoCharge")}</p>}
                                {recurrente && <p className="text-xs">{t("previewRecurring", { amount: recurrente })}</p>}
                                {proxima && preview?.nextBillDate && (
                                    <p className="text-xs">
                                        {t("previewNextBill", {
                                            amount: proxima,
                                            date: new Date(preview.nextBillDate).toLocaleDateString(locale),
                                        })}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <p className="text-[11px] text-slate-500 leading-relaxed">{t("changePlanEnterpriseHint")}</p>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={applying}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                        {t("cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={aplicar}
                        disabled={applying || loadingPreview || mismoPlan}
                        className="inline-flex items-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-4 py-2 rounded-lg text-xs font-semibold shadow-sm disabled:opacity-50"
                    >
                        {applying && <IconLoader2 className="w-3.5 h-3.5 animate-spin" />}
                        {mismoPlan ? t("changePlanSamePlan") : t("changePlanConfirm")}
                    </button>
                </div>
            </div>

            {mfaModal}
        </div>
    );

    return createPortal(contenido, document.body);
}
