"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { IconAlertTriangle, IconCircleCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";

interface Cobro {
    transactionId: string;
    amount: string | null;
    currency: string | null;
    status: "completed" | "refund_pending" | "refunded";
    billedAt: string | null;
    addonKey: string | null;
    reembolsable: boolean;
    motivo?: "ya-reembolsado" | "en-proceso" | "fuera-de-ventana" | "no-cobrado";
}

interface Props {
    tenantId: string;
    tenantName?: string;
    onClose: () => void;
}

/**
 * Cobros del tenant y pedido de reembolso total. Lo usan el Admin/Owner (desde Facturación, con ventana) y el SuperAdmin (desde
 * Tenants, sin ventana): el servidor decide cuál es cada uno, acá sólo se muestra lo que contesta `/api/billing/refunds`.
 */
export default function RefundsDialog({ tenantId, tenantName, onClose }: Props) {
    const t = useTranslations("Refunds");
    const locale = useLocale();
    const { instance, accounts } = useMsal();

    const [cobros, setCobros] = useState<Cobro[] | null>(null);
    const [ventanaDias, setVentanaDias] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegido, setElegido] = useState<Cobro | null>(null);
    const [motivo, setMotivo] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [resultado, setResultado] = useState<string | null>(null);

    const headers = useCallback(async (): Promise<Record<string, string>> => {
        if (accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const cargar = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch(`/api/billing/refunds?tenantId=${encodeURIComponent(tenantId)}`, { headers: await headers() });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || t("loadError"));
            setCobros(json.cobros);
            setVentanaDias(json.ventanaDias);
        } catch (e) {
            setError(errorMessage(e));
            setCobros([]);
        }
    }, [tenantId, headers, t]);

    useEffect(() => {
        cargar();
    }, [cargar]);

    const pedir = async () => {
        if (!elegido) return;
        setEnviando(true);
        setError(null);
        try {
            const res = await fetch("/api/billing/refunds", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await headers()) },
                body: JSON.stringify({ tenantId, transactionId: elegido.transactionId, reason: motivo }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || t("requestError"));
            setResultado(t("requested"));
            setElegido(null);
            setMotivo("");
            await cargar();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setEnviando(false);
        }
    };

    const monto = (c: Cobro) => {
        if (c.amount == null) return "—";
        try {
            return new Intl.NumberFormat(locale, { style: "currency", currency: c.currency || "USD" }).format(Number(c.amount));
        } catch {
            return `${c.amount} ${c.currency ?? ""}`.trim();
        }
    };

    const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : "—");

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("title")}>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">{t("title")}</h3>
                        {tenantName && <p className="text-xs text-slate-500 dark:text-slate-400">{tenantName}</p>}
                    </div>
                    <button type="button" onClick={onClose} aria-label={t("close")} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded">
                        <IconX size={18} />
                    </button>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {ventanaDias == null ? t("policySuper") : t("policyAdmin", { days: ventanaDias })}
                </p>
                <div className="flex gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <IconAlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{t("effects")}</span>
                </div>

                {resultado && (
                    <div className="flex gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-900 dark:text-emerald-200" role="status">
                        <IconCircleCheck size={16} className="shrink-0 mt-0.5" />
                        <span>{resultado}</span>
                    </div>
                )}
                {error && (
                    <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-200" role="alert">
                        {error}
                    </div>
                )}

                {cobros === null ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <IconLoader2 size={14} className="animate-spin" /> {t("loading")}
                    </div>
                ) : cobros.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("empty")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 pr-3 font-semibold">{t("colDate")}</th>
                                    <th className="py-2 pr-3 font-semibold">{t("colItem")}</th>
                                    <th className="py-2 pr-3 font-semibold text-right">{t("colAmount")}</th>
                                    <th className="py-2 pr-3 font-semibold">{t("colStatus")}</th>
                                    <th className="py-2 font-semibold" />
                                </tr>
                            </thead>
                            <tbody>
                                {cobros.map((c) => (
                                    <tr key={c.transactionId} className="border-b border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                                        <td className="py-2 pr-3 whitespace-nowrap">{fecha(c.billedAt)}</td>
                                        <td className="py-2 pr-3">{c.addonKey ? t("itemAddon", { key: c.addonKey }) : t("itemPlan")}</td>
                                        <td className="py-2 pr-3 text-right whitespace-nowrap">{monto(c)}</td>
                                        <td className="py-2 pr-3">
                                            {c.reembolsable || !c.motivo ? t(`status.${c.status}`) : t(`motivo.${c.motivo}`, { days: ventanaDias ?? 0 })}
                                        </td>
                                        <td className="py-2 text-right">
                                            {c.reembolsable && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setElegido(c); setResultado(null); setError(null); }}
                                                    className="px-3 py-1 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold"
                                                >
                                                    {t("refund")}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {elegido && (
                    <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                        <p className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100">{t("confirmTitle", { amount: monto(elegido) })}</p>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="refund-reason">{t("reasonLabel")}</label>
                        <textarea
                            id="refund-reason"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            maxLength={500}
                            rows={3}
                            placeholder={t("reasonPlaceholder")}
                            className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 p-2 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        />
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("reasonHint")}</p>
                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => setElegido(null)} disabled={enviando} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                                {t("back")}
                            </button>
                            <button
                                type="button"
                                onClick={pedir}
                                disabled={enviando || motivo.trim().length < 5}
                                className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm disabled:opacity-50"
                            >
                                {enviando && <IconLoader2 size={14} className="animate-spin" />}
                                <span>{t("confirmButton")}</span>
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                        {t("close")}
                    </button>
                </div>
            </div>
        </div>
    );
}
