"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { IconAlertTriangle, IconCircleCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";

type Estado = "PENDING" | "APPROVED" | "REJECTED";

interface Solicitud {
    id: number;
    tenantId: string;
    companyName: string | null;
    tier: string | null;
    accessUntil: string | null;
    tienePaddle: boolean;
    requestedBy: string;
    reasonCode: "no-paddle-subscription" | "azure-marketplace" | "paddle-rejected";
    detail: string | null;
    status: Estado;
    createdAt: string;
    resolvedBy: string | null;
    resolvedAt: string | null;
    resolutionNote: string | null;
    cuotasPendientes: number;
    montoPendiente: string;
}

interface Props {
    onClose: () => void;
    /** Avisa la cantidad de pendientes cada vez que se carga la lista (para el contador del botón que abre este diálogo). */
    onPendingCount?: (n: number) => void;
}

/**
 * Solicitudes de cancelación que no se pudieron ejecutar solas (tenant sin suscripción de Paddle, del marketplace de Azure, o Paddle
 * rechazó la baja). El SuperAdmin las aprueba, y entonces se ejecuta la baja, o las rechaza con un motivo que se le informa al cliente.
 */
export default function CancellationRequestsDialog({ onClose, onPendingCount }: Props) {
    const t = useTranslations("CancellationRequests");
    const locale = useLocale();
    const { instance, accounts } = useMsal();

    const [solicitudes, setSolicitudes] = useState<Solicitud[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resultado, setResultado] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<number | null>(null);
    const [nota, setNota] = useState("");
    const [fecha, setFecha] = useState("");
    const [omitirPaddle, setOmitirPaddle] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const headers = useCallback(async (): Promise<Record<string, string>> => {
        if (accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]).catch(() => "");
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const cargar = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch("/api/superadmin/cancellation-requests", { headers: await headers() });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || t("loadError"));
            setSolicitudes(json.solicitudes);
            onPendingCount?.(json.solicitudes.filter((s: Solicitud) => s.status === "PENDING").length);
        } catch (e) {
            setError(errorMessage(e));
            setSolicitudes([]);
        }
    }, [headers, onPendingCount, t]);

    useEffect(() => {
        cargar();
    }, [cargar]);

    const abrir = (s: Solicitud) => {
        setAbierta(s.id);
        setNota("");
        setFecha("");
        setOmitirPaddle(false);
        setError(null);
        setResultado(null);
    };

    const resolver = async (s: Solicitud, decision: "approve" | "reject") => {
        setEnviando(true);
        setError(null);
        try {
            const res = await fetch(`/api/superadmin/cancellation-requests/${s.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await headers()) },
                body: JSON.stringify({ decision, note: nota, effectiveDate: fecha || undefined, skipPaddle: omitirPaddle }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || t("resolveError"));
            setResultado(decision === "approve" ? t("approved") : t("rejected"));
            setAbierta(null);
            await cargar();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setEnviando(false);
        }
    };

    const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : "—");

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("title")}>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">{t("title")}</h3>
                    <button type="button" onClick={onClose} aria-label={t("close")} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded">
                        <IconX size={18} />
                    </button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{t("intro")}</p>

                {resultado && (
                    <div className="flex gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-900 dark:text-emerald-200" role="status">
                        <IconCircleCheck size={16} className="shrink-0 mt-0.5" />
                        <span>{resultado}</span>
                    </div>
                )}
                {error && (
                    <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-200" role="alert">
                        {error}
                    </div>
                )}

                {solicitudes === null ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <IconLoader2 size={14} className="animate-spin" /> {t("loading")}
                    </div>
                ) : solicitudes.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("empty")}</p>
                ) : (
                    <ul className="space-y-3">
                        {solicitudes.map((s) => (
                            <li key={s.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 text-xs text-slate-800 dark:text-slate-200">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100">{s.companyName || s.tenantId}</p>
                                        <p className="font-mono text-[11px] text-slate-500">{s.tenantId}{s.tier ? ` · ${s.tier}` : ""}</p>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.status === "PENDING" ? "bg-amber-50 text-amber-700 border-amber-200" : s.status === "APPROVED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                                        {t(`status.${s.status}`)}
                                    </span>
                                </div>
                                <p>{t("requestedBy", { email: s.requestedBy, date: fechaCorta(s.createdAt) })}</p>
                                <p><strong>{t("whyManual")}:</strong> {t(`reason.${s.reasonCode}`)}</p>
                                {s.detail && <p className="text-slate-600 dark:text-slate-400">{s.detail}</p>}
                                {s.status === "PENDING" && s.cuotasPendientes > 0 && (
                                    <p className="flex gap-1.5 text-amber-800 dark:text-amber-300">
                                        <IconAlertTriangle size={14} className="shrink-0 mt-0.5" />
                                        <span>{t("commissionsAffected", { count: s.cuotasPendientes, amount: s.montoPendiente })}</span>
                                    </p>
                                )}
                                {s.status !== "PENDING" && (
                                    <p className="text-slate-600 dark:text-slate-400">
                                        {t("resolvedBy", { email: s.resolvedBy ?? "—", date: fechaCorta(s.resolvedAt) })}
                                        {s.resolutionNote ? ` — ${s.resolutionNote}` : ""}
                                    </p>
                                )}

                                {s.status === "PENDING" && abierta !== s.id && (
                                    <button type="button" onClick={() => abrir(s)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
                                        {t("review")}
                                    </button>
                                )}

                                {s.status === "PENDING" && abierta === s.id && (
                                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                        <label className="block font-semibold" htmlFor={`note-${s.id}`}>{t("noteLabel")}</label>
                                        <textarea
                                            id={`note-${s.id}`}
                                            value={nota}
                                            onChange={(e) => setNota(e.target.value)}
                                            maxLength={1000}
                                            rows={2}
                                            placeholder={t("notePlaceholder")}
                                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                        />
                                        {!s.tienePaddle ? (
                                            <div>
                                                <label className="block font-semibold" htmlFor={`date-${s.id}`}>{s.accessUntil ? t("effectiveDateOptional") : t("effectiveDateRequired")}</label>
                                                <input id={`date-${s.id}`} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5" />
                                                <p className="text-[11px] text-slate-500 mt-1">{s.accessUntil ? t("effectiveDateHintCurrent", { date: fechaCorta(s.accessUntil) }) : t("effectiveDateHintNone")}</p>
                                            </div>
                                        ) : (
                                            <label className="flex items-center gap-2">
                                                <input type="checkbox" checked={omitirPaddle} onChange={(e) => setOmitirPaddle(e.target.checked)} className="rounded border-slate-300" />
                                                <span>{t("skipPaddle")}</span>
                                            </label>
                                        )}
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={() => setAbierta(null)} disabled={enviando} className="px-3 py-1.5 rounded-lg font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">
                                                {t("back")}
                                            </button>
                                            <button type="button" onClick={() => resolver(s, "reject")} disabled={enviando || nota.trim().length < 5} title={t("rejectNeedsNote")} className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50">
                                                {t("reject")}
                                            </button>
                                            <button type="button" onClick={() => resolver(s, "approve")} disabled={enviando || (!s.tienePaddle && !s.accessUntil && !fecha)} className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
                                                {enviando && <IconLoader2 size={13} className="animate-spin" />}
                                                <span>{t("approve")}</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                        {t("close")}
                    </button>
                </div>
            </div>
        </div>
    );
}
