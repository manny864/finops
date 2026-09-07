"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { toast } from "sonner";
import {
    IconUsersGroup,
    IconCopy,
    IconCheck,
    IconPlus,
    IconCash,
    IconLink,
    IconRefresh,
} from "@tabler/icons-react";

type Afiliado = {
    id: string;
    name: string;
    email: string;
    referralCode: string;
    commissionPct: string;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
    payoutMethod: string | null;
    payoutReference: string | null;
    tenantsReferidos: number;
    pendienteDePago: string;
    yaPagado: string;
    moneda: string | null;
};

type Comision = {
    id: number;
    affiliateName: string;
    tenantId: string;
    companyName: string | null;
    transactionId: string;
    baseAmount: string;
    currency: string;
    commissionPct: string;
    commissionAmount: string;
    status: string;
    billedAt: string | null;
};

const ESTADO_CLASE: Record<string, string> = {
    PENDING: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
    APPROVED: "bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-blue-300",
    PAID: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
    REVERSED: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
    CANCELLED: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
};

/**
 * Programa de afiliados, lado SuperAdmin: alta de colaboradores, su link de
 * referido y la liquidación de comisiones.
 *
 * No hay panel para el afiliado: el acuerdo se maneja fuera de la plataforma y
 * el afiliado no tiene identidad en Entra ID, así que darle acceso pedía un
 * subsistema de auth propio. Acá se copia su link y se le informan sus números.
 *
 * Los montos se muestran como llegan del servidor (string desde una columna
 * DECIMAL) y NO se pasan por Number: son plata y el redondeo del cálculo ya lo
 * hizo el servicio con Decimal.
 */
