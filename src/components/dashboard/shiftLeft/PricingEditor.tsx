"use client";

import React, { useEffect, useState } from "react";
import InfoTooltip from "@/components/InfoTooltip";
import { errorMessage } from "@/lib/apiErrors";
import { enviar, type HeadersFn, type T } from "./common";

/**
 * El descuento del cliente sobre el precio de lista (MEJ-20). Un solo número: es un promedio
 * declarado, no el precio de cada medidor.
 */
export default function PricingEditor({
    descuento, tenantId, esMock, t, onChange, headers,
}: {
    descuento: number;
    tenantId: string;
    esMock: boolean;
    t: T;
    onChange: () => void;
    headers: HeadersFn;
}) {
    const [valor, setValor] = useState(String(descuento || ""));
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

    // Si el valor guardado cambia (recarga, otro tenant), el campo lo sigue.
    useEffect(() => setValor(descuento ? String(descuento) : ""), [descuento]);

    async function guardar() {
        if (!tenantId) return;
        setGuardando(true);
        setAviso(null);
        try {
            await enviar(`/api/governance/shift-left/pricing${esMock ? "?mock=true" : ""}`,
                { tenantId, discount_pct: valor === "" ? null : Number(valor) }, headers);
            setAviso({ tipo: "ok", texto: t("pricingSaved") });
            onChange();
        } catch (e) {
            setAviso({ tipo: "error", texto: `${t("pricingError")}: ${errorMessage(e)}` });
        } finally {
            setGuardando(false);
        }
    }

    return (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
                {t("pricingTitle")}
                <InfoTooltip content={t("pricingHelp")} />
            </h2>
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
                <label className="text-xs text-slate-500 flex flex-col gap-1">
                    {t("pricingLabel")}
                    <input
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        placeholder="0"
                        className="w-40 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-sm tabular-nums text-slate-900 dark:text-slate-100"
                    />
                </label>
                <button
                    type="submit"
                    disabled={guardando}
                    className="rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                    {t("pricingSave")}
                </button>
            </form>
            {aviso ? (
                <p className={`text-xs ${aviso.tipo === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {aviso.texto}
                </p>
            ) : null}
        </section>
    );
}
