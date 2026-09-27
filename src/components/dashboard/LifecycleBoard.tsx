"use client";

/**
 * MEJ-39 — fin de soporte (EOL/EOS), con el costo de lo afectado al lado.
 *
 * El semáforo reusa la forma del panel de ARO, que es lo que ya se entiende
 * acá. Lo que NO reusa es su criterio: aquel devuelve "active_support" cuando
 * no puede leer la versión, y esta pantalla existe para no hacer eso.
 */

import React, { useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { IconClockExclamation, IconExternalLink } from "@tabler/icons-react";

type Ventana = "retirado" | "critico" | "proximo" | "soportado" | "sin-datos";

interface Recurso {
    id: string;
    name: string;
    familia: string;
    resourceGroup?: string;
    location?: string;
    version: string | null;
    ventana: Ventana;
    finDeSoporte: string | null;
    finExtendido: string | null;
    diasRestantes: number | null;
    nota: string | null;
    motivo: string | null;
    costoMensualUsd: number | null;
    fuente: string;
}

interface Respuesta {
    revisadoEl: string;
    resources: Recurso[];
    resumen: {
        porVentana: Record<Ventana, number>;
        costoEnRiesgoUsd: number;
        recursosSinCosto: number;
    };
    message?: string;
}

const COLOR: Record<Ventana, string> = {
    retirado: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    critico: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
    proximo: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    soportado: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    "sin-datos": "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

const ORDEN: Ventana[] = ["retirado", "critico", "proximo", "sin-datos", "soportado"];

export default function LifecycleBoard() {
    const t = useTranslations("Lifecycle");
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);

    const { data, error, isLoading } = useSWR<Respuesta>(
        tenantId ? `/api/governance/lifecycle?tenantId=${encodeURIComponent(tenantId)}${esMock ? "&mock=true" : ""}` : null,
        (url: string) => fetch(url).then((r) => r.json()),
        { revalidateOnFocus: false }
    );

    const dinero = useMemo(
        () => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
        []
    );

    if (isLoading) return <div className="card p-6 text-sm opacity-70">{t("loading")}</div>;
    if (error) return <div className="card p-6 text-sm text-red-600">{t("error")}</div>;
    if (!data) return null;

    const { resumen, resources } = data;
    const enRiesgo = resumen.porVentana.retirado + resumen.porVentana.critico + resumen.porVentana.proximo;

    return (
        <div className="space-y-4">
            <div className="card p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="text-2xl font-bold">
                            {t("atRisk", { n: enRiesgo })}
                        </div>
                        <div className="text-sm opacity-70 mt-1">
                            {t("atRiskCost", { cost: dinero.format(resumen.costoEnRiesgoUsd) })}
                        </div>
                        {/* Lo que no se pudo valorizar se informa, no se suma como cero:
                            sumar 0 bajaría el total y el riesgo se vería más chico. */}
                        {resumen.recursosSinCosto > 0 && (
                            <div className="text-xs opacity-60 mt-1">
                                {t("withoutCost", { n: resumen.recursosSinCosto })}
                            </div>
                        )}
                    </div>
                    {/* Criterio 2: el catálogo dice cuándo se revisó. Sin esto,
                        una pantalla vieja se ve igual que una al día. */}
                    <div className="text-xs opacity-60 text-right">
                        {t("reviewedOn", { date: data.revisadoEl })}
                    </div>
                </div>

                <div className="flex gap-2 flex-wrap mt-4">
                    {ORDEN.map((v) => (
                        <span key={v} className={`px-3 py-1 rounded-full text-xs font-semibold ${COLOR[v]}`}>
                            {t(`window.${v}`)}: {resumen.porVentana[v]}
                        </span>
                    ))}
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-slate-700">
                                <th className="px-4 py-3 font-semibold">{t("col.resource")}</th>
                                <th className="px-4 py-3 font-semibold">{t("col.family")}</th>
                                <th className="px-4 py-3 font-semibold">{t("col.version")}</th>
                                <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
                                <th className="px-4 py-3 font-semibold">{t("col.endOfSupport")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.monthlyCost")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {resources.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center opacity-60">{t("empty")}</td></tr>
                            )}
                            {resources.map((r) => (
                                <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800">
                                    <td className="px-4 py-3">
                                        <div className="font-medium">{r.name}</div>
                                        <div className="text-xs opacity-60">{r.resourceGroup} · {r.location}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <a href={r.fuente} target="_blank" rel="noopener noreferrer"
                                           className="inline-flex items-center gap-1 hover:underline">
                                            {r.familia}<IconExternalLink className="w-3 h-3 opacity-50" />
                                        </a>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs">{r.version ?? "—"}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-semibold ${COLOR[r.ventana]}`}>
                                            {t(`window.${r.ventana}`)}
                                        </span>
                                        {r.motivo && <div className="text-xs opacity-60 mt-1 max-w-xs">{r.motivo}</div>}
                                        {r.nota && <div className="text-xs opacity-60 mt-1 max-w-xs">{r.nota}</div>}
                                    </td>
                                    <td className="px-4 py-3">
                                        {r.finDeSoporte ?? "—"}
                                        {r.diasRestantes !== null && (
                                            <div className="text-xs opacity-60">
                                                {r.diasRestantes < 0
                                                    ? t("daysAgo", { n: Math.abs(r.diasRestantes) })
                                                    : t("daysLeft", { n: r.diasRestantes })}
                                            </div>
                                        )}
                                        {/* El soporte extendido es la otra salida, y tiene precio de lista. */}
                                        {r.finExtendido && (
                                            <div className="text-xs opacity-60">{t("extendedUntil", { date: r.finExtendido })}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {/* null no es 0: uno es "no se pudo atribuir", el otro "costó cero". */}
                                        {r.costoMensualUsd === null
                                            ? <span className="opacity-50">{t("noCost")}</span>
                                            : dinero.format(r.costoMensualUsd)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-xs opacity-50 flex items-center gap-1">
                <IconClockExclamation className="w-3.5 h-3.5" />
                {t("footnote")}
            </div>
        </div>
    );
}
