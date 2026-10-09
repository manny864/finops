"use client";

import React, { useState } from "react";
import useSWR from "swr";
import InfoTooltip from "@/components/InfoTooltip";
import { errorMessage } from "@/lib/apiErrors";
import { claveDeAccion, claveDeMotivo, claveDeNota, type FilaEstimacion } from "@/lib/shiftLeftBoard";
import { numero, usd, type LineaDetalle, type T } from "./common";

function Gate({ fila, t }: { fila: FilaEstimacion; t: T }) {
    const razon = fila.meta?.gate_reason;
    if (fila.gate_status === "EXCEEDED") {
        return (
            <div className="space-y-0.5">
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">{t("gateExceeded")}</span>
                {razon ? <p className="text-[11px] text-slate-500">{razon === "pct" ? t("reasonPct") : t("reasonUsd")}</p> : null}
            </div>
        );
    }
    if (fila.gate_status === "OK") {
        return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t("gateOk")}</span>;
    }
    return <span className="text-xs text-slate-400">{t("gateNotEvaluated")}</span>;
}

/** El desglose por recurso de una estimación: se pide recién cuando se abre la fila. */
function Detalle({
    fila, tenantId, esMock, locale, t, fetcher,
}: {
    fila: FilaEstimacion;
    tenantId: string;
    esMock: boolean;
    locale: string;
    t: T;
    fetcher: (url: string) => Promise<any>;
}) {
    const { data, error, isLoading } = useSWR(
        `/api/governance/shift-left/${fila.id}?tenantId=${encodeURIComponent(tenantId)}${esMock ? "&mock=true" : ""}`,
        fetcher,
        { revalidateOnFocus: false }
    );
    if (isLoading) return <p className="text-xs text-slate-500 p-3">{t("detailLoading")}</p>;
    if (error) return <p className="text-xs text-red-600 dark:text-red-400 p-3">{t("detailError")}: {errorMessage(error)}</p>;

    // Lo más caro primero: es lo que el revisor del PR quiere ver.
    const lineas: LineaDetalle[] = [...(data?.lines ?? [])].sort(
        (a: LineaDetalle, b: LineaDetalle) => Math.abs(b.delta) - Math.abs(a.delta) || a.direccion.localeCompare(b.direccion)
    );
    if (lineas.length === 0) return <p className="text-xs text-slate-500 p-3">{t("detailEmpty")}</p>;

    const meta = data?.item?.meta ?? fila.meta;
    const presupuesto = meta?.budget;

    return (
        <div className="p-3 space-y-2">
            {presupuesto ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                    {t("detailBudget", {
                        center: presupuesto.cost_center,
                        pct: presupuesto.delta_pct_of_budget === null ? "—" : numero(presupuesto.delta_pct_of_budget, locale),
                        remaining: usd(presupuesto.remaining_usd, locale),
                    })}
                </p>
            ) : null}
            {meta?.discount_pct ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                    {t("discountBadge", { pct: numero(meta.discount_pct, locale) })} · {t("detailListDelta")}: {usd(meta.list_delta_cost_usd, locale)}
                </p>
            ) : null}

            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="py-1 pr-3 font-medium">{t("detailColResource")}</th>
                            <th className="py-1 pr-3 font-medium">{t("detailColAction")}</th>
                            <th className="py-1 pr-3 font-medium text-right">{t("detailColBefore")}</th>
                            <th className="py-1 pr-3 font-medium text-right">{t("detailColAfter")}</th>
                            <th className="py-1 font-medium">{t("detailColNotes")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lineas.map((l) => {
                            const detalle = [
                                ...(l.motivo ? [t(claveDeMotivo(l.motivo))] : []),
                                ...(l.notas ?? []).map((n) => t(claveDeNota(n))),
                            ];
                            return (
                                <tr key={l.direccion} className="border-t border-slate-100 dark:border-slate-800 align-top">
                                    <td className="py-1.5 pr-3">
                                        <span className="font-mono break-all">{l.direccion}</span>
                                        {l.componentes && l.componentes.length > 1 ? (
                                            <p className="text-[11px] text-slate-500">
                                                {l.componentes.map((c) => `${c.etiqueta} ×${c.cantidad} ${usd(c.mensual, locale)}`).join(" · ")}
                                            </p>
                                        ) : null}
                                    </td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{t(claveDeAccion(l.accion))}</td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums">{usd(l.mensualAntes, locale)}</td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums">{usd(l.mensualDespues, locale)}</td>
                                    <td className={`py-1.5 ${l.motivo ? "text-amber-600 dark:text-amber-400" : "text-slate-500"}`}>
                                        {detalle.join(" · ")}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function EstimationTable({
    items, tenantId, esMock, locale, t, fetcher,
}: {
    items: FilaEstimacion[];
    tenantId: string;
    esMock: boolean;
    locale: string;
    t: T;
    fetcher: (url: string) => Promise<any>;
}) {
    const [abierta, setAbierta] = useState<number | null>(null);

    return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-left">
                    <tr>
                        <th className="px-2 py-2 w-8" aria-hidden />
                        <th className="px-3 py-2 font-medium">{t("colRepo")}</th>
                        <th className="px-3 py-2 font-medium">{t("colAuthor")}</th>
                        <th className="px-3 py-2 font-medium text-right">{t("colBefore")}</th>
                        <th className="px-3 py-2 font-medium text-right">{t("colAfter")}</th>
                        <th className="px-3 py-2 font-medium text-right">{t("colDelta")}</th>
                        <th className="px-3 py-2 font-medium">{t("colBudget")}</th>
                        <th className="px-3 py-2 font-medium">{t("colGate")}</th>
                        <th className="px-3 py-2 font-medium">{t("colDate")}</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((e) => {
                        const delta = Number(e.delta_cost_usd) || 0;
                        const esta = abierta === e.id;
                        const meta = e.meta;
                        const herramienta = meta?.tool && meta.tool !== "terraform" ? meta.tool : null;
                        return (
                            <React.Fragment key={e.id}>
                                <tr className="border-t border-slate-100 dark:border-slate-800">
                                    <td className="px-2 py-2">
                                        <button
                                            type="button"
                                            onClick={() => setAbierta(esta ? null : e.id)}
                                            aria-expanded={esta}
                                            aria-label={esta ? t("rowCollapse") : t("rowExpand")}
                                            title={esta ? t("rowCollapse") : t("rowExpand")}
                                            className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                                        >
                                            <span aria-hidden className={`inline-block transition-transform ${esta ? "rotate-90" : ""}`}>›</span>
                                        </button>
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className="font-mono text-xs">{e.repository}</span>
                                        {e.pr_number ? <span className="text-slate-400 text-xs ml-1">#{e.pr_number}</span> : null}
                                        {herramienta ? <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500 border border-slate-300 dark:border-slate-700 rounded px-1">{herramienta}</span> : null}
                                    </td>
                                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{e.author || "—"}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{usd(e.current_monthly_cost_usd, locale)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{usd(e.projected_monthly_cost_usd, locale)}</td>
                                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${delta > 0 ? "text-red-600 dark:text-red-400" : delta < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                                        {delta > 0 ? "+" : ""}{usd(delta, locale)}
                                        {/* Sin esto, un delta al que le faltan recursos se lee como si fuera el total. */}
                                        {e.resources_unpriced > 0 ? <InfoTooltip content={t("unpricedWarning", { n: e.resources_unpriced })} /> : null}
                                        {meta?.discount_pct ? (
                                            <p className="text-[10px] font-normal text-slate-500">{t("discountBadge", { pct: numero(meta.discount_pct, locale) })}</p>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                                        {meta?.budget ? (
                                            <>
                                                <span className="block">{meta.budget.cost_center}</span>
                                                {meta.budget.delta_pct_of_budget !== null ? (
                                                    <span className="text-slate-500">{t("budgetShare", { pct: numero(meta.budget.delta_pct_of_budget, locale, 1) })}</span>
                                                ) : null}
                                            </>
                                        ) : "—"}
                                    </td>
                                    <td className="px-3 py-2"><Gate fila={e} t={t} /></td>
                                    <td className="px-3 py-2 text-slate-500 text-xs">{new Date(e.created_at).toLocaleString(locale)}</td>
                                </tr>
                                {esta ? (
                                    <tr className="bg-slate-50/60 dark:bg-slate-900/40">
                                        <td colSpan={9}>
                                            <Detalle fila={e} tenantId={tenantId} esMock={esMock} locale={locale} t={t} fetcher={fetcher} />
                                        </td>
                                    </tr>
                                ) : null}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
