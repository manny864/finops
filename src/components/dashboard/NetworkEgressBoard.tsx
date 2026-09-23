"use client";

import { useTranslations, useLocale } from "next-intl";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import type { CategoriaEgress, MapaEgress } from "@/services/networkEgress.service";

/**
 * MEJ-19 — a dónde se va la plata de transferencia de datos.
 *
 * Lo que esta pantalla tiene que responder de un vistazo: **cuánto de la factura
 * de red es tráfico y no recursos**, y si hay tráfico entre zonas o por NAT
 * Gateway, que son los dos que sorprenden y los dos que se arreglan cambiando
 * arquitectura y no SKU.
 *
 * Sin Sankey: son seis categorías, y un diagrama de flujo para seis barras es una
 * dependencia nueva para decir lo mismo. Si algún día el desglose llega a nivel
 * de par origen-destino —que hoy la ingesta no da— ahí un Sankey dibuja algo que
 * una tabla no puede.
 */

const ORDEN_VISUAL: CategoriaEgress[] = [
    "internet",
    "entre_zonas",
    "nat_gateway",
    "entre_regiones",
    "entre_continentes",
    "entrada",
];

/** Los dos evitables por arquitectura llevan color de alerta; el resto, neutro. */
const COLOR: Record<CategoriaEgress, string> = {
    internet: "bg-blue-500",
    entre_zonas: "bg-amber-500",
    nat_gateway: "bg-amber-500",
    entre_regiones: "bg-sky-500",
    entre_continentes: "bg-indigo-500",
    entrada: "bg-slate-400",
};

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
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(v) || 0);

const gb = (v: number | null, locale: string) =>
    v === null ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v)} GB`;

export default function NetworkEgressBoard() {
    const t = useTranslations("NetworkEgress");
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [dias, setDias] = useState(30);

    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);

    const { data, error, isLoading } = useSWR<MapaEgress & { mock?: boolean }>(
        tenantId ? `/api/intelligence/network/egress?tenantId=${encodeURIComponent(tenantId)}&dias=${dias}` : null,
        buildFetcher(instance, accounts, esMock),
        { revalidateOnFocus: false }
    );

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
                {t("loadError")}: {errorMessage(error)}
            </div>
        );
    }

    const porCategoria = data?.porCategoria || [];
    const maxCosto = Math.max(1, ...porCategoria.map((c) => c.costoUsd));
    const ordenadas = [...porCategoria].sort(
        (a, b) => ORDEN_VISUAL.indexOf(a.categoria) - ORDEN_VISUAL.indexOf(b.categoria)
    );

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
                <select
                    value={dias}
                    onChange={(e) => setDias(Number(e.target.value))}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-sm"
                    aria-label={t("windowLabel")}
                >
                    {[7, 30, 90].map((d) => (
                        <option key={d} value={d}>{t("windowDays", { n: d })}</option>
                    ))}
                </select>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Kpi etiqueta={t("kpiOutbound")} valor={data ? usd(data.costoSalidaUsd, locale) : "—"} destacado />
                <Kpi etiqueta={t("kpiTotal")} valor={data ? usd(data.costoTotalUsd, locale) : "—"} />
                <Kpi etiqueta={t("kpiMeters")} valor={data ? String(data.flujos.length) : "—"} />
            </div>

            {isLoading ? (
                <p className="text-sm text-slate-500 py-8 text-center">{t("loading")}</p>
            ) : porCategoria.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                    <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">{t("emptyTitle")}</p>
                    {/* Un vacío sin explicación se lee como una pantalla rota. Acá
                        además es ambiguo: puede ser que no haya tráfico facturado
                        o que el sync todavía no haya corrido. */}
                    <p className="text-xs text-slate-500 mt-2 max-w-xl mx-auto">{t("emptyHint")}</p>
                </div>
            ) : (
                <>
                    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                        {ordenadas.map((c) => (
                            <div key={c.categoria}>
                                <div className="flex items-baseline justify-between text-sm">
                                    <span className="font-medium">{t(`cat_${c.categoria}`)}</span>
                                    <span className="tabular-nums">
                                        {usd(c.costoUsd, locale)}
                                        <span className="text-slate-400 text-xs ml-2">{gb(c.gigabytes, locale)}</span>
                                    </span>
                                </div>
                                <div className="h-2 mt-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${COLOR[c.categoria]}`}
                                        style={{ width: `${Math.max(2, (c.costoUsd / maxCosto) * 100)}%` }}
                                    />
                                </div>
                                {(c.categoria === "entre_zonas" || c.categoria === "nat_gateway") && c.costoUsd > 0 ? (
                                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t(`hint_${c.categoria}`)}</p>
                                ) : null}
                            </div>
                        ))}
                    </section>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-900/60 text-left">
                                <tr>
                                    <th className="px-3 py-2 font-medium">{t("colMeter")}</th>
                                    <th className="px-3 py-2 font-medium">{t("colCategory")}</th>
                                    <th className="px-3 py-2 font-medium">{t("colRegion")}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t("colVolume")}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t("colCost")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data?.flujos || []).map((f, i) => (
                                    <tr key={`${f.medidor}-${f.region}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                                        <td className="px-3 py-2 font-mono text-xs">{f.medidor}</td>
                                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{t(`cat_${f.categoria}`)}</td>
                                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{f.region || "—"}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{gb(f.gigabytes, locale)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-medium">{usd(f.costoUsd, locale)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Los dos límites se dicen, no se esconden: un número parcial
                        que parece total es el mismo error que el 0 silencioso. */}
                    <p className="text-xs text-slate-500">
                        {t("footnoteFreeTier")}
                        {data?.gigabytesParciales ? ` ${t("footnotePartialGb")}` : ""}
                    </p>
                </>
            )}
        </div>
    );
}

function Kpi({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{etiqueta}</p>
            <p className={`text-lg font-semibold mt-1 tabular-nums ${destacado ? "text-blue-600 dark:text-blue-400" : ""}`}>{valor}</p>
        </div>
    );
}
