"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, FileText, Loader2, ReceiptText, RefreshCw, UploadCloud } from "lucide-react";
import MockBanner from "@/components/MockBanner";
import { useTenant } from "@/components/TenantProvider";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/demoTenant";
import {
    EXTERNAL_SPEND_DOC_TYPES, EXTERNAL_SPEND_MAX_BYTES, EXTERNAL_SPEND_MAX_PAGES,
    type Commitment, type ExternalSpendDocType, type ExternalSpendDocument, type ExternalSpendDocumentDetail,
    type ExternalSpendHeader, type ExternalSpendLine, type ExternalSpendOverview,
} from "@/types/externalSpend.types";
import ReviewDrawer from "./components/ReviewDrawer";
import CommitmentsSection, { noticeDeadline, type CommitmentPayload } from "./components/CommitmentsSection";
import { API, ApiError, StatusBadge, cardClass, formatMoney, inputClass, primaryButton, secondaryButton } from "./components/externalSpendUi";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.tif,.tiff";
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Gasto externo (Fase 4 de la propuesta de IA): facturas y contratos de
 * proveedores que Document Intelligence lee y una persona revisa. Lo aprobado
 * se reporta siempre aparte, como gasto externo: nunca entra en el costo de
 * Azure ni en la detección de anomalías.
 */
