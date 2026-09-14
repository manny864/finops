"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { toast } from "sonner";
import { errorMessage } from "@/lib/apiErrors";
import { IconCpu, IconCloudDataConnection, IconRefresh } from "@tabler/icons-react";

/**
 * Consumo de la plataforma: lo que nos cuesta operar, no lo que gasta el tenant.
 *
 * Las dos mediciones ya existían y nadie las leía. `PlatformAiUsage` se escribe
 * desde julio y no tenía un solo SELECT en el repo --con `pricing.ts` diciendo
 * que la IA "se cobra por consumo" sobre ese dato, o sea un modelo de negocio
 * apoyado en un número que nadie miraba--. Y del throttling de Azure sólo se
 * podían contar los 429 en Log Analytics, sin el denominador: no se sabía si
 * hacíamos demasiadas llamadas o si Azure había cerrado la ventana.
 *
 * Los tokens se muestran crudos, sin convertir a dólares: el precio por modelo
 * cambia por proveedor y por contrato, y poner un número inventado acá sería
 * peor que no ponerlo.
 *
 * El consumo `platform` lo ABSORBE la casa: no se le factura al cliente
 * (decisión comercial, 2026-09-14). O sea que esta pantalla no es una base de
 * facturación sino un costo operativo a vigilar -- y por eso lo que importa de
 * cada fila es si alguien se está yendo de escala, no cuánto cobrarle.
 */

type FilaIa = {
    tenant_id: string | null;
    company_name: string | null;
    feature?: string;
    provider?: string;
    model_name?: string;
    source: "platform" | "byok";
    llamadas: number;
    inputTokens: number;
    outputTokens: number;
};

type TenantApi = {
    tenantId: string;
    nombre: string | null;
    llamadas: number;
    throttle: number;
    pctThrottle: number;
    minutosEsperando: number;
};

type ServicioAzure = {
    servicio: string;
    llamadas: number;
    throttle: number;
    error: number;
    pctThrottle: number;
    minutosEsperando: number;
};

const BTN =
    "inline-flex items-center justify-center gap-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50";

const miles = (n: number) => n.toLocaleString("es-AR");

