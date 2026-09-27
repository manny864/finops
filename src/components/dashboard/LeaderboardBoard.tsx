"use client";

/**
 * MEJ-37 — el ranking de equipos.
 *
 * La regla de esta pantalla: el criterio de orden SE ESCRIBE, no se deduce. Un
 * ranking cuyo criterio no está a la vista genera discusión sobre el orden en
 * vez de conversación sobre el gasto, que es lo contrario de lo que se busca.
 */

import React, { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { IconTrophy, IconArrowRight, IconInfoCircle } from "@tabler/icons-react";

type Clasificacion = "COGS" | "OPEX" | "UNCLASSIFIED";

interface Fila {
    grupo: string;
    puesto: number | null;
    gasto: number;
    gastoPrevio: number | null;
    variacionPct: number | null;
    presupuesto: number | null;
    adherenciaPct: number | null;
    ahorroCapturado: number;
    clasificacion: Clasificacion;
    sinRanking: "sin-periodo-previo" | "no-material" | null;
}

interface Margen {
    ingresos: number | null;
    cogs: number;
    cogsSinClasificar: number;
    margenPct: number | null;
    margenPeorCasoPct: number | null;
    esRango: boolean;
}

interface Respuesta {
    success: boolean;
    sinPerspectiva?: boolean;
    message?: string;
    perspective?: { id: number; name: string };
    filas?: Fila[];
    criterio?: { descripcion: string; umbralMaterialidadPct: number };
    split?: { COGS: number; OPEX: number; UNCLASSIFIED: number; total: number };
    margen?: Margen;
    sinAsignar?: { costo: number; porcentaje: number };
    coberturaPct?: number;
}

export default function LeaderboardBoard() {
    const t = useTranslations("Leaderboard");
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);

    const { data, error, isLoading } = useSWR<Respuesta>(
        tenantId ? `/api/intelligence/leaderboard?tenantId=${encodeURIComponent(tenantId)}${esMock ? "&mock=true" : ""}` : null,
        async (u: string) => {
            // Un `fetch` que no lanza ante un 401/403/500 le entrega a SWR un
            // cuerpo `{error}` como si fuera datos: `error` queda en null, el
            // componente cree que tiene respuesta y explota al desestructurar.
            // Lo encontró el navegador con una sesión vencida, no los tests.
            const r = await fetch(u);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        },
        { revalidateOnFocus: false }
    );

    const dinero = useMemo(
        () => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
        []
    );

    if (isLoading) return <div className="card p-6 text-sm opacity-70">{t("loading")}</div>;
    if (error) return <div className="card p-6 text-sm text-red-600">{t("error")}</div>;
    if (!data) return null;

    if (data.sinPerspectiva) {
        return (
            <div className="card p-6 text-sm flex gap-3">
                <IconInfoCircle className="w-5 h-5 shrink-0 opacity-60" />
                <div>
                    {t("noPerspective")}{" "}
                    <Link href="/intelligence/perspectives" className="underline">{t("definePerspective")}</Link>
                </div>
            </div>
        );
    }

    const filas = data.filas ?? [];
    const split = data.split;
    const margen = data.margen;

    return (
        <div className="space-y-4">
            {/* MEJ-37 fase 2 — margen bruto. Sin ingresos ingestados se explica
                cómo mandarlos, en vez de mostrar 0% — que sería afirmar que
                todo lo que entra se va en nube. */}
            {margen && (
                <div className="card p-5">
                    <div className="text-sm font-semibold mb-3">{t("margin.title")}</div>
                    {margen.margenPct === null ? (
                        <p className="text-sm opacity-70">{t("margin.noRevenue")}</p>
                    ) : (
                        <>
                            <div className="flex items-baseline gap-3 flex-wrap">
                                <span className={`text-3xl font-bold ${margen.margenPct < 0 ? "text-red-600" : ""}`}>
                                    {margen.margenPct.toFixed(1)}%
                                </span>
                                {/* El rango no es adorno: mientras quede gasto sin
                                    clasificar, el número de la izquierda es el MEJOR
                                    caso, y un margen optimista es el error que un
                                    número financiero no puede cometer. */}
                                {margen.esRango && margen.margenPeorCasoPct !== null && (
                                    <span className="text-sm opacity-70">
                                        {t("margin.worstCase", { pct: margen.margenPeorCasoPct.toFixed(1) })}
                                    </span>
                                )}
                            </div>
                            <div className="text-xs opacity-60 mt-2">
                                {t("margin.formula", {
                                    revenue: dinero.format(margen.ingresos ?? 0),
                                    cogs: dinero.format(margen.cogs),
                                })}
                            </div>
                            {margen.esRango && (
                                <div className="text-xs opacity-60 mt-1">
                                    {t("margin.unclassifiedWarning", { cost: dinero.format(margen.cogsSinClasificar) })}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
            {/* Criterio 3: el split suma el total y UNCLASSIFIED se ve. Sin la
                parte sin clasificar, el margen bruto se calcularía sobre un
                COGS más chico de lo que es. */}
            {split && (
                <div className="card p-5">
                    <div className="text-sm font-semibold mb-3">{t("splitTitle")}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {(["COGS", "OPEX", "UNCLASSIFIED"] as const).map((k) => (
                            <div key={k}>
                                <div className="text-xs opacity-60">{t(`class.${k}`)}</div>
                                <div className="text-xl font-bold">{dinero.format(split[k])}</div>
                                <div className="text-xs opacity-50">
                                    {split.total > 0 ? `${((split[k] / split.total) * 100).toFixed(1)}%` : "—"}
                                </div>
                            </div>
                        ))}
                        <div>
                            <div className="text-xs opacity-60">{t("class.total")}</div>
                            <div className="text-xl font-bold">{dinero.format(split.total)}</div>
                        </div>
                    </div>
                    {data.sinAsignar && data.sinAsignar.costo > 0 && (
                        <div className="text-xs opacity-60 mt-3">
                            {t("unallocated", {
                                cost: dinero.format(data.sinAsignar.costo),
                                pct: data.sinAsignar.porcentaje.toFixed(1),
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Criterio 1: el criterio de orden, escrito. */}
            {data.criterio && (
                <div className="text-xs opacity-60 flex items-start gap-2">
                    <IconTrophy className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{data.criterio.descripcion}</span>
                </div>
            )}

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-slate-700">
                                <th className="px-4 py-3 font-semibold w-12">#</th>
                                <th className="px-4 py-3 font-semibold">{t("col.team")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.spend")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.change")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.budget")}</th>
                                <th className="px-4 py-3 font-semibold text-right">{t("col.savings")}</th>
                                <th className="px-4 py-3 font-semibold"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filas.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center opacity-60">{t("empty")}</td></tr>
                            )}
                            {filas.map((f) => (
                                <tr key={f.grupo} className="border-b border-gray-100 dark:border-slate-800">
                                    <td className="px-4 py-3 font-bold opacity-70">{f.puesto ?? "—"}</td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium">{f.grupo}</div>
                                        {/* Un grupo fuera del ranking dice POR QUÉ. Sin esto, un
                                            guion en la columna del puesto se lee como un error. */}
                                        {f.sinRanking && (
                                            <div className="text-xs opacity-60">{t(`outOfRank.${f.sinRanking}`)}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">{dinero.format(f.gasto)}</td>
                                    <td className="px-4 py-3 text-right">
                                        {f.variacionPct === null ? (
                                            <span className="opacity-40">—</span>
                                        ) : (
                                            <span className={f.variacionPct <= 0 ? "text-emerald-600" : "text-red-600"}>
                                                {f.variacionPct > 0 ? "+" : ""}{f.variacionPct.toFixed(1)}%
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {/* Criterio 2: sin presupuesto, celda vacía — no se excluye la fila. */}
                                        {f.adherenciaPct === null
                                            ? <span className="opacity-40">—</span>
                                            : `${f.adherenciaPct.toFixed(0)}%`}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {f.ahorroCapturado > 0 ? dinero.format(f.ahorroCapturado) : <span className="opacity-40">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        {/* Criterio 4: cada fila lleva al desglose de ese grupo.
                                            Un leaderboard sin drill-down genera discusión, no
                                            optimización. Reusa el selector transversal de MEJ-34. */}
                                        <Link
                                            href={`/intelligence/cost-groups?perspective=${data.perspective?.id}&pgroup=${encodeURIComponent(f.grupo)}`}
                                            className="inline-flex items-center gap-1 text-xs opacity-70 hover:opacity-100 hover:underline"
                                        >
                                            {t("drillDown")}<IconArrowRight className="w-3 h-3" />
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