export default function ExternalSpendPage() {
    const t = useTranslations("ExternalSpend");
    const locale = useLocale();
    const { instance, accounts } = useMsal();
    const { selectedTenant, userRole, systemRole } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const isMock = isMockTenant(tenantId);
    // Sin cuenta MSAL y sin tenant demo no se despacha nada (evita el 401 mientras resuelve la sesión).
    const canFetch = Boolean(tenantId) && tenantId !== "default" && (isMock || accounts.length > 0);
    // La garantía está en el servidor (Admin u Owner); esto sólo evita ofrecer lo que va a rechazar.
    const canWrite = isMock || userRole === "Admin" || userRole === "Owner" || systemRole === "SUPERADMIN";

    const [overview, setOverview] = useState<ExternalSpendOverview | null>(null);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [docType, setDocType] = useState<ExternalSpendDocType>("invoice");
    const [file, setFile] = useState<File | null>(null);
    // `version` remonta el drawer con cada detalle nuevo, así arranca de lo guardado.
    const [selected, setSelected] = useState<{ doc: ExternalSpendDocumentDetail; version: number } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [isMock, accounts, instance]);

    const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
        const res = await fetch(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(await authHeaders()) } });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, body?.reason, body?.error);
        return body as T;
    }, [authHeaders]);

    const errorText = useCallback((e: unknown): string => {
        if (e instanceof ApiError) {
            if (e.reason) return t(`error_${e.reason}`);
            if (e.status === 403) return t("readOnlyNote");
            if (e.status === 410) return t("fileGone");
        }
        return t("genericError");
    }, [t]);

    // Con .then y no con await: así el efecto de abajo no setea estado de forma síncrona (react-hooks/set-state-in-effect).
    const load = useCallback((): Promise<void> => {
        if (!canFetch) return Promise.resolve();
        return request<ExternalSpendOverview>(`${API}?tenantId=${encodeURIComponent(tenantId)}`).then(
            (data) => setOverview(data),
            (e) => {
                toast.error(e instanceof ApiError && e.reason ? errorText(e) : t("loadError"));
            },
        );
    }, [canFetch, request, tenantId, errorText, t]);

    useEffect(() => {
        void load();
    }, [load]);

    // El cron analiza cada 5 minutos: mientras haya documentos en análisis, la lista se refresca sola.
    const pending = overview?.documents.some((d) => d.status === "uploaded" || d.status === "extracting") ?? false;
    useEffect(() => {
        if (!pending || isMock) return;
        const timer = setInterval(() => void load(), 30_000);
        return () => clearInterval(timer);
    }, [pending, isMock, load]);

    const showDoc = (doc: ExternalSpendDocumentDetail) => setSelected((prev) => ({ doc, version: (prev?.version ?? 0) + 1 }));

    const openDoc = async (id: number) => {
        try {
            showDoc(await request<ExternalSpendDocumentDetail>(`${API}/${id}?tenantId=${encodeURIComponent(tenantId)}`));
        } catch (e) {
            toast.error(errorText(e));
        }
    };

    /** Las escrituras: en la demo no se manda nada. */
    const write = async (fn: () => Promise<void>): Promise<boolean> => {
        if (isMock) {
            toast.info(t("demoNote"));
            return false;
        }
        setBusy(true);
        try {
            await fn();
            return true;
        } catch (e) {
            toast.error(errorText(e));
            return false;
        } finally {
            setBusy(false);
        }
    };

    const upload = async () => {
        if (!file) return;
        if (isMock) {
            toast.info(t("demoNote"));
            return;
        }
        if (accounts.length === 0) {
            toast.error(t("sessionNotReady"));
            return;
        }
        if (file.size > EXTERNAL_SPEND_MAX_BYTES) {
            toast.error(t("error_file_too_large"));
            return;
        }
        setUploading(true);
        try {
            const form = new FormData();
            form.append("tenantId", tenantId);
            form.append("type", docType);
            form.append("file", file);
            const doc = await request<ExternalSpendDocument>(API, { method: "POST", body: form });
            if (doc.status === "needs_review") toast.success(t("uploadedReview"));
            else if (doc.status === "failed") toast.error(t("uploadedFailed"));
            else toast.info(t("uploadedPending"));
            setFile(null);
            if (fileRef.current) fileRef.current.value = "";
            await load();
            if (doc.status === "needs_review") await openDoc(doc.id);
        } catch (e) {
            toast.error(errorText(e));
        } finally {
            setUploading(false);
        }
    };

    const saveReview = (id: number, review: { header: ExternalSpendHeader; lines: ExternalSpendLine[] }) =>
        write(async () => {
            showDoc(await request<ExternalSpendDocumentDetail>(`${API}/${id}`, {
                method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ tenantId, ...review }),
            }));
            toast.success(t("saved"));
            await load();
        });

    const act = async (id: number, action: "approve" | "reject") => {
        const ok = await write(async () => {
            showDoc(await request<ExternalSpendDocumentDetail>(`${API}/${id}`, {
                method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ tenantId, action }),
            }));
            toast.success(t(action === "approve" ? "approved" : "rejected"));
            await load();
        });
        // Un 422 deja guardadas las observaciones que bloquean: se recarga para verlas.
        if (!ok && !isMock) await openDoc(id);
    };

    const download = async (doc: ExternalSpendDocumentDetail) => {
        if (isMock) {
            toast.info(t("demoNote"));
            return;
        }
        try {
            const res = await fetch(`${API}/${doc.id}/file?tenantId=${encodeURIComponent(tenantId)}`, { headers: await authHeaders() });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new ApiError(res.status, body?.reason, body?.error);
            }
            const url = URL.createObjectURL(await res.blob());
            const a = document.createElement("a");
            a.href = url;
            a.download = doc.originalName;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(errorText(e));
        }
    };

    const createCommitment = (payload: CommitmentPayload) =>
        write(async () => {
            await request(`${API}/commitments`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ tenantId, ...payload }) });
            toast.success(t("commitmentCreated"));
            if (payload.sourceDocumentId !== null) setSelected(null);
            await load();
        });

    const deleteCommitment = async (c: Commitment) => {
        if (!isMock && !window.confirm(t("deleteCommitmentConfirm", { vendor: c.vendorName }))) return;
        await write(async () => {
            await request(`${API}/commitments/${c.id}?tenantId=${encodeURIComponent(tenantId)}`, { method: "DELETE" });
            toast.success(t("commitmentDeleted"));
            await load();
        });
    };

    const documents = overview?.documents ?? [];
    const commitments = overview?.commitments ?? [];
    const summary = overview?.summary;
    const ai = overview?.ai;
    const toReview = documents.filter((d) => d.status === "needs_review").length;
    const nextDeadline = commitments.map(noticeDeadline).filter((d) => d >= new Date().toISOString().slice(0, 10)).sort()[0];

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
            <MockBanner />
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                        <ReceiptText className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                        {t("title")}
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-3xl">{t("subtitle")}</p>
                </div>
                <button className={secondaryButton} onClick={() => void load()} disabled={!canFetch}>
                    <RefreshCw className="w-4 h-4" />
                    {t("refresh")}
                </button>
            </div>

            {!overview ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("loading")}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className={`${cardClass} p-5`}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t("summaryTotal")}</span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900">
                                    {t("externalBadge")}
                                </span>
                            </div>
                            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2 tabular-nums">{formatMoney(summary?.totalUsd ?? 0, "USD", locale)}</div>
                            {summary && summary.unconverted > 0 && (
                                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t("summaryUnconverted", { count: summary.unconverted })}</p>
                            )}
                        </div>
                        <div className={`${cardClass} p-5`}>
                            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t("summaryPending")}</span>
                            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2 tabular-nums">{toReview}</div>
                            <p className="text-xs text-slate-500 mt-1">{t("documentsCount", { count: documents.length })}</p>
                        </div>
                        <div className={`${cardClass} p-5`}>
                            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t("summaryCommitments")}</span>
                            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2 tabular-nums">{commitments.length}</div>
                            <p className="text-xs text-slate-500 mt-1">{nextDeadline ? t("nextNotice", { date: nextDeadline }) : t("noUpcomingNotice")}</p>
                        </div>
                    </div>

                    {summary && summary.byVendor.length > 0 && (
                        <div className={`${cardClass} p-5 grid grid-cols-1 md:grid-cols-2 gap-6`}>
                            {[
                                { title: t("byVendor"), rows: summary.byVendor.slice(0, 8).map((v) => ({ key: v.vendorName, label: v.vendorName || "—", totalUsd: v.totalUsd })) },
                                { title: t("byMonth"), rows: summary.byMonth.slice(-8).map((m) => ({ key: m.month, label: m.month, totalUsd: m.totalUsd })) },
                            ].map((block) => (
                                <div key={block.title}>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">{block.title}</h3>
                                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {block.rows.map((r) => (
                                            <li key={r.key} className="flex justify-between gap-3 py-1.5 text-sm">
                                                <span className="text-slate-700 dark:text-slate-300 truncate">{r.label}</span>
                                                <span className="tabular-nums font-semibold text-slate-900 dark:text-white">{formatMoney(r.totalUsd, "USD", locale)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    )}

                    <section className={`${cardClass} p-5`}>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <UploadCloud className="w-5 h-5 text-[#0054A6]" />
                            {t("uploadTitle")}
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {t("uploadHint", { mb: EXTERNAL_SPEND_MAX_BYTES / 1024 / 1024, pages: EXTERNAL_SPEND_MAX_PAGES })}
                        </p>
                        {ai && !ai.allowed && (
                            <p className="mt-3 text-sm p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 flex gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                {t(`error_${ai.reason}`)}
                            </p>
                        )}
                        {!canWrite && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("readOnlyNote")}</p>}
                        <div className="mt-4 flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                {t("docTypeLabel")}
                                <select className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value as ExternalSpendDocType)}
                                    disabled={uploading || !canWrite || !ai?.allowed}>
                                    {EXTERNAL_SPEND_DOC_TYPES.map((type) => <option key={type} value={type}>{t(`docType_${type}`)}</option>)}
                                </select>
                            </label>
                            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                            <button className={secondaryButton} onClick={() => fileRef.current?.click()} disabled={uploading || !canWrite || !ai?.allowed}>
                                <FileText className="w-4 h-4" />
                                {file ? file.name : t("selectFile")}
                            </button>
                            <button className={primaryButton} onClick={upload} disabled={!file || uploading || !canWrite || !ai?.allowed}>
                                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                                {uploading ? t("uploading") : t("uploadButton")}
                            </button>
                        </div>
                    </section>

                    <section className={`${cardClass} p-5`}>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{t("documentsTitle")}</h2>
                        {documents.length === 0 ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">{t("documentsEmpty")}</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                            <th className="py-2 pr-3">{t("colDocument")}</th>
                                            <th className="py-2 pr-3">{t("colVendor")}</th>
                                            <th className="py-2 pr-3">{t("colNumber")}</th>
                                            <th className="py-2 pr-3">{t("colDate")}</th>
                                            <th className="py-2 pr-3 text-right">{t("colTotal")}</th>
                                            <th className="py-2 pr-3 text-right">{t("colTotalUsd")}</th>
                                            <th className="py-2 pr-3">{t("colStatus")}</th>
                                            <th className="py-2" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {documents.map((d) => (
                                            <tr key={d.id} className="border-b border-slate-100 dark:border-slate-800/60 align-top">
                                                <td className="py-2.5 pr-3 max-w-[260px]">
                                                    <div className="font-semibold text-slate-800 dark:text-slate-100 truncate" title={d.originalName}>{d.originalName}</div>
                                                    <div className="text-[11px] text-slate-500">{t(`docType_${d.docType}`)}</div>
                                                </td>
                                                <td className="py-2.5 pr-3">{d.vendorName ?? "—"}</td>
                                                <td className="py-2.5 pr-3 tabular-nums">{d.invoiceNumber ?? "—"}</td>
                                                <td className="py-2.5 pr-3 tabular-nums whitespace-nowrap">{d.invoiceDate ?? "—"}</td>
                                                <td className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap">{formatMoney(d.total, d.currency, locale)}</td>
                                                <td className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap">{d.status === "approved" ? formatMoney(d.totalUsd, "USD", locale) : "—"}</td>
                                                <td className="py-2.5 pr-3">
                                                    <StatusBadge status={d.status} label={t(`status_${d.status}`)} />
                                                    {d.issues.length > 0 && d.status === "needs_review" && (
                                                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">{t("issuesCount", { count: d.issues.length })}</div>
                                                    )}
                                                </td>
                                                <td className="py-2.5 text-right">
                                                    <button className="text-sm font-semibold text-[#0078D4] hover:underline whitespace-nowrap" onClick={() => void openDoc(d.id)}>
                                                        {d.status === "needs_review" && canWrite ? t("review") : t("view")}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <CommitmentsSection commitments={commitments} canWrite={canWrite} busy={busy} onCreate={createCommitment} onDelete={(c) => void deleteCommitment(c)} />
                </>
            )}

            {selected && (
                <ReviewDrawer
                    key={selected.version}
                    doc={selected.doc}
                    canWrite={canWrite}
                    busy={busy}
                    onClose={() => setSelected(null)}
                    onSave={(review) => saveReview(selected.doc.id, review)}
                    onAction={(action) => act(selected.doc.id, action)}
                    onDownload={() => void download(selected.doc)}
                    onCreateCommitment={createCommitment}
                />
            )}
        </div>
    );
}
