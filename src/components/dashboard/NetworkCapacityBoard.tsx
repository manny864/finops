"use client";

/**
 * MEJ-19 criterio 3 — enlaces sobredimensionados.
 *
 * La pantalla RECOMIENDA BAJAR DE SKU, así que su obligación principal no es
 * mostrar el número sino no mostrarlo cuando no lo tiene: un enlace sin
 * métricas se marca como no medido, nunca como ocioso. Recomendar achicar un
 * circuito que no se pudo medir puede cortar producción.
 */

import React, { useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/demoTenant";
import { IconRouter, IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";

type Veredicto = "subutilizado" | "ajustado" | "sin-datos" | "sin-capacidad";

interface Enlace {
    id: string; name: string; tipo: string; sku: string | null;
    resourceGroup?: string; location?: string;
    capacidadMbps: number | null; p95Mbps: number | null;
    utilizacionPct: number | null; veredicto: Veredicto; motivo: string | null; fuente: string;
}

interface Respuesta {
    revisadoEl: string; ventanaDias: number; umbralPct: number;
    enlaces: Enlace[];
    resumen: Record<Veredicto | "sinMedir", number>;
}

const COLOR: Record<Veredicto, string> = {
    subutilizado: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    ajustado: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    "sin-datos": "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    "sin-capacidad": "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

export default function NetworkCapacityBoard() {
    const t = useTranslations("NetworkCapacity");
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);
    const { instance, accounts } = useMsal();

    const { data, error, isLoading } = useSWR<Respuesta>(
        tenantId && (esMock || accounts.length > 0) ? `/api/intelligence/network/capacity?tenantId=${encodeURIComponent(tenantId)}${esMock ? "&mock=true" : ""}` : null,
        async (u: string) => {
            // La ruta exige el token de sesión. Este fetch no lo mandaba y TODO
            // tenant real recibía 401; se leyó como "sesión vencida" porque el
            // demo, que intercepta el fetch, sí mostraba datos.
            const headers: Record<string, string> = esMock
                ? {}
                : { Authorization: `Bearer ${await getFreshIdToken(instance, accounts[0])}` };
            // Un `fetch` que no lanza ante un 401/403/500 le entrega a SWR un
            // cuerpo `{error}` como si fuera datos: `error` queda en null, el
            // componente cree que tiene respuesta y explota al desestructurar.
            const r = await fetch(u, { headers });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        },
        { revalidateOnFocus: false }
    );

    const mbps = useMemo(() => (v: number | null) => (v === null ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} Mbps`), []);

    if (isLoading) return <div className="card p-6 text-sm opacity-70">{t("loading")}</div>;
    if (error) return <div className="card p-6 text-sm text-red-600">{t("error")}</div>;
    // No alcanza con `!data`: una respuesta 200 con un cuerpo inesperado
    // también llega acá. Se exige la forma que el componente va a leer.
    if (!data?.resumen || !Array.isArray(data.enlaces)) {
        return <div className="card p-6 text-sm text-red-600">{t("error")}</div>;
    }

    const { resumen, enlaces } = data;

    return (
        <div className="space-y-4">
            <div className="card p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="text-2xl font-bold">{t("oversized", { n: resumen.subutilizado })}</div>
                        <div className="text-sm opacity-70 mt-1">
                            {t("criterion", { pct: data.umbralPct, dias: data.ventanaDias })}
                        </div>
                    </div>
                    <div className="text-xs opacity-60 text-right">{t("reviewedOn", { date: data.revisadoEl })}</div>
                </div>

                {/* Los no medidos se dicen arriba, no escondidos en la tabla: son
                    los que NO se puede afirmar que estén bien. */}
                {resumen.sinMedir > 0 && (
                    <div className="mt-3 text-xs opacity-70 flex items-start gap-1.5">
                        <IconAlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {t("unmeasured", { n: resumen.sinMedir })}
                    </div>
                )}
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-slate-700">
                                <th className="px-4 py-3 font-semibold">{t("col.link")}</th>
                                <th className="px-4 py-3 font-semibold">{t("col.sku")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.contracted")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.p95")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.usage")}</th>
                                <th className="px-4 py-3 font-semibold">{t("col.verdict")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {enlaces.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center opacity-60">{t("empty")}</td></tr>
                            )}
                            {enlaces.map((e) => (
                                <tr key={e.id} className="border-b border-gray-100 dark:border-slate-800">
                                    <td className="px-4 py-3">
                                        <div className="font-medium">{e.name}</div>
                                        <div className="text-xs opacity-60">
                                            <a href={e.fuente} target="_blank" rel="noopener noreferrer"
                                               className="inline-flex items-center gap-1 hover:underline">
                                                {e.tipo}<IconExternalLink className="w-3 h-3 opacity-50" />
                                            </a>
                                            {" · "}{e.resourceGroup} · {e.location}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs">{e.sku ?? "—"}</td>
                                    <td className="px-4 py-3 text-right whitespace-nowrap">{mbps(e.capacidadMbps)}</td>
                                    <td className="px-4 py-3 text-right whitespace-nowrap">{mbps(e.p95Mbps)}</td>
                                    <td className="px-4 py-3 text-right">
                                        {e.utilizacionPct === null ? <span className="opacity-40">—</span> : `${e.utilizacionPct.toFixed(1)}%`}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-semibold ${COLOR[e.veredicto]}`}>
                                            {t(`verdict.${e.veredicto}`)}
                                        </span>
                                        {e.motivo && <div className="text-xs opacity-60 mt-1 max-w-xs">{e.motivo}</div>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-xs opacity-50 flex items-start gap-1.5">
                <IconRouter className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {/* Azure Monitor no da percentiles: el P95 se calcula sobre las
                    muestras horarias que devuelve la API. Decirlo evita que
                    alguien lo compare contra un P95 al minuto y no cierre. */}
                {t("footnote")}
            </div>
        </div>
    );
}
