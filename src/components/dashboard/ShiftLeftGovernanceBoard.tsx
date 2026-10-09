"use client";

import { useTranslations, useLocale } from "next-intl";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import { construirCsv, type FilaEstimacion } from "@/lib/shiftLeftBoard";
import { authHeaders, buildFetcher, usd, type CentroDeCostos, type Gate, type T } from "./shiftLeft/common";
import EstimationTable from "./shiftLeft/EstimationTable";
import GatesEditor from "./shiftLeft/GatesEditor";
import PricingEditor from "./shiftLeft/PricingEditor";
import SetupPanel from "./shiftLeft/SetupPanel";
import TrendChart from "./shiftLeft/TrendChart";

/**
 * MEJ-20 — historial del PR Cost Estimator.
 *
 * Lo que esta pantalla tiene que responder de un vistazo: cuánto gasto se detectó
 * ANTES de provisionarlo. Ese es el argumento de Shift-Left; el resto es detalle, y por eso el
 * desglose por recurso vive en cada fila y no en el listado.
 */
export default function ShiftLeftGovernanceBoard() {
    const t = useTranslations("ShiftLeft") as unknown as T;
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);
    const fetcher = buildFetcher(instance, accounts, esMock);

    const { data, error, isLoading, mutate } = useSWR(
        tenantId ? `/api/governance/shift-left?tenantId=${encodeURIComponent(tenantId)}${esMock ? "&mock=true" : ""}` : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const items: FilaEstimacion[] = data?.items || [];
    const kpis = data?.kpis;
    const gates: Gate[] = data?.gates || [];
    const centros: CentroDeCostos[] = data?.costCenters || [];
    const descuento = Number(data?.pricing?.discount_pct) || 0;
    const headers = () => authHeaders(instance, accounts, esMock);

    function exportarCsv() {
        const blob = new Blob([construirCsv(items)], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `shift-left-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
                {t("loadError")}: {errorMessage(error)}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        {t("title")}
                        <InfoTooltip content={t("help")} />
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
                </div>
                <button
                    type="button"
                    onClick={exportarCsv}
                    disabled={items.length === 0}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-40"
                >
                    {t("exportCsv")}
                </button>
            </header>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi etiqueta={t("kpiAnalyzed")} valor={kpis ? String(kpis.analizados) : "—"} />
                <Kpi etiqueta={t("kpiIncrease")} valor={kpis ? usd(kpis.aumentoDetectado, locale) : "—"} tono="alza" />
                <Kpi etiqueta={t("kpiSavings")} valor={kpis ? usd(kpis.ahorroDetectado, locale) : "—"} tono="baja" />
                <Kpi etiqueta={t("kpiBlocked")} valor={kpis ? String(kpis.bloqueados) : "—"} />
            </div>

            {/* Sin estimaciones, lo primero que hace falta es conectar un pipeline: abierto por defecto. */}
            {tenantId && !isLoading ? (
                <SetupPanel tenantId={tenantId} esMock={esMock} locale={locale} t={t} fetcher={fetcher} abiertoInicial={items.length === 0} />
            ) : null}

            <div className="grid gap-5 lg:grid-cols-2">
                <GatesEditor gates={gates} centros={centros} tenantId={tenantId} esMock={esMock} locale={locale} t={t} onChange={() => mutate()} headers={headers} />
                <PricingEditor descuento={descuento} tenantId={tenantId} esMock={esMock} t={t} onChange={() => mutate()} headers={headers} />
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
                <>
                    <TrendChart items={items} gates={gates} locale={locale} t={t} />
                    <EstimationTable items={items} tenantId={tenantId} esMock={esMock} locale={locale} t={t} fetcher={fetcher} />
                </>
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
