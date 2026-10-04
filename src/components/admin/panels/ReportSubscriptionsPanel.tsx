"use client";

/**
 * MEJ-35 — suscripciones a reportes.
 *
 * Vive como pestaña del hub de Reportes y no en una pantalla propia: es donde
 * los reportes ya están, y una entrada de menú más para esto sería ruido.
 */

import React, { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { toast } from "react-hot-toast";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "@/components/TenantProvider";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { IconTrash, IconSend, IconPlus } from "@tabler/icons-react";

type Frecuencia = "daily" | "weekly" | "monthly";

interface Suscripcion {
    id: number;
    reportType: string;
    scope: { perspectiveId?: number | null; grupo?: string | null } | null;
    recipients: string[];
    frequency: Frecuencia;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    lastSentAt: string | null;
    active: boolean;
    createdBy: string | null;
}

export default function ReportSubscriptionsPanel() {
    const t = useTranslations("ReportSubscriptions");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tenantId = selectedTenant?.id || "";
    const esMock = isMockTenant(tenantId);

    // La API exige la sesión en los tres métodos. Antes no se mandaba y, para
    // cualquier tenant real, el panel no listaba ni creaba nada.
    const pedir = useCallback(
        (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
            esMock ? fetch(url, init) : fetchWithAuthRetry(instance, accounts[0], url, init),
        [esMock, instance, accounts],
    );
    const listo = Boolean(tenantId) && (esMock || accounts.length > 0);

    const [abierto, setAbierto] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [form, setForm] = useState({
        reportType: "gasto-por-equipo",
        recipients: "",
        frequency: "weekly" as Frecuencia,
        dayOfWeek: 1,
        dayOfMonth: 1,
        perspectiveId: "",
        grupo: "",
        enviarAhora: false,
    });

    const url = listo ? `/api/reports/subscriptions?tenantId=${encodeURIComponent(tenantId)}` : null;
    const { data, mutate, isLoading } = useSWR<{ subscriptions: Suscripcion[]; tiposDisponibles: string[] }>(
        url,
        async (u: string) => {
            const r = await pedir(u);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        },
        { revalidateOnFocus: false }
    );

    // La Perspective se elige de una lista, no se escribe por id. Perspectives
    // es Enterprise: en otro plan la lista no se pide (daría 403) y el reporte
    // sale para todo el tenant.
    const conPerspectives = hasAccess(selectedTenant?.tier || "", "Enterprise");
    const { data: dataPerspectivas } = useSWR<{ perspectives: { id: number; name: string; reglas: { grupo: string | null }[] }[] }>(
        listo && conPerspectives && !esMock ? `/api/intelligence/perspectives?tenantId=${encodeURIComponent(tenantId)}` : null,
        async (u: string) => {
            const r = await pedir(u);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        },
        { revalidateOnFocus: false }
    );
    const perspectivas = useMemo(() => dataPerspectivas?.perspectives ?? [], [dataPerspectivas]);
    const gruposDeLaElegida = useMemo(() => {
        const p = perspectivas.find((x) => String(x.id) === form.perspectiveId);
        return [...new Set((p?.reglas ?? []).map((r) => r.grupo).filter((g): g is string => Boolean(g)))];
    }, [perspectivas, form.perspectiveId]);

    const dias = useMemo(
        () => [t("day.sun"), t("day.mon"), t("day.tue"), t("day.wed"), t("day.thu"), t("day.fri"), t("day.sat")],
        [t]
    );

    const cadencia = useCallback((s: Suscripcion) => {
        if (s.frequency === "daily") return t("freq.daily");
        if (s.frequency === "weekly") return t("freq.weeklyOn", { day: dias[s.dayOfWeek ?? 0] });
        return t("freq.monthlyOn", { day: s.dayOfMonth ?? 1 });
    }, [t, dias]);

    const crear = useCallback(async () => {
        const destinatarios = form.recipients.split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean);
        if (destinatarios.length === 0) { toast.error(t("needRecipient")); return; }
        setGuardando(true);
        try {
            const res = await pedir("/api/reports/subscriptions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    reportType: form.reportType,
                    recipients: destinatarios,
                    frequency: form.frequency,
                    dayOfWeek: form.frequency === "weekly" ? Number(form.dayOfWeek) : undefined,
                    dayOfMonth: form.frequency === "monthly" ? Number(form.dayOfMonth) : undefined,
                    scope: form.perspectiveId
                        ? { perspectiveId: Number(form.perspectiveId), grupo: form.grupo || null }
                        : null,
                    enviarAhora: form.enviarAhora,
                }),
            });
            const j = await res.json();
            if (!res.ok) { toast.error(j.error || t("saveError")); return; }
            // La prueba de envío puede fallar sin que la suscripción falle: se
            // dice, en vez de mostrar un éxito que no fue completo.
            if (j.avisoEnvio) toast(j.avisoEnvio, { icon: "⚠️" });
            else toast.success(t("saved"));
            setAbierto(false);
            setForm((f) => ({ ...f, recipients: "", grupo: "", enviarAhora: false }));
            await mutate();
        } finally {
            setGuardando(false);
        }
    }, [form, tenantId, t, mutate, pedir]);

    const borrar = useCallback(async (id: number) => {
        const res = await pedir(`/api/reports/subscriptions?tenantId=${encodeURIComponent(tenantId)}&id=${id}`, { method: "DELETE" });
        if (!res.ok) { toast.error(t("deleteError")); return; }
        toast.success(t("deleted"));
        await mutate();
    }, [tenantId, t, mutate, pedir]);

    const subs = data?.subscriptions ?? [];

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <p className="text-sm opacity-70 max-w-2xl">{t("intro")}</p>
                <button type="button" onClick={() => setAbierto((v) => !v)}
                        className="btn btn-primary inline-flex items-center gap-1.5 text-sm">
                    <IconPlus className="w-4 h-4" />{t("new")}
                </button>
            </div>

            {abierto && (
                <div className="card p-5 space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <label className="text-sm">
                            <span className="block mb-1 opacity-70">{t("field.report")}</span>
                            <select className="w-full border rounded px-2 py-1.5 bg-transparent"
                                    value={form.reportType}
                                    onChange={(e) => setForm({ ...form, reportType: e.target.value })}>
                                {(data?.tiposDisponibles ?? ["gasto-por-equipo"]).map((tp) => (
                                    <option key={tp} value={tp}>{tp}</option>
                                ))}
                            </select>
                        </label>

                        <label className="text-sm">
                            <span className="block mb-1 opacity-70">{t("field.frequency")}</span>
                            <select className="w-full border rounded px-2 py-1.5 bg-transparent"
                                    value={form.frequency}
                                    onChange={(e) => setForm({ ...form, frequency: e.target.value as Frecuencia })}>
                                <option value="daily">{t("freq.daily")}</option>
                                <option value="weekly">{t("freq.weekly")}</option>
                                <option value="monthly">{t("freq.monthly")}</option>
                            </select>
                        </label>

                        {form.frequency === "weekly" && (
                            <label className="text-sm">
                                <span className="block mb-1 opacity-70">{t("field.dayOfWeek")}</span>
                                <select className="w-full border rounded px-2 py-1.5 bg-transparent"
                                        value={form.dayOfWeek}
                                        onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
                                    {dias.map((d, i) => <option key={d} value={i}>{d}</option>)}
                                </select>
                            </label>
                        )}

                        {form.frequency === "monthly" && (
                            <label className="text-sm">
                                <span className="block mb-1 opacity-70">{t("field.dayOfMonth")}</span>
                                <input type="number" min={1} max={31}
                                       className="w-full border rounded px-2 py-1.5 bg-transparent"
                                       value={form.dayOfMonth}
                                       onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })} />
                                {/* Un 31 no se saltea los meses cortos: se recorta al último día. */}
                                {form.dayOfMonth > 28 && (
                                    <span className="block text-xs opacity-60 mt-1">{t("dayClamped")}</span>
                                )}
                            </label>
                        )}

                        <label className="text-sm sm:col-span-2">
                            <span className="block mb-1 opacity-70">{t("field.recipients")}</span>
                            <input className="w-full border rounded px-2 py-1.5 bg-transparent"
                                   placeholder="finanzas@empresa.com, lider@empresa.com"
                                   value={form.recipients}
                                   onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
                        </label>

                        <label className="text-sm">
                            <span className="block mb-1 opacity-70">{t("field.perspective")}</span>
                            <select className="w-full border rounded px-2 py-1.5 bg-transparent"
                                    value={form.perspectiveId}
                                    onChange={(e) => setForm({ ...form, perspectiveId: e.target.value, grupo: "" })}>
                                <option value="">{t("field.perspectiveNone")}</option>
                                {perspectivas.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                            </select>
                        </label>

                        <label className="text-sm">
                            <span className="block mb-1 opacity-70">{t("field.group")}</span>
                            <select className="w-full border rounded px-2 py-1.5 bg-transparent disabled:opacity-50"
                                    value={form.grupo}
                                    disabled={!form.perspectiveId}
                                    onChange={(e) => setForm({ ...form, grupo: e.target.value })}>
                                <option value="">{t("field.groupAll")}</option>
                                {gruposDeLaElegida.map((g) => <option key={g} value={g}>{g}</option>)}
                            </select>
                        </label>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.enviarAhora}
                               onChange={(e) => setForm({ ...form, enviarAhora: e.target.checked })} />
                        {/* Probar sin esperar a la cadencia; no marca el período como enviado. */}
                        <IconSend className="w-4 h-4 opacity-60" />{t("sendNow")}
                    </label>

                    <div className="flex gap-2">
                        <button type="button" disabled={guardando} onClick={crear} className="btn btn-primary text-sm">
                            {guardando ? t("saving") : t("save")}
                        </button>
                        <button type="button" onClick={() => setAbierto(false)} className="btn text-sm">{t("cancel")}</button>
                    </div>
                </div>
            )}

            <div className="card overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 dark:border-slate-700">
                            <th className="px-4 py-3 font-semibold">{t("col.report")}</th>
                            <th className="px-4 py-3 font-semibold">{t("col.cadence")}</th>
                            <th className="px-4 py-3 font-semibold">{t("col.recipients")}</th>
                            <th className="px-4 py-3 font-semibold">{t("col.lastSent")}</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center opacity-60">{t("loading")}</td></tr>}
                        {!isLoading && subs.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-8 text-center opacity-60">{t("empty")}</td></tr>
                        )}
                        {subs.map((s) => (
                            <tr key={s.id} className={`border-b border-gray-100 dark:border-slate-800 ${s.active ? "" : "opacity-50"}`}>
                                <td className="px-4 py-3">
                                    <div className="font-medium">{s.reportType}</div>
                                    {s.scope?.grupo && <div className="text-xs opacity-60">{s.scope.grupo}</div>}
                                    {/* Una desactivada se muestra: alguien tiene que poder ver
                                        por qué dejó de llegar el reporte. */}
                                    {!s.active && <div className="text-xs opacity-60">{t("inactive")}</div>}
                                </td>
                                <td className="px-4 py-3">{cadencia(s)}</td>
                                <td className="px-4 py-3 text-xs">{s.recipients.join(", ")}</td>
                                <td className="px-4 py-3 text-xs opacity-70">
                                    {s.lastSentAt ? new Date(s.lastSentAt).toLocaleString() : t("never")}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <button type="button" onClick={() => borrar(s.id)}
                                            className="p-1 opacity-40 hover:opacity-90" title={t("delete")}>
                                        <IconTrash className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
