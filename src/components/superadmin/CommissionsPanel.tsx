"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { toast } from "sonner";
import { errorMessage } from "@/lib/apiErrors";
import {
    IconCash,
    IconRefresh,
    IconPlus,
    IconDownload,
    IconCheck,
    IconUserDollar,
} from "@tabler/icons-react";

/**
 * Libro mayor de comisiones y liquidación (MEJ-14, criterios 2 a 4).
 *
 * Afiliados y comerciales en la MISMA pantalla porque están en la misma tabla:
 * quien liquida necesita ver cuánto se le debe a una persona, no cuánto se le
 * debe por cada programa. Alguien que es afiliado y comercial a la vez aparece
 * con sus dos renglones acá y en ningún otro lado.
 *
 * Los montos se muestran tal como llegan (string de una columna DECIMAL) y NO
 * pasan por Number: son plata, y el redondeo ya lo hizo el servicio con Decimal.
 */

type Comision = {
    id: number;
    beneficiaryType: "affiliate" | "sales_rep";
    beneficiaryName: string | null;
    tenantId: string;
    companyName: string | null;
    transactionId: string;
    baseAmount: string;
    currency: string;
    commissionPct: string;
    commissionAmount: string;
    installment: string | null;
    status: string;
    paymentDueDate: string | null;
    paidAt: string | null;
    paymentReference: string | null;
};

type Resumen = {
    beneficiaryType: "affiliate" | "sales_rep";
    beneficiaryId: string;
    name: string | null;
    email: string | null;
    currency: string | null;
    exigible: string;
    pendiente: string;
    pagado: string;
};

type Comercial = {
    id: string;
    name: string;
    email: string;
    commissionPct: string;
    status: string;
    ventas: number;
};

const ESTADO_CLASE: Record<string, string> = {
    PENDING: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
    DUE: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
    APPROVED: "bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-blue-300",
    PAID: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
    REVERSED: "bg-slate-100 dark:bg-slate-800 text-slate-500",
    CANCELLED: "bg-slate-100 dark:bg-slate-800 text-slate-500",
};

const BTN_PRIMARY =
    "inline-flex items-center justify-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50";
const BTN_NEUTRAL =
    "inline-flex items-center justify-center gap-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50";

