"use client";

import React, { useState } from "react";
import InfoTooltip from "@/components/InfoTooltip";
import { errorMessage } from "@/lib/apiErrors";
import { enviar, numero, usd, type CentroDeCostos, type Gate, type HeadersFn, type T } from "./common";

const campo = "rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100";

/**
 * Budget Gates: el umbral por repositorio (MEJ-20).
 *
 * Un solo formulario para alta y edición. Tocar una fila la carga acá arriba y guardar la pisa
 * (el endpoint es un upsert), así que no hay un modo "editar" que mantener aparte. Un gate puede
 * tener un monto, un porcentaje de lo que queda del presupuesto de un centro de costos, o sólo el
 * centro (que da contexto en el comentario del PR sin bloquear nada).
 */
export default function GatesEditor({
    gates, centros, tenantId, esMock, locale, t, onChange, headers,
}: {
    gates: Gate[];
    centros: CentroDeCostos[];
    tenantId: string;
    esMock: boolean;
    locale: string;
    t: T;
    onChange: () => void;
    headers: HeadersFn;
}) {
    const [repo, setRepo] = useState("");
    const [umbral, setUmbral] = useState("");
    const [centro, setCentro] = useState("");
    const [pct, setPct] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

    function limpiar() {
        setRepo(""); setUmbral(""); setCentro(""); setPct("");
    }

    async function guardar(cuerpo: { repository: string; threshold_usd: number | null; threshold_pct_of_remaining: number | null; cost_center_name: string | null }) {
        if (!cuerpo.repository.trim() || !tenantId) return;
        setGuardando(true);
        setAviso(null);
        try {
            await enviar(`/api/governance/shift-left/gates${esMock ? "?mock=true" : ""}`, { tenantId, ...cuerpo, repository: cuerpo.repository.trim() }, headers);
            limpiar();
            setAviso({ tipo: "ok", texto: t("gatesSaved") });
            onChange();
        } catch (e) {
            setAviso({ tipo: "error", texto: `${t("gatesError")}: ${errorMessage(e)}` });
        } finally {
            setGuardando(false);
        }
    }

    return (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
                {t("gatesTitle")}
                <InfoTooltip content={t("gatesHelp")} />
            </h2>

            <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    guardar({
                        repository: repo,
                        threshold_usd: umbral === "" ? null : Number(umbral),
                        threshold_pct_of_remaining: centro && pct !== "" ? Number(pct) : null,
                        cost_center_name: centro || null,
                    });
                }}
            >
                <input
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder={t("gatesRepoPlaceholder")}
                    aria-label={t("colRepo")}
                    className={`flex-1 min-w-[16rem] font-mono ${campo}`}
                />
                <input
                    value={umbral}
                    onChange={(e) => setUmbral(e.target.value)}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t("gatesThresholdPlaceholder")}
                    aria-label={t("gatesThresholdPlaceholder")}
                    className={`w-40 tabular-nums ${campo}`}
                />
                <select
                    value={centro}
                    onChange={(e) => { setCentro(e.target.value); if (!e.target.value) setPct(""); }}
                    aria-label={t("gatesCostCenterLabel")}
                    className={`min-w-[11rem] ${campo}`}
                >
                    <option value="">{t("gatesCostCenterNone")}</option>
                    {centros.map((c) => (
                        <option key={c.cost_center_name} value={c.cost_center_name}>{c.cost_center_name}</option>
                    ))}
                </select>
                <input
                    value={pct}
                    onChange={(e) => setPct(e.target.value)}
                    type="number"
                    min={0}
                    max={1000}
                    step="0.01"
                    disabled={!centro}
                    placeholder={t("gatesPctPlaceholder")}
                    aria-label={t("gatesPctPlaceholder")}
                    title={t("gatesPctHelp")}
                    className={`w-52 tabular-nums disabled:opacity-40 ${campo}`}
                />
                <button
                    type="submit"
                    disabled={guardando || !repo.trim()}
                    className="rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                    {t("gatesSave")}
                </button>
            </form>

            {centros.length === 0 ? <p className="text-[11px] text-slate-500">{t("gatesNoCostCenters")}</p> : null}

            {aviso ? (
                <p className={`text-xs ${aviso.tipo === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {aviso.texto}
                </p>
            ) : null}

            {gates.length === 0 ? (
                <p className="text-xs text-slate-500">{t("gatesEmpty")}</p>
            ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {gates.map((g) => (
                        <li key={g.repository} className="flex items-center justify-between gap-3 py-1.5">
                            <button
                                type="button"
                                className="font-mono text-xs truncate hover:underline text-left"
                                onClick={() => {
                                    setRepo(g.repository);
                                    setUmbral(g.threshold_usd === null ? "" : String(Number(g.threshold_usd)));
                                    setCentro(g.cost_center_name ?? "");
                                    setPct(g.threshold_pct_of_remaining === null ? "" : String(Number(g.threshold_pct_of_remaining)));
                                }}
                            >
                                {g.repository}
                            </button>
                            <span className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
                                {g.cost_center_name ? <span className="text-slate-500">{g.cost_center_name}</span> : null}
                                {g.threshold_usd !== null ? <span>{usd(g.threshold_usd, locale)}</span> : null}
                                {g.threshold_pct_of_remaining !== null ? (
                                    <span>{t("gatesPctShort", { pct: numero(g.threshold_pct_of_remaining, locale) })}</span>
                                ) : null}
                                <button
                                    type="button"
                                    disabled={guardando}
                                    onClick={() => guardar({ repository: g.repository, threshold_usd: null, threshold_pct_of_remaining: null, cost_center_name: null })}
                                    className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-40"
                                >
                                    {t("gatesRemove")}
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
