"use client";

import { useTranslations, useLocale } from "next-intl";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/demoTenant";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import { IconArrowUp, IconArrowDown, IconTrash, IconPlus, IconDeviceFloppy } from "@tabler/icons-react";

/**
 * MEJ-34 — definir Perspectives y ver el reparto ANTES de guardar.
 *
 * La vista previa no es un adorno: es el criterio de aceptación 5. Sin ella,
 * ordenar reglas es adivinar, porque el orden ES lo que decide a qué grupo cae
 * cada recurso.
 */

type TipoRegla = "tag" | "name_pattern" | "subscription" | "resource_group" | "resource_type";

interface Regla {
    grupo: string;
    tipo: TipoRegla;
    clave?: string | null;
    valor: string;
    orden: number;
}

interface Perspectiva {
    id: number;
    name: string;
    description: string | null;
    reglas: Regla[];
}

interface Reparto {
    grupos: Array<{ grupo: string; costo: number; porcentaje: number; filas: number }>;
    sinAsignar: { costo: number; porcentaje: number; filas: number };
    sinDatos: { costo: number; porcentaje: number; filas: number; motivos: string[] };
    total: number;
    coberturaPct: number;
}

const TIPOS: TipoRegla[] = ["tag", "name_pattern", "subscription", "resource_group", "resource_type"];

async function authHeaders(instance: any, accounts: any[], isMock: boolean) {
    if (isMock) return {} as Record<string, string>;
    const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
    return { Authorization: `Bearer ${token}` };
}

const usd = (v: unknown, locale: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(v) || 0);