export default function AffiliatesPanel() {
    const t = useTranslations("SuperAdminAffiliates");
    const { instance, accounts } = useMsal();

    const [afiliados, setAfiliados] = useState<Afiliado[]>([]);
    const [comisiones, setComisiones] = useState<Comision[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiado, setCopiado] = useState<string | null>(null);
    const [seleccion, setSeleccion] = useState<number[]>([]);
    const [mostrarAlta, setMostrarAlta] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [alta, setAlta] = useState({ name: "", email: "", referralCode: "", commissionPct: "20", payoutMethod: "", payoutReference: "" });

    const cabeceras = useCallback(async () => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (accounts[0]) {
            const token = await getFreshIdToken(instance, accounts[0]);
            if (token) headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    }, [instance, accounts]);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const headers = await cabeceras();
            const [ra, rc] = await Promise.all([
                fetch("/api/superadmin/affiliates", { headers }),
                fetch("/api/superadmin/affiliates?view=commissions", { headers }),
            ]);
            if (!ra.ok) throw new Error((await ra.json().catch(() => ({}))).error || `HTTP ${ra.status}`);
            if (!rc.ok) throw new Error((await rc.json().catch(() => ({}))).error || `HTTP ${rc.status}`);
            setAfiliados((await ra.json()).affiliates || []);
            setComisiones((await rc.json()).commissions || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setCargando(false);
        }
    }, [cabeceras]);

    useEffect(() => { void cargar(); }, [cargar]);

    const linkDe = (codigo: string) =>
        `${typeof window !== "undefined" ? window.location.origin : ""}/pricing?ref=${encodeURIComponent(codigo)}`;

    const copiarLink = async (codigo: string) => {
        try {
            await navigator.clipboard.writeText(linkDe(codigo));
            setCopiado(codigo);
            toast.success(t("linkCopied"));
            setTimeout(() => setCopiado(null), 2000);
        } catch {
            toast.error(t("linkCopyFailed"));
        }
    };

    const crear = async () => {
        setGuardando(true);
        try {
            const headers = await cabeceras();
            const res = await fetch("/api/superadmin/affiliates", {
                method: "POST",
                headers,
                body: JSON.stringify({ action: "create", ...alta, commissionPct: alta.commissionPct }),
            });
            const cuerpo = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(cuerpo.error || `HTTP ${res.status}`);
            toast.success(t("affiliateCreated"));
            setMostrarAlta(false);
            setAlta({ name: "", email: "", referralCode: "", commissionPct: "20", payoutMethod: "", payoutReference: "" });
            await cargar();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setGuardando(false);
        }
    };

    const marcar = async (status: "APPROVED" | "PAID") => {
        if (seleccion.length === 0) return;
        try {
            const headers = await cabeceras();
            const res = await fetch("/api/superadmin/affiliates", {
                method: "POST",
                headers,
                body: JSON.stringify({ action: "setStatus", ids: seleccion, status }),
            });
            const cuerpo = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(cuerpo.error || `HTTP ${res.status}`);
            toast.success(t("commissionsUpdated", { count: cuerpo.updated ?? 0 }));
            setSeleccion([]);
            await cargar();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        }
    };

    // Las comisiones ya liquidadas no se re-seleccionan: el endpoint las excluye
    // igual, así la UI no ofrece una acción que el servidor va a ignorar.
    const seleccionables = useMemo(
        () => comisiones.filter((c) => c.status !== "PAID" && c.status !== "REVERSED" && c.status !== "CANCELLED"),
        [comisiones]
    );

    return (
        <div className="space-y-6">
            <section className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                            <IconUsersGroup className="w-5 h-5 text-[#0054A6]" />
                            {t("title")}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => void cargar()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                            <IconRefresh className="w-4 h-4" />
                            {t("refresh")}
                        </button>
                        <button
                            onClick={() => setMostrarAlta((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-[#0054A6] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        >
                            <IconPlus className="w-4 h-4" />
                            {t("newAffiliate")}
                        </button>
                    </div>
                </div>

                {mostrarAlta && (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                        {([
                            ["name", t("fieldName"), "text"],
                            ["email", t("fieldEmail"), "email"],
                            ["referralCode", t("fieldCode"), "text"],
                            ["commissionPct", t("fieldPct"), "number"],
                            ["payoutMethod", t("fieldPayoutMethod"), "text"],
                            ["payoutReference", t("fieldPayoutReference"), "text"],
                        ] as const).map(([campo, etiqueta, tipo]) => (
                            <label key={campo} className="block">
                                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{etiqueta}</span>
                                <input
                                    type={tipo}
                                    value={(alta as any)[campo]}
                                    onChange={(e) => setAlta((s) => ({ ...s, [campo]: e.target.value }))}
                                    className="mt-1 w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0054A6]"
                                />
                            </label>
                        ))}
                        <div className="md:col-span-2 lg:col-span-3 flex items-center justify-end gap-2">
                            <button
                                onClick={() => setMostrarAlta(false)}
                                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={() => void crear()}
                                disabled={guardando || !alta.name || !alta.email || !alta.referralCode}
                                className="rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 px-4 py-2 text-xs font-bold text-[#0054A6] disabled:opacity-40"
                            >
                                {guardando ? t("saving") : t("save")}
                            </button>
                        </div>
                    </div>
                )}
            </section>

            {error && (
                <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Afiliados */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("affiliatesTitle")}</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                            <tr>
                                <th className="px-4 py-2 font-semibold">{t("colAffiliate")}</th>
                                <th className="px-4 py-2 font-semibold">{t("colCode")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("colPct")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("colReferrals")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("colPending")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("colPaid")}</th>
                                <th className="px-4 py-2 font-semibold">{t("colStatus")}</th>
                                <th className="px-4 py-2 font-semibold">{t("colLink")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                            {cargando && (
                                <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">{t("loading")}</td></tr>
                            )}
                            {!cargando && afiliados.length === 0 && (
                                <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">{t("noAffiliates")}</td></tr>
                            )}
                            {afiliados.map((a) => (
                                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <td className="px-4 py-2">
                                        <div className="font-semibold text-slate-900 dark:text-white">{a.name}</div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{a.email}</div>
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{a.referralCode}</td>
                                    <td className="px-4 py-2 text-right text-slate-700 dark:text-slate-300">{a.commissionPct}%</td>
                                    <td className="px-4 py-2 text-right text-slate-700 dark:text-slate-300">{a.tenantsReferidos}</td>
                                    <td className="px-4 py-2 text-right font-semibold text-[#0054A6] dark:text-blue-400 font-mono">
                                        {a.pendienteDePago} {a.moneda || ""}
                                    </td>
                                    <td className="px-4 py-2 text-right text-emerald-700 dark:text-emerald-400 font-mono">
                                        {a.yaPagado} {a.moneda || ""}
                                    </td>
                                    <td className="px-4 py-2">
                                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${a.status === "ACTIVE" ? ESTADO_CLASE.PAID : ESTADO_CLASE.CANCELLED}`}>
                                            {t(`status_${a.status}`)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2">
                                        <button
                                            onClick={() => void copiarLink(a.referralCode)}
                                            title={linkDe(a.referralCode)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50 text-[11px] font-semibold transition-colors"
                                        >
                                            {copiado === a.referralCode ? <IconCheck className="w-3.5 h-3.5 text-emerald-600" /> : <IconLink className="w-3.5 h-3.5" />}
                                            {copiado === a.referralCode ? t("copied") : t("copyLink")}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Comisiones */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("commissionsTitle")}</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t("selectedCount", { count: seleccion.length })}
                        </span>
                        <button
                            onClick={() => void marcar("APPROVED")}
                            disabled={seleccion.length === 0}
                            className="rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-[#0054A6] disabled:opacity-40"
                        >
                            {t("approve")}
                        </button>
                        <button
                            onClick={() => void marcar("PAID")}
                            disabled={seleccion.length === 0}
                            className="inline-flex items-center gap-1 rounded-xl border border-emerald-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 disabled:opacity-40"
                        >
                            <IconCash className="w-3.5 h-3.5" />
                            {t("markPaid")}
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                            <tr>
                                <th className="px-4 py-2 w-8">
                                    <input
                                        type="checkbox"
                                        aria-label={t("selectAll")}
                                        checked={seleccionables.length > 0 && seleccion.length === seleccionables.length}
                                        onChange={(e) => setSeleccion(e.target.checked ? seleccionables.map((c) => c.id) : [])}
                                    />
                                </th>
                                <th className="px-4 py-2 font-semibold">{t("colAffiliate")}</th>
                                <th className="px-4 py-2 font-semibold">{t("colTenant")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("colBase")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("colPct")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("colCommission")}</th>
                                <th className="px-4 py-2 font-semibold">{t("colStatus")}</th>
                                <th className="px-4 py-2 font-semibold">{t("colBilledAt")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                            {!cargando && comisiones.length === 0 && (
                                <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">{t("noCommissions")}</td></tr>
                            )}
                            {comisiones.map((c) => {
                                const liquidable = c.status !== "PAID" && c.status !== "REVERSED" && c.status !== "CANCELLED";
                                return (
                                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                        <td className="px-4 py-2">
                                            <input
                                                type="checkbox"
                                                aria-label={t("selectRow")}
                                                disabled={!liquidable}
                                                checked={seleccion.includes(c.id)}
                                                onChange={(e) =>
                                                    setSeleccion((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))
                                                }
                                            />
                                        </td>
                                        <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{c.affiliateName}</td>
                                        <td className="px-4 py-2">
                                            <div className="text-slate-800 dark:text-slate-200">{c.companyName || c.tenantId}</div>
                                            <div className="text-[10px] font-mono text-slate-400">{c.transactionId}</div>
                                        </td>
                                        <td className="px-4 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{c.baseAmount} {c.currency}</td>
                                        <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{c.commissionPct}%</td>
                                        <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900 dark:text-white">{c.commissionAmount} {c.currency}</td>
                                        <td className="px-4 py-2">
                                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ESTADO_CLASE[c.status] || ESTADO_CLASE.CANCELLED}`}>
                                                {t(`commission_${c.status}`)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                                            {c.billedAt ? c.billedAt.slice(0, 10) : "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
