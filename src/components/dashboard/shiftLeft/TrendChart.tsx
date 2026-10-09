"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import InfoTooltip from "@/components/InfoTooltip";
import { useChartTheme } from "@/lib/chartTheme";
import { repositoriosDe, serieDeTendencia, type FilaEstimacion } from "@/lib/shiftLeftBoard";
import { usd, type Gate, type T } from "./common";

/**
 * La evolución del delta de un repositorio (MEJ-20). Cada estimación es un punto, no sólo la
 * última de cada PR: el valor de Shift-Left es ver si el autor corrigió el sobredimensionamiento
 * después del primer comentario, y eso es una baja entre dos puntos.
 */
export default function TrendChart({
    items, gates, locale, t,
}: {
    items: FilaEstimacion[];
    gates: Gate[];
    locale: string;
    t: T;
}) {
    const chart = useChartTheme();
    const repos = useMemo(() => repositoriosDe(items), [items]);
    const [repo, setRepo] = useState(repos[0] ?? "");
    useEffect(() => { if (!repos.includes(repo)) setRepo(repos[0] ?? ""); }, [repos, repo]);

    const serie = useMemo(() => serieDeTendencia(items, repo), [items, repo]);
    const umbral = gates.find((g) => g.repository === repo)?.threshold_usd;
    const fecha = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: "2-digit", month: "short" });

    if (repos.length === 0) return null;

    return (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                    {t("trendTitle")}
                    <InfoTooltip content={t("trendHelp")} />
                </h2>
                <label className="text-xs text-slate-500 flex items-center gap-2">
                    {t("trendRepoLabel")}
                    <select
                        value={repo}
                        onChange={(e) => setRepo(e.target.value)}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                    >
                        {repos.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                </label>
            </div>

            {serie.length < 2 ? (
                <p className="text-xs text-slate-500">{t("trendEmpty")}</p>
            ) : (
                <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={serie} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} opacity={0.6} />
                            <XAxis dataKey="fecha" tickFormatter={fecha} stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                            <YAxis stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} tickFormatter={(v) => usd(v, locale)} width={80} />
                            <Tooltip
                                labelFormatter={(ms) => new Date(Number(ms)).toLocaleString(locale)}
                                formatter={(valor: any, _n: any, p: any) => [usd(valor, locale), `${t("trendDelta")}${p?.payload?.pr ? ` · #${p.payload.pr}` : ""}`]}
                                contentStyle={{ backgroundColor: chart.tooltip.backgroundColor, border: `1px solid ${chart.tooltip.borderColor}`, borderRadius: 8, color: chart.tooltip.color }}
                            />
                            <ReferenceLine y={0} stroke={chart.axis} />
                            {umbral !== undefined && umbral !== null ? (
                                <ReferenceLine y={Number(umbral)} stroke="#EF4444" strokeDasharray="4 4" label={{ value: t("trendThreshold"), fill: "#EF4444", fontSize: 10 }} />
                            ) : null}
                            <Line
                                type="monotone"
                                dataKey="delta"
                                stroke={chart.accent}
                                strokeWidth={2.5}
                                isAnimationActive={chart.animate}
                                dot={{ r: 3, fill: chart.accent }}
                                activeDot={{ r: 6 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </section>
    );
}