export default function PlatformUsagePanel() {
    const t = useTranslations("SuperAdminPlatformUsage");
    const { instance, accounts } = useMsal();

    const [porTenant, setPorTenant] = useState<FilaIa[]>([]);
    const [porFeature, setPorFeature] = useState<FilaIa[]>([]);
    const [servicios, setServicios] = useState<ServicioAzure[]>([]);
    const [tenantsApi, setTenantsApi] = useState<TenantApi[]>([]);
    const [dias, setDias] = useState(30);
    const [horas, setHoras] = useState(24);
    const [loading, setLoading] = useState(true);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }, [instance, accounts]);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const headers = await authHeaders();
            const [rIa, rAzure] = await Promise.all([
                fetch(`/api/superadmin/platform-usage?view=ai&dias=${dias}`, { headers }),
                fetch(`/api/superadmin/platform-usage?view=azure&horas=${horas}`, { headers }),
            ]);
            const [jIa, jAzure] = await Promise.all([rIa.json(), rAzure.json()]);
            if (!rIa.ok) throw new Error(jIa.error || t("loadError"));

            setPorTenant(jIa.porTenant || []);
            setPorFeature(jIa.porFeature || []);
            setServicios(jAzure.servicios || []);
            setTenantsApi(jAzure.tenants || []);
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [authHeaders, dias, horas, t]);

    useEffect(() => { cargar(); }, [cargar]);

    const totales = useMemo(() => {
        const acc = { platform: 0, byok: 0 };
        for (const f of porTenant) acc[f.source] += f.inputTokens + f.outputTokens;
        return acc;
    }, [porTenant]);

    return (
        <div className="w-full space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-[#1B2A41] dark:text-white">{t("title")}</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("subtitle")}</p>
                </div>
                <button onClick={cargar} disabled={loading} className={BTN}>
                    <IconRefresh size={15} stroke={1.5} /> {t("refresh")}
                </button>
            </div>

            {/* ── Consumo de IA ── */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                        <IconCpu size={16} stroke={1.5} className="text-[#0078D4]" /> {t("aiTitle")}
                    </h2>
                    <select
                        value={dias}
                        onChange={(e) => setDias(Number(e.target.value))}
                        className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                        {[7, 30, 90].map((d) => <option key={d} value={d}>{t("lastDays", { days: d })}</option>)}
                    </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                        <span className="text-[11px] uppercase tracking-wider text-slate-500">{t("absorbedByUs")}</span>
                        <p className="text-lg font-bold text-[#1B2A41] dark:text-white">{miles(totales.platform)}</p>
                        <span className="text-[11px] text-slate-500">{t("tokensHint")}</span>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                        <span className="text-[11px] uppercase tracking-wider text-slate-500">{t("paidByClient")}</span>
                        <p className="text-lg font-bold text-[#1B2A41] dark:text-white">{miles(totales.byok)}</p>
                        <span className="text-[11px] text-slate-500">{t("byokHint")}</span>
                    </div>
                </div>

                {porTenant.length === 0 ? (
                    <p className="text-xs text-slate-500">{t("aiEmpty")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    <th className="text-left py-2 pr-3">{t("tenant")}</th>
                                    <th className="text-left py-2 pr-3">{t("source")}</th>
                                    <th className="text-right py-2 pr-3">{t("calls")}</th>
                                    <th className="text-right py-2 pr-3">{t("inputTokens")}</th>
                                    <th className="text-right py-2">{t("outputTokens")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {porTenant.map((f, i) => (
                                    <tr key={`${f.tenant_id}-${f.source}-${i}`} className="border-b border-slate-100 dark:border-slate-800/60">
                                        <td className="py-2 pr-3 text-slate-800 dark:text-slate-100">
                                            {f.company_name || f.tenant_id || t("noTenant")}
                                        </td>
                                        <td className="py-2 pr-3">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                f.source === "platform"
                                                    ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                                                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                            }`}>
                                                {f.source}
                                            </span>
                                        </td>
                                        <td className="py-2 pr-3 text-right text-slate-600 dark:text-slate-300">{miles(f.llamadas)}</td>
                                        <td className="py-2 pr-3 text-right text-slate-600 dark:text-slate-300">{miles(f.inputTokens)}</td>
                                        <td className="py-2 text-right text-slate-600 dark:text-slate-300">{miles(f.outputTokens)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {porFeature.length > 0 && (
                    <div className="mt-5">
                        <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">{t("byFeature")}</h3>
                        <ul className="space-y-1 text-xs">
                            {porFeature.slice(0, 8).map((f, i) => (
                                <li key={i} className="flex items-center justify-between gap-3 text-slate-600 dark:text-slate-300">
                                    <span className="truncate">
                                        {f.feature} · {f.model_name} <span className="text-slate-400">({f.source})</span>
                                    </span>
                                    <span className="shrink-0 tabular-nums">{miles(f.inputTokens + f.outputTokens)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            {/* ── Consumo de APIs de Azure ── */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                    <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                        <IconCloudDataConnection size={16} stroke={1.5} className="text-[#0078D4]" /> {t("azureTitle")}
                    </h2>
                    <select
                        value={horas}
                        onChange={(e) => setHoras(Number(e.target.value))}
                        className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                        {[6, 24, 72, 168].map((h) => <option key={h} value={h}>{t("lastHours", { hours: h })}</option>)}
                    </select>
                </div>
                <p className="text-[11px] text-slate-500 mb-4">{t("azureHint")}</p>

                {servicios.length === 0 ? (
                    <p className="text-xs text-slate-500">{t("azureEmpty")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    <th className="text-left py-2 pr-3">{t("service")}</th>
                                    <th className="text-right py-2 pr-3">{t("calls")}</th>
                                    <th className="text-right py-2 pr-3">{t("throttled")}</th>
                                    <th className="text-right py-2 pr-3">{t("pctThrottle")}</th>
                                    <th className="text-right py-2">{t("waiting")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {servicios.map((s) => (
                                    <tr key={s.servicio} className="border-b border-slate-100 dark:border-slate-800/60">
                                        <td className="py-2 pr-3 font-semibold text-slate-800 dark:text-slate-100">{s.servicio}</td>
                                        <td className="py-2 pr-3 text-right text-slate-600 dark:text-slate-300">{miles(s.llamadas)}</td>
                                        <td className="py-2 pr-3 text-right text-slate-600 dark:text-slate-300">{miles(s.throttle)}</td>
                                        <td className={`py-2 pr-3 text-right font-semibold ${
                                            s.pctThrottle >= 20 ? "text-rose-600" : s.pctThrottle >= 5 ? "text-amber-600" : "text-emerald-600"
                                        }`}>
                                            {s.pctThrottle}%
                                        </td>
                                        <td className="py-2 text-right text-slate-600 dark:text-slate-300">{s.minutosEsperando} min</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {tenantsApi.length > 0 && (
                    <div className="mt-6">
                        <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">{t("byTenant")}</h3>
                        <p className="text-[11px] text-slate-500 mb-2">{t("byTenantHint")}</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                    <tr>
                                        <th className="text-left py-2 pr-3">{t("tenant")}</th>
                                        <th className="text-right py-2 pr-3">{t("calls")}</th>
                                        <th className="text-right py-2 pr-3">{t("throttled")}</th>
                                        <th className="text-right py-2 pr-3">{t("pctThrottle")}</th>
                                        <th className="text-right py-2">{t("waiting")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tenantsApi.map((x) => (
                                        <tr key={x.tenantId} className="border-b border-slate-100 dark:border-slate-800/60">
                                            <td className="py-2 pr-3 text-slate-800 dark:text-slate-100">
                                                {x.nombre || (x.tenantId === "sin-tenant" ? t("noTenantApi") : x.tenantId)}
                                            </td>
                                            <td className="py-2 pr-3 text-right text-slate-600 dark:text-slate-300">{miles(x.llamadas)}</td>
                                            <td className="py-2 pr-3 text-right text-slate-600 dark:text-slate-300">{miles(x.throttle)}</td>
                                            <td className={`py-2 pr-3 text-right font-semibold ${
                                                x.pctThrottle >= 20 ? "text-rose-600" : x.pctThrottle >= 5 ? "text-amber-600" : "text-emerald-600"
                                            }`}>
                                                {x.pctThrottle}%
                                            </td>
                                            <td className="py-2 text-right text-slate-600 dark:text-slate-300">{x.minutosEsperando} min</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
