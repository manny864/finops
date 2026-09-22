"use client";

import { useTranslations, useLocale } from "next-intl";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";

/**
 * MEJ-20 — historial del PR Cost Estimator.
 *
 * Lo que esta pantalla tiene que responder de un vistazo: cuánto gasto se detectó
 * ANTES de provisionarlo. Ese es el argumento de Shift-Left; el resto es detalle.
 */

interface Estimacion {
    id: number;
    repository: string;
    pr_number: number | null;
    author: string | null;
    current_monthly_cost_usd: string | number;
    projected_monthly_cost_usd: string | number;
    delta_cost_usd: string | number;
    resources_priced: number;
    resources_unpriced: number;
    gate_status: "NOT_EVALUATED" | "OK" | "EXCEEDED";
    created_at: string;
}

function buildFetcher(instance: any, accounts: any[], isMock: boolean) {
    return async (url: string) => {
        const headers: Record<string, string> = {};
        if (!isMock) {
            const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    };
}

const usd = (v: unknown, locale: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
        .format(Number(v) || 0);

export default function ShiftLeftGovernanceBoard() {
    const t = useTranslations("ShiftLeft");
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);

    const { data, error, isLoading } = useSWR(
        tenantId ? `/api/governance/shift-left?tenantId=${encodeURIComponent(tenantId)}${esMock ? "&mock=true" : ""}` : null,
        buildFetcher(instance, accounts, esMock),
        { revalidateOnFocus: false }
    );

    const items: Estimacion[] = data?.items || [];
    const kpis = data?.kpis;

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
                {t("loadError")}: {errorMessage(error)}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <header>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                    {t("title")}
                    <InfoTooltip content={t("help")} />
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </header>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi etiqueta={t("kpiAnalyzed")} valor={kpis ? String(kpis.analizados) : "—"} />
                <Kpi etiqueta={t("kpiIncrease")} valor={kpis ? usd(kpis.aumentoDetectado, locale) : "—"} tono="alza" />
                <Kpi etiqueta={t("kpiSavings")} valor={kpis ? usd(kpis.ahorroDetectado, locale) : "—"} tono="baja" />
                <Kpi etiqueta={t("kpiBlocked")} valor={kpis ? String(kpis.bloqueados) : "—"} />
            </div>

            {isLoading ? (
                <p className="text-sm text-slate-500 py-8 text-center">{t("loading")}</p>
            ) : items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                    <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">{t("emptyTitle")}</p>
                    {/* Un vacío sin instrucción se lee como una pantalla rota. */}
                    <p className="text-xs text-slate-500 mt-2 max-w-xl mx-auto">{t("emptyHint")}</p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/60 text-left">
                            <tr>
                                <th className="px-3 py-2 font-medium">{t("colRepo")}</th>
                                <th className="px-3 py-2 font-medium">{t("colAuthor")}</th>
                                <th className="px-3 py-2 font-medium text-right">{t("colBefore")}</th>
                                <th className="px-3 py-2 font-medium text-right">{t("colAfter")}</th>
                                <th className="px-3 py-2 font-medium text-right">{t("colDelta")}</th>
                                <th className="px-3 py-2 font-medium">{t("colGate")}</th>
                                <th className="px-3 py-2 font-medium">{t("colDate")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((e) => {
                                const delta = Number(e.delta_cost_usd) || 0;
                                return (
                                    <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                                        <td className="px-3 py-2">
                                            <span className="font-mono text-xs">{e.repository}</span>
                                            {e.pr_number ? <span className="text-slate-400 text-xs ml-1">#{e.pr_number}</span> : null}
                                        </td>
                                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{e.author || "—"}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{usd(e.current_monthly_cost_usd, locale)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{usd(e.projected_monthly_cost_usd, locale)}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${delta > 0 ? "text-red-600 dark:text-red-400" : delta < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                                            {delta > 0 ? "+" : ""}{usd(delta, locale)}
                                            {/* Sin esto, un delta al que le faltan recursos se lee
                                                como si fuera el total. Es un piso, no el número. */}
                                            {e.resources_unpriced > 0 ? (
                                                <InfoTooltip content={t("unpricedWarning", { n: e.resources_unpriced })} />
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2"><Gate estado={e.gate_status} t={t} /></td>
                                        <td className="px-3 py-2 text-slate-500 text-xs">
                                            {new Date(e.created_at).toLocaleString(locale)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Kpi({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: "alza" | "baja" }) {
    const color = tono === "alza" ? "text-red-600 dark:text-red-400"
        : tono === "baja" ? "text-emerald-600 dark:text-emerald-400" : "";
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{etiqueta}</p>
            <p className={`text-lg font-semibold mt-1 tabular-nums ${color}`}>{valor}</p>
        </div>
    );
}

function Gate({ estado, t }: { estado: Estimacion["gate_status"]; t: (k: string) => string }) {
    if (estado === "EXCEEDED") {
        return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">{t("gateExceeded")}</span>;
    }
    if (estado === "OK") {
        return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t("gateOk")}</span>;
    }
    return <span className="text-xs text-slate-400">{t("gateNotEvaluated")}</span>;
}