export default function PerspectivesBoard() {
    const t = useTranslations("Perspectives");
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);

    const fetcher = useCallback(
        async (url: string) => {
            const res = await fetch(url, { headers: await authHeaders(instance, accounts, esMock) });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            return res.json();
        },
        [instance, accounts, esMock],
    );

    const { data, error, isLoading, mutate } = useSWR(
        tenantId ? `/api/intelligence/perspectives?tenantId=${encodeURIComponent(tenantId)}` : null,
        fetcher,
        { revalidateOnFocus: false },
    );

    const perspectivas: Perspectiva[] = useMemo(() => data?.perspectives || [], [data]);
    const [seleccionada, setSeleccionada] = useState<number | null>(null);
    const [reglas, setReglas] = useState<Regla[]>([]);
    const [reparto, setReparto] = useState<Reparto | null>(null);
    const [calculando, setCalculando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [nombreNuevo, setNombreNuevo] = useState("");
    const [creando, setCreando] = useState(false);
    const [borrando, setBorrando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);

    // Al elegir una Perspective se cargan SUS reglas; a partir de ahí se edita
    // en memoria y la vista previa se recalcula sin tocar la base.
    useEffect(() => {
        if (seleccionada === null && perspectivas.length > 0) setSeleccionada(perspectivas[0].id);
    }, [perspectivas, seleccionada]);

    useEffect(() => {
        const p = perspectivas.find((x) => x.id === seleccionada);
        setReglas(p ? p.reglas.map((r, i) => ({ ...r, orden: i })) : []);
    }, [seleccionada, perspectivas]);

    /** Pide el reparto con las reglas ACTUALES, guardadas o no (criterio 5). */
    const previsualizar = useCallback(async () => {
        if (!tenantId) return;
        setCalculando(true);
        setAviso(null);
        try {
            const res = await fetch(`/api/intelligence/perspectives/breakdown?tenantId=${encodeURIComponent(tenantId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await authHeaders(instance, accounts, esMock)) },
                body: JSON.stringify({ reglas }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            setReparto(json.reparto);
        } catch (e) {
            setAviso(errorMessage(e));
        } finally {
            setCalculando(false);
        }
    }, [tenantId, reglas, instance, accounts, esMock]);

    const guardar = useCallback(async () => {
        if (!tenantId || seleccionada === null) return;
        setGuardando(true);
        setAviso(null);
        try {
            const res = await fetch(
                `/api/intelligence/perspectives?tenantId=${encodeURIComponent(tenantId)}&id=${seleccionada}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", ...(await authHeaders(instance, accounts, esMock)) },
                    body: JSON.stringify({ reglas }),
                },
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            await mutate();
            setAviso(t("saved"));
        } catch (e) {
            setAviso(errorMessage(e));
        } finally {
            setGuardando(false);
        }
    }, [tenantId, seleccionada, reglas, instance, accounts, esMock, mutate, t]);

    /**
     * Crear la primera —y las siguientes—.
     *
     * El `POST` existía en la API desde el principio y NADIE lo llamaba: la
     * pantalla sólo sabía listar, editar reglas y previsualizar. Con cero
     * Perspectives mostraba "creá la primera" y no daba con qué, así que toda
     * la cadena que depende de esto (el selector transversal, MEJ-35, MEJ-37 y
     * MEJ-38) no se podía arrancar desde el producto.
     */
    const crear = useCallback(async () => {
        const name = nombreNuevo.trim();
        if (!tenantId || !name) return;
        setCreando(true);
        setAviso(null);
        try {
            const res = await fetch(
                `/api/intelligence/perspectives?tenantId=${encodeURIComponent(tenantId)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...(await authHeaders(instance, accounts, esMock)) },
                    // Nace SIN reglas: con una regla vacía de arranque, la vista
                    // previa mostraría un grupo sin nombre y el "sin asignar" al
                    // 100%, que se lee como que algo falló.
                    body: JSON.stringify({ name, reglas: [] }),
                },
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            setNombreNuevo("");
            await mutate();
            // Se selecciona la recién creada para poder cargarle reglas ya.
            if (json.id) { setSeleccionada(Number(json.id)); setReglas([]); setReparto(null); }
            setAviso(t("created"));
        } catch (e) {
            setAviso(errorMessage(e));
        } finally {
            setCreando(false);
        }
    }, [tenantId, nombreNuevo, instance, accounts, esMock, mutate, t]);

    const borrar = useCallback(async () => {
        if (!tenantId || seleccionada === null) return;
        const nombre = perspectivas.find((p) => p.id === seleccionada)?.name ?? "";
        // Borrar se lleva las reglas por CASCADE y deja sin alcance a quien la
        // tuviera asignada: se pregunta antes, con el nombre a la vista.
        if (!window.confirm(t("confirmDelete", { name: nombre }))) return;
        setBorrando(true);
        setAviso(null);
        try {
            const res = await fetch(
                `/api/intelligence/perspectives?tenantId=${encodeURIComponent(tenantId)}&id=${seleccionada}`,
                { method: "DELETE", headers: await authHeaders(instance, accounts, esMock) },
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
            setSeleccionada(null);
            setReglas([]);
            setReparto(null);
            await mutate();
            setAviso(t("deleted"));
        } catch (e) {
            setAviso(errorMessage(e));
        } finally {
            setBorrando(false);
        }
    }, [tenantId, seleccionada, perspectivas, instance, accounts, esMock, mutate, t]);

    const mover = (i: number, delta: number) => {
        const j = i + delta;
        if (j < 0 || j >= reglas.length) return;
        const copia = [...reglas];
        [copia[i], copia[j]] = [copia[j], copia[i]];
        setReglas(copia.map((r, k) => ({ ...r, orden: k })));
    };

    const editar = (i: number, campo: keyof Regla, valor: string) =>
        setReglas(reglas.map((r, k) => (k === i ? { ...r, [campo]: valor } : r)));

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {t("loadError")}: {errorMessage(error)}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {t("title")}
                    <InfoTooltip content={t("tooltipTitle")} />
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("subtitle")}</p>
            </header>

            {/* El alta vive FUERA del condicional a propósito: con cero
                Perspectives la pantalla decía "creá la primera" y no daba con
                qué, porque el selector y los botones sólo se renderizaban
                cuando ya existía una. */}
            {!isLoading && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <label className="min-w-[14rem] flex-1 text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">{t("newLabel")}</span>
                        <input
                            className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                            placeholder={t("newPlaceholder")}
                            value={nombreNuevo}
                            onChange={(e) => setNombreNuevo(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") crear(); }}
                        />
                    </label>
                    <button
                        onClick={crear}
                        disabled={creando || !nombreNuevo.trim()}
                        className="flex items-center gap-1 rounded-lg bg-[#0054A6] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                        <IconPlus className="h-4 w-4" /> {creando ? t("creating") : t("create")}
                    </button>
                </div>
            )}

            {isLoading ? (
                <p className="text-sm text-slate-500">{t("loading")}</p>
            ) : perspectivas.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {t("empty")}
                </p>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("perspectiveLabel")}</label>
                        <select
                            className="rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                            value={seleccionada ?? ""}
                            onChange={(e) => setSeleccionada(Number(e.target.value))}
                        >
                            {perspectivas.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        {/* Al lado del selector, no entre los botones de las
                            reglas: esto borra la Perspective ENTERA, no una regla. */}
                        <button
                            onClick={borrar}
                            disabled={borrando || seleccionada === null}
                            className="ml-auto flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                            <IconTrash className="h-4 w-4" /> {borrando ? t("deleting") : t("delete")}
                        </button>
                    </div>

                    {/* Reglas. El orden es la semántica, así que se edita con
                        flechas y se numera a la vista. */}
                    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t("rulesTitle")}</h2>
                            <span className="text-xs text-slate-500">{t("firstMatchWins")}</span>
                        </div>

                        <div className="space-y-2">
                            {reglas.map((r, i) => (
                                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                                    <span className="w-6 text-center text-xs font-bold text-slate-400">{i + 1}</span>
                                    <input
                                        className="w-40 rounded border border-slate-300 p-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                                        placeholder={t("groupPlaceholder")}
                                        value={r.grupo}
                                        onChange={(e) => editar(i, "grupo", e.target.value)}
                                    />
                                    <select
                                        className="rounded border border-slate-300 p-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                                        value={r.tipo}
                                        onChange={(e) => editar(i, "tipo", e.target.value)}
                                    >
                                        {TIPOS.map((tipo) => (
                                            <option key={tipo} value={tipo}>{t(`type_${tipo}`)}</option>
                                        ))}
                                    </select>
                                    {r.tipo === "tag" && (
                                        <input
                                            className="w-36 rounded border border-slate-300 p-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                                            placeholder={t("tagKeyPlaceholder")}
                                            value={r.clave || ""}
                                            onChange={(e) => editar(i, "clave", e.target.value)}
                                        />
                                    )}
                                    <input
                                        className="w-44 rounded border border-slate-300 p-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                                        placeholder={t("valuePlaceholder")}
                                        value={r.valor}
                                        onChange={(e) => editar(i, "valor", e.target.value)}
                                    />
                                    <div className="ml-auto flex gap-1">
                                        <button aria-label={t("moveUp")} onClick={() => mover(i, -1)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                                            <IconArrowUp className="h-4 w-4" />
                                        </button>
                                        <button aria-label={t("moveDown")} onClick={() => mover(i, 1)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                                            <IconArrowDown className="h-4 w-4" />
                                        </button>
                                        <button aria-label={t("removeRule")} onClick={() => setReglas(reglas.filter((_, k) => k !== i))} className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                                            <IconTrash className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            <button
                                onClick={() => setReglas([...reglas, { grupo: "", tipo: "tag", clave: "CostCenter", valor: "", orden: reglas.length }])}
                                className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                            >
                                <IconPlus className="h-4 w-4" /> {t("addRule")}
                            </button>
                            <button
                                onClick={previsualizar}
                                disabled={calculando}
                                className="rounded-lg bg-[#0054A6] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                            >
                                {calculando ? t("calculating") : t("preview")}
                            </button>
                            <button
                                onClick={guardar}
                                disabled={guardando}
                                className="flex items-center gap-1 rounded-lg border border-emerald-500 px-3 py-1.5 text-sm font-bold text-emerald-700 disabled:opacity-50 dark:text-emerald-400"
                            >
                                <IconDeviceFloppy className="h-4 w-4" /> {guardando ? t("saving") : t("save")}
                            </button>
                        </div>
                        {aviso && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{aviso}</p>}
                    </section>

                    {reparto && (
                        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                            <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t("breakdownTitle")}</h2>
                                {/* La cobertura primero: una Perspective que cubre el
                                    60% y no lo dice se lee como si fuera el total. */}
                                <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-white">{reparto.coberturaPct}%</span>
                                <span className="text-xs text-slate-500">{t("coverageOf", { total: usd(reparto.total, locale) })}</span>
                            </div>

                            <table className="w-full text-sm">
                                <tbody>
                                    {reparto.grupos.map((g) => (
                                        <tr key={g.grupo} className="border-b border-slate-100 dark:border-slate-800">
                                            <td className="py-1.5 font-medium text-slate-700 dark:text-slate-200">{g.grupo}</td>
                                            <td className="py-1.5 text-right tabular-nums">{usd(g.costo, locale)}</td>
                                            <td className="w-16 py-1.5 text-right tabular-nums text-slate-500">{g.porcentaje}%</td>
                                        </tr>
                                    ))}
                                    <tr className="border-b border-slate-100 dark:border-slate-800">
                                        <td className="py-1.5 font-medium text-amber-700 dark:text-amber-400">{t("unassigned")}</td>
                                        <td className="py-1.5 text-right tabular-nums">{usd(reparto.sinAsignar.costo, locale)}</td>
                                        <td className="py-1.5 text-right tabular-nums text-slate-500">{reparto.sinAsignar.porcentaje}%</td>
                                    </tr>
                                    {/* Separado del "sin asignar" a propósito: esto NO
                                        es un problema de etiquetado del cliente, es
                                        gasto que nuestras reglas no pudieron evaluar
                                        porque el dato no está ingerido. */}
                                    {reparto.sinDatos.costo > 0 && (
                                        <tr>
                                            <td className="py-1.5 font-medium text-slate-500">
                                                {t("noData")}
                                                <span className="ml-1 text-xs">({reparto.sinDatos.motivos.join(", ")})</span>
                                            </td>
                                            <td className="py-1.5 text-right tabular-nums">{usd(reparto.sinDatos.costo, locale)}</td>
                                            <td className="py-1.5 text-right tabular-nums text-slate-500">{reparto.sinDatos.porcentaje}%</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {reparto.sinDatos.costo > 0 && (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("noDataHelp")}</p>
                            )}
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