export default function CommissionsPanel() {
    const t = useTranslations("SuperAdminCommissions");
    const { instance, accounts } = useMsal();

    const [libro, setLibro] = useState<Comision[]>([]);
    const [resumen, setResumen] = useState<Resumen[]>([]);
    const [comerciales, setComerciales] = useState<Comercial[]>([]);
    const [loading, setLoading] = useState(true);
    const [filtroTipo, setFiltroTipo] = useState<"" | "affiliate" | "sales_rep">("");
    const [filtroEstado, setFiltroEstado] = useState("");
    const [seleccion, setSeleccion] = useState<number[]>([]);
    const [pagoAbierto, setPagoAbierto] = useState(false);
    const [pagoFecha, setPagoFecha] = useState(() => new Date().toISOString().slice(0, 10));
    const [pagoRef, setPagoRef] = useState("");
    const [pagoNotas, setPagoNotas] = useState("");
    const [guardando, setGuardando] = useState(false);

    const [nuevoNombre, setNuevoNombre] = useState("");
    const [nuevoEmail, setNuevoEmail] = useState("");
    const [nuevoPct, setNuevoPct] = useState("20");
    const [asignarTenant, setAsignarTenant] = useState("");
    const [asignarRep, setAsignarRep] = useState("");

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
            const query = new URLSearchParams({ view: "ledger" });
            if (filtroTipo) query.set("type", filtroTipo);
            if (filtroEstado) query.set("status", filtroEstado);

            const [resLibro, resResumen, resReps] = await Promise.all([
                fetch(`/api/superadmin/commissions?${query}`, { headers }),
                fetch("/api/superadmin/commissions?view=summary", { headers }),
                fetch("/api/superadmin/commissions?view=reps", { headers }),
            ]);
            const [jLibro, jResumen, jReps] = await Promise.all([resLibro.json(), resResumen.json(), resReps.json()]);
            if (!resLibro.ok) throw new Error(jLibro.error || t("loadError"));

            setLibro(jLibro.ledger || []);
            setResumen(jResumen.summary || []);
            setComerciales(jReps.reps || []);
            setSeleccion([]);
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [authHeaders, filtroTipo, filtroEstado, t]);

    useEffect(() => { cargar(); }, [cargar]);

    const accionar = async (body: Record<string, unknown>, exito: string) => {
        setGuardando(true);
        try {
            const res = await fetch("/api/superadmin/commissions", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await authHeaders()) },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || t("actionError"));
            toast.success(exito);
            await cargar();
            return true;
        } catch (e) {
            toast.error(errorMessage(e));
            return false;
        } finally {
            setGuardando(false);
        }
    };

    const pagar = async () => {
        const ok = await accionar(
            { action: "pay", ids: seleccion, paidAt: pagoFecha, reference: pagoRef || null, notes: pagoNotas || null },
            t("paidOk", { count: seleccion.length })
        );
        if (ok) {
            setPagoAbierto(false);
            setPagoRef("");
            setPagoNotas("");
        }
    };

    const descargarCsv = async () => {
        try {
            const query = new URLSearchParams({ view: "ledger", format: "csv" });
            if (filtroTipo) query.set("type", filtroTipo);
            if (filtroEstado) query.set("status", filtroEstado);
            const res = await fetch(`/api/superadmin/commissions?${query}`, { headers: await authHeaders() });
            if (!res.ok) throw new Error(t("csvError"));
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `comisiones-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(errorMessage(e));
        }
    };

    // Sólo se puede liquidar lo que todavía no se pagó ni se anuló.
    const liquidables = useMemo(
        () => libro.filter((c) => ["PENDING", "DUE", "APPROVED"].includes(c.status)).map((c) => c.id),
        [libro]
    );

    const totalSeleccionado = useMemo(() => {
        const elegidas = libro.filter((c) => seleccion.includes(c.id));
        const moneda = elegidas[0]?.currency || "";
        // Suma en centésimos enteros: sumar floats de plata es cómo aparece un
        // centavo de la nada en una liquidación.
        const centesimos = elegidas.reduce((acc, c) => acc + Math.round(Number(c.commissionAmount) * 10000), 0);
        return elegidas.length ? `${(centesimos / 10000).toFixed(2)} ${moneda}` : "";
    }, [libro, seleccion]);

    return (
        <div className="w-full">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <IconCash size={32} stroke={1.5} className="text-[#0078D4]" />
                    <div>
                        <h1 className="text-xl font-bold text-[#1B2A41] dark:text-white">{t("title")}</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("subtitle")}</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={descargarCsv} className={BTN_NEUTRAL}>
                        <IconDownload size={16} stroke={1.5} /> {t("exportCsv")}
                    </button>
                    <button onClick={cargar} disabled={loading} className={BTN_NEUTRAL}>
                        <IconRefresh size={16} stroke={1.5} /> {t("refresh")}
                    </button>
                </div>
            </div>

            {/* Cuánto se le debe a cada uno */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 mb-6">
                <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white mb-3">{t("summaryTitle")}</h2>
                {resumen.length === 0 ? (
                    <p className="text-xs text-slate-500">{t("summaryEmpty")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    <th className="text-left py-2 pr-3">{t("beneficiary")}</th>
                                    <th className="text-left py-2 pr-3">{t("type")}</th>
                                    <th className="text-right py-2 pr-3">{t("due")}</th>
                                    <th className="text-right py-2 pr-3">{t("pending")}</th>
                                    <th className="text-right py-2">{t("paid")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {resumen.map((r) => (
                                    <tr key={`${r.beneficiaryType}-${r.beneficiaryId}`} className="border-b border-slate-100 dark:border-slate-800/60">
                                        <td className="py-2 pr-3">
                                            <span className="font-semibold text-slate-800 dark:text-slate-100">{r.name || r.beneficiaryId}</span>
                                            {r.email && <span className="block text-[11px] text-slate-500">{r.email}</span>}
                                        </td>
                                        <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                                            {r.beneficiaryType === "affiliate" ? t("typeAffiliate") : t("typeSalesRep")}
                                        </td>
                                        <td className="py-2 pr-3 text-right font-semibold text-amber-700 dark:text-amber-300">
                                            {r.exigible} {r.currency}
                                        </td>
                                        <td className="py-2 pr-3 text-right text-slate-600 dark:text-slate-300">
                                            {r.pendiente} {r.currency}
                                        </td>
                                        <td className="py-2 text-right text-emerald-700 dark:text-emerald-300">
                                            {r.pagado} {r.currency}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Alta de comercial y atribución de la venta */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                    <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white mb-1 flex items-center gap-2">
                        <IconUserDollar size={16} stroke={1.5} className="text-[#0078D4]" /> {t("newRepTitle")}
                    </h2>
                    <p className="text-[11px] text-slate-500 mb-3">{t("newRepHint")}</p>
                    <div className="space-y-2">
                        <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder={t("repName")}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950" />
                        <input value={nuevoEmail} onChange={(e) => setNuevoEmail(e.target.value)} placeholder={t("repEmail")}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950" />
                        <input value={nuevoPct} onChange={(e) => setNuevoPct(e.target.value)} placeholder={t("repPct")} inputMode="decimal"
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950" />
                        <button
                            className={BTN_PRIMARY}
                            disabled={guardando || !nuevoNombre || !nuevoEmail}
                            onClick={async () => {
                                const ok = await accionar(
                                    { action: "createRep", name: nuevoNombre, email: nuevoEmail, commissionPct: nuevoPct },
                                    t("repCreated")
                                );
                                if (ok) { setNuevoNombre(""); setNuevoEmail(""); setNuevoPct("20"); }
                            }}
                        >
                            <IconPlus size={16} stroke={2} /> {t("createRep")}
                        </button>
                    </div>

                    {comerciales.length > 0 && (
                        <ul className="mt-4 space-y-1.5 text-xs">
                            {comerciales.map((c) => (
                                <li key={c.id} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                                    <span className="truncate">{c.name} · {c.commissionPct}%</span>
                                    <span className="shrink-0 text-[11px] text-slate-500">{t("repSales", { count: c.ventas })}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                    <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white mb-1">{t("assignTitle")}</h2>
                    <p className="text-[11px] text-slate-500 mb-3">{t("assignHint")}</p>
                    <div className="space-y-2">
                        <input value={asignarTenant} onChange={(e) => setAsignarTenant(e.target.value)} placeholder={t("assignTenant")}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950" />
                        <select value={asignarRep} onChange={(e) => setAsignarRep(e.target.value)}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950">
                            <option value="">{t("assignPick")}</option>
                            {comerciales.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button
                            className={BTN_PRIMARY}
                            disabled={guardando || !asignarTenant || !asignarRep}
                            onClick={async () => {
                                const ok = await accionar(
                                    { action: "assignRep", tenantId: asignarTenant, salesRepId: asignarRep },
                                    t("assigned")
                                );
                                if (ok) { setAsignarTenant(""); setAsignarRep(""); }
                            }}
                        >
                            {t("assign")}
                        </button>
                    </div>
                </div>
            </div>

            {/* El libro */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <h2 className="text-sm font-bold text-[#1B2A41] dark:text-white">{t("ledgerTitle")}</h2>
                    <div className="flex flex-wrap gap-2">
                        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as any)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950">
                            <option value="">{t("filterAllTypes")}</option>
                            <option value="sales_rep">{t("typeSalesRep")}</option>
                            <option value="affiliate">{t("typeAffiliate")}</option>
                        </select>
                        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950">
                            <option value="">{t("filterAllStatus")}</option>
                            {["DUE", "PENDING", "PAID", "CANCELLED", "REVERSED"].map((e) => <option key={e} value={e}>{e}</option>)}
                        </select>
                        <button
                            className={BTN_PRIMARY}
                            disabled={seleccion.length === 0}
                            onClick={() => setPagoAbierto(true)}
                        >
                            <IconCheck size={16} stroke={2} /> {t("markPaid", { count: seleccion.length })}
                        </button>
                    </div>
                </div>

                {loading ? (
                    <p className="text-xs text-slate-500">{t("loading")}</p>
                ) : libro.length === 0 ? (
                    <p className="text-xs text-slate-500">{t("ledgerEmpty")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    <th className="py-2 pr-2 w-8">
                                        <input
                                            type="checkbox"
                                            checked={seleccion.length > 0 && seleccion.length === liquidables.length}
                                            onChange={(e) => setSeleccion(e.target.checked ? liquidables : [])}
                                        />
                                    </th>
                                    <th className="text-left py-2 pr-3">{t("beneficiary")}</th>
                                    <th className="text-left py-2 pr-3">{t("tenant")}</th>
                                    <th className="text-left py-2 pr-3">{t("installment")}</th>
                                    <th className="text-right py-2 pr-3">{t("amount")}</th>
                                    <th className="text-left py-2 pr-3">{t("dueDate")}</th>
                                    <th className="text-left py-2">{t("status")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {libro.map((c) => {
                                    const liquidable = ["PENDING", "DUE", "APPROVED"].includes(c.status);
                                    return (
                                        <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800/60">
                                            <td className="py-2 pr-2">
                                                <input
                                                    type="checkbox"
                                                    disabled={!liquidable}
                                                    checked={seleccion.includes(c.id)}
                                                    onChange={(e) =>
                                                        setSeleccion((prev) =>
                                                            e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td className="py-2 pr-3">
                                                <span className="font-semibold text-slate-800 dark:text-slate-100">{c.beneficiaryName || "—"}</span>
                                                <span className="block text-[11px] text-slate-500">
                                                    {c.beneficiaryType === "affiliate" ? t("typeAffiliate") : t("typeSalesRep")}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{c.companyName || c.tenantId}</td>
                                            <td className="py-2 pr-3 text-slate-500">{c.installment || "—"}</td>
                                            <td className="py-2 pr-3 text-right font-semibold text-slate-800 dark:text-slate-100">
                                                {c.commissionAmount} {c.currency}
                                                <span className="block text-[11px] font-normal text-slate-500">
                                                    {c.commissionPct}% · {c.baseAmount}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{c.paymentDueDate || "—"}</td>
                                            <td className="py-2">
                                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${ESTADO_CLASE[c.status] || ""}`}>
                                                    {c.status}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {pagoAbierto && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !guardando && setPagoAbierto(false)} />
                    <div className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6">
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-white mb-1">{t("payTitle")}</h3>
                        <p className="text-xs text-slate-500 mb-4">{t("payHint", { count: seleccion.length, total: totalSeleccionado })}</p>

                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{t("payDate")}</label>
                        <input type="date" value={pagoFecha} onChange={(e) => setPagoFecha(e.target.value)}
                            className="w-full mb-3 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950" />

                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{t("payReference")}</label>
                        <input value={pagoRef} onChange={(e) => setPagoRef(e.target.value)} placeholder={t("payReferencePlaceholder")}
                            className="w-full mb-3 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950" />

                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{t("payNotes")}</label>
                        <textarea value={pagoNotas} onChange={(e) => setPagoNotas(e.target.value)} rows={2}
                            className="w-full mb-4 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950" />

                        <div className="flex justify-end gap-2">
                            <button className={BTN_NEUTRAL} disabled={guardando} onClick={() => setPagoAbierto(false)}>{t("cancel")}</button>
                            <button className={BTN_PRIMARY} disabled={guardando} onClick={pagar}>{t("payConfirm")}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
