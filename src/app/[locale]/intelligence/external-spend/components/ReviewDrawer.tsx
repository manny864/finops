"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Loader2, Plus, Trash2, X, XCircle } from "lucide-react";
import {
    BLOCKING_ISSUES,
    type ExternalSpendDocumentDetail, type ExternalSpendHeader, type ExternalSpendLine,
} from "@/types/externalSpend.types";
import { CommitmentForm, emptyCommitmentDraft, type CommitmentPayload } from "./CommitmentsSection";
import { LOW_CONFIDENCE, StatusBadge, formatMoney, inputClass, percent, primaryButton, secondaryButton } from "./externalSpendUi";

type HeaderKey = keyof ExternalSpendHeader;
type HeaderDraft = Record<HeaderKey, string>;

const HEADER_FIELDS: Array<{ key: HeaderKey; label: string; kind: "text" | "date" | "number" }> = [
    { key: "vendorName", label: "fieldVendor", kind: "text" },
    { key: "invoiceNumber", label: "fieldInvoiceNumber", kind: "text" },
    { key: "invoiceDate", label: "fieldInvoiceDate", kind: "date" },
    { key: "dueDate", label: "fieldDueDate", kind: "date" },
    { key: "periodStart", label: "fieldPeriodStart", kind: "date" },
    { key: "periodEnd", label: "fieldPeriodEnd", kind: "date" },
    { key: "currency", label: "fieldCurrency", kind: "text" },
    { key: "subtotal", label: "fieldSubtotal", kind: "number" },
    { key: "tax", label: "fieldTax", kind: "number" },
    { key: "total", label: "fieldTotal", kind: "number" },
];

const LINE_TEXT = ["description", "serviceCategory", "costCenter"] as const;
const LINE_NUMBERS = ["quantity", "unitPrice", "amount"] as const;
type LineDraft = Record<(typeof LINE_TEXT)[number] | (typeof LINE_NUMBERS)[number], string> & { base: ExternalSpendLine | null };

const str = (v: string | number | null) => (v === null ? "" : String(v));
const text = (s: string) => s.trim() || null;
/** `undefined` cuando no es un número: el guardado se frena y avisa. */
const amount = (s: string): number | null | undefined => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
};

function headerDraft(doc: ExternalSpendDocumentDetail): HeaderDraft {
    return Object.fromEntries(HEADER_FIELDS.map(({ key }) => [key, str(doc[key])])) as HeaderDraft;
}

function lineDraft(line: ExternalSpendLine | null): LineDraft {
    return {
        description: str(line?.description ?? null), serviceCategory: str(line?.serviceCategory ?? null), costCenter: str(line?.costCenter ?? null),
        quantity: str(line?.quantity ?? null), unitPrice: str(line?.unitPrice ?? null), amount: str(line?.amount ?? null),
        base: line,
    };
}

/** De los borradores al cuerpo del PATCH; `null` si algún número no es válido. */
function toReview(h: HeaderDraft, lines: LineDraft[]): { header: ExternalSpendHeader; lines: ExternalSpendLine[] } | null {
    const subtotal = amount(h.subtotal), tax = amount(h.tax), total = amount(h.total);
    if (subtotal === undefined || tax === undefined || total === undefined) return null;
    const header: ExternalSpendHeader = {
        vendorName: text(h.vendorName), invoiceNumber: text(h.invoiceNumber),
        invoiceDate: text(h.invoiceDate), dueDate: text(h.dueDate), periodStart: text(h.periodStart), periodEnd: text(h.periodEnd),
        currency: text(h.currency.toUpperCase()), subtotal, tax, total,
    };
    const out: ExternalSpendLine[] = [];
    for (const l of lines) {
        const quantity = amount(l.quantity), unitPrice = amount(l.unitPrice), lineAmount = amount(l.amount);
        if (quantity === undefined || unitPrice === undefined || lineAmount === undefined) return null;
        out.push({
            description: text(l.description), quantity, unitPrice, amount: lineAmount,
            currency: l.base?.currency ?? header.currency,
            serviceCategory: text(l.serviceCategory), costCenter: text(l.costCenter),
            periodStart: l.base?.periodStart ?? null, periodEnd: l.base?.periodEnd ?? null,
            // Una línea corregida a mano deja de ser una lectura dudosa del modelo.
            confidence: l.base && LINE_TEXT.every((k) => l[k] === str(l.base![k])) && LINE_NUMBERS.every((k) => l[k] === str(l.base![k])) ? l.base.confidence : null,
        });
    }
    return { header, lines: out };
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="text-sm text-slate-800 dark:text-slate-100 break-words">{children}</dd>
        </div>
    );
}

export default function ReviewDrawer({ doc, canWrite, busy, onClose, onSave, onAction, onDownload, onCreateCommitment }: {
    doc: ExternalSpendDocumentDetail;
    canWrite: boolean;
    busy: boolean;
    onClose: () => void;
    onSave: (review: { header: ExternalSpendHeader; lines: ExternalSpendLine[] }) => Promise<boolean>;
    onAction: (action: "approve" | "reject") => Promise<void>;
    onDownload: () => void;
    onCreateCommitment: (payload: CommitmentPayload) => Promise<boolean>;
}) {
    const t = useTranslations("ExternalSpend");
    const locale = useLocale();
    const initialHeader = useMemo(() => headerDraft(doc), [doc]);
    const initialLines = useMemo(() => doc.lines.map(lineDraft), [doc]);
    const [header, setHeader] = useState(initialHeader);
    const [lines, setLines] = useState(initialLines);

    useEffect(() => {
        const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", onEsc);
        return () => document.removeEventListener("keydown", onEsc);
    }, [onClose]);

    const isInvoice = doc.docType === "invoice";
    const editable = canWrite && doc.status === "needs_review";
    // Un contrato aprobado no se rechaza: se deshace borrando su compromiso.
    const rejectable = editable || (canWrite && doc.status === "approved" && isInvoice);
    const dirty = JSON.stringify(header) !== JSON.stringify(initialHeader) || JSON.stringify(lines) !== JSON.stringify(initialLines);
    const fieldConfidence = doc.extraction?.fieldConfidence ?? {};
    const terms = doc.extraction?.contract;
    const linesSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

    const review = () => {
        const body = toReview(header, lines);
        if (!body) toast.error(t("error_invalid_input"));
        return body;
    };
    const save = async () => {
        const body = review();
        if (body) await onSave(body);
    };
    const approve = async () => {
        // Se aprueba lo guardado: si hay cambios, primero se guardan (y se revalidan).
        if (dirty) {
            const body = review();
            if (!body || !(await onSave(body))) return;
        }
        await onAction("approve");
    };
    const reject = async () => {
        if (doc.status === "approved" && !window.confirm(t("rejectApprovedConfirm"))) return;
        await onAction("reject");
    };

    const setLine = (i: number, key: keyof Omit<LineDraft, "base">, value: string) =>
        setLines((prev) => prev.map((l, j) => (j === i ? { ...l, [key]: value } : l)));

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
            <div role="dialog" aria-modal="true" aria-label={doc.originalName}
                className="fixed inset-y-0 right-0 w-full max-w-4xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-50 flex flex-col h-full shadow-2xl">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 shrink-0 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[11px] font-mono font-bold text-[#0078D4]">#{doc.id} · {t(`docType_${doc.docType}`)}</div>
                        <h2 className="font-bold text-[16px] text-slate-900 dark:text-white break-words">{doc.originalName}</h2>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[12px] text-slate-500 dark:text-slate-400">
                            <StatusBadge status={doc.status} label={t(`status_${doc.status}`)} />
                            {doc.modelId && <span>{t("modelInfo", { model: doc.modelId, pages: doc.pages ?? 0 })}</span>}
                            {doc.confidence !== null && <span>· {t("confidence", { pct: percent(doc.confidence) })}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button className={secondaryButton} onClick={onDownload} disabled={!doc.hasFile} title={doc.hasFile ? undefined : t("fileGone")}>
                            <Download className="w-4 h-4" />
                            {t("downloadOriginal")}
                        </button>
                        <button onClick={onClose} aria-label={t("close")} className="p-1 cursor-pointer">
                            <X className="w-5 h-5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Meta label={t("uploadedBy")}>{doc.uploadedBy ?? "—"}</Meta>
                        <Meta label={t("uploadedAt")}>{doc.createdAt.slice(0, 10)}</Meta>
                        <Meta label={t("reviewedBy")}>{doc.reviewedBy ?? "—"}</Meta>
                        <Meta label={t("reviewedAt")}>{doc.reviewedAt?.slice(0, 10) ?? "—"}</Meta>
                    </dl>

                    {(doc.status === "uploaded" || doc.status === "extracting") && (
                        <p className="text-sm p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-[#0054A6] dark:text-blue-300 flex gap-2">
                            <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
                            {t("analyzingNote")}
                        </p>
                    )}

                    {doc.status === "failed" && (
                        <div className="text-sm p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                            <div className="font-semibold">{t("failedNote")}</div>
                            {doc.errorMessage && <div className="mt-1 font-mono text-[12px] break-words">{doc.errorMessage}</div>}
                        </div>
                    )}

                    {(doc.status === "needs_review" || doc.issues.length > 0) && (
                        <section>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">{t("issuesTitle")}</h3>
                            {doc.issues.length === 0 ? (
                                <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4" />
                                    {t("noIssues")}
                                </p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {doc.issues.map((issue, i) => (
                                        <li key={`${issue.code}-${i}`} className="text-sm flex items-start gap-2 text-amber-800 dark:text-amber-300">
                                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                            <span>
                                                {t(`issue_${issue.code}`)}
                                                {issue.documentId !== undefined && ` (#${issue.documentId})`}
                                                {BLOCKING_ISSUES.includes(issue.code) && (
                                                    <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                                                        {t("blocking")}
                                                    </span>
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}

                    {isInvoice && (
                        <section>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">{t("headerTitle")}</h3>
                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                {HEADER_FIELDS.map(({ key, label, kind }) => {
                                    const confidence = fieldConfidence[key];
                                    const low = confidence !== undefined && confidence < LOW_CONFIDENCE;
                                    return (
                                        <label key={key} className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                            <span className="flex items-center gap-1">
                                                {t(label)}
                                                {low && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label={t("lowConfidence", { pct: percent(confidence) })} />}
                                            </span>
                                            <input
                                                className={`${inputClass} ${low ? "border-amber-400 dark:border-amber-600 bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
                                                type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
                                                step={kind === "number" ? "0.01" : undefined}
                                                maxLength={key === "currency" ? 3 : undefined}
                                                title={low ? t("lowConfidence", { pct: percent(confidence) }) : undefined}
                                                value={header[key]}
                                                disabled={!editable || busy}
                                                onChange={(e) => setHeader((prev) => ({ ...prev, [key]: key === "currency" ? e.target.value.toUpperCase() : e.target.value }))}
                                            />
                                        </label>
                                    );
                                })}
                            </div>
                            {doc.status === "approved" && doc.currency !== "USD" && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                    {doc.totalUsd === null
                                        ? t("fxMissing", { currency: doc.currency ?? "—" })
                                        : t(doc.fxRateDate ? "fxInfo" : "fxInfoNoDate", {
                                            amount: formatMoney(doc.totalUsd, "USD", locale),
                                            rate: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(doc.fxRate ?? 0),
                                            currency: doc.currency ?? "",
                                            date: doc.fxRateDate ?? "",
                                        })}
                                </p>
                            )}
                        </section>
                    )}

                    {isInvoice && (
                        <section>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("linesTitle")}</h3>
                                {editable && (
                                    <button className="text-sm font-semibold text-[#0078D4] hover:underline flex items-center gap-1" disabled={busy}
                                        onClick={() => setLines((prev) => [...prev, lineDraft(null)])}>
                                        <Plus className="w-4 h-4" />
                                        {t("addLine")}
                                    </button>
                                )}
                            </div>
                            {lines.length === 0 ? (
                                <p className="text-sm text-slate-500 dark:text-slate-400">{t("linesEmpty")}</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                                <th className="py-2 pr-2 min-w-[200px]">{t("lineDescription")}</th>
                                                <th className="py-2 pr-2 w-20">{t("lineQuantity")}</th>
                                                <th className="py-2 pr-2 w-28">{t("lineUnitPrice")}</th>
                                                <th className="py-2 pr-2 w-28">{t("lineAmount")}</th>
                                                <th className="py-2 pr-2 w-32">{t("lineCategory")}</th>
                                                <th className="py-2 pr-2 w-28">{t("lineCostCenter")}</th>
                                                <th className="py-2 pr-2 w-16 text-right">{t("lineConfidence")}</th>
                                                {editable && <th className="py-2 w-8" />}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {lines.map((l, i) => {
                                                const confidence = l.base?.confidence ?? null;
                                                const low = confidence !== null && confidence < LOW_CONFIDENCE;
                                                return (
                                                    <tr key={i} className={`border-b border-slate-100 dark:border-slate-800/60 ${low ? "bg-amber-50/70 dark:bg-amber-950/20" : ""}`}>
                                                        {([...LINE_TEXT.slice(0, 1), ...LINE_NUMBERS, ...LINE_TEXT.slice(1)] as const).map((key) => (
                                                            <td key={key} className="py-1.5 pr-2">
                                                                <input
                                                                    className={inputClass}
                                                                    type={(LINE_NUMBERS as readonly string[]).includes(key) ? "number" : "text"}
                                                                    step={(LINE_NUMBERS as readonly string[]).includes(key) ? "0.01" : undefined}
                                                                    value={l[key]}
                                                                    disabled={!editable || busy}
                                                                    onChange={(e) => setLine(i, key, e.target.value)}
                                                                />
                                                            </td>
                                                        ))}
                                                        <td className={`py-1.5 pr-2 text-right tabular-nums ${low ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-slate-500"}`}
                                                            title={low ? t("lowConfidence", { pct: percent(confidence) }) : undefined}>
                                                            {confidence === null ? "—" : `${percent(confidence)} %`}
                                                        </td>
                                                        {editable && (
                                                            <td className="py-1.5 text-right">
                                                                <button aria-label={t("removeLine")} title={t("removeLine")} disabled={busy}
                                                                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                                                                    className="p-1 rounded text-slate-400 hover:text-red-600">
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                        {t("linesSum", { amount: formatMoney(linesSum, header.currency || null, locale) })}
                                    </p>
                                </div>
                            )}
                        </section>
                    )}

                    {terms && (
                        <section>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">{t("contractTitle")}</h3>
                            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <Meta label={t("contractName")}>{terms.title ?? "—"}</Meta>
                                <Meta label={t("contractParties")}>{terms.parties.length ? terms.parties.join(" · ") : "—"}</Meta>
                                <Meta label={t("contractNumber")}>{doc.invoiceNumber ?? "—"}</Meta>
                                <Meta label={t("contractEffective")}>{terms.effectiveDate ?? "—"}</Meta>
                                <Meta label={t("contractExpiration")}>{terms.expirationDate ?? "—"}</Meta>
                                <Meta label={t("contractRenewal")}>{terms.renewalDate ?? "—"}</Meta>
                                <Meta label={t("contractDuration")}>{terms.duration ?? "—"}</Meta>
                            </dl>
                        </section>
                    )}

                    {doc.extraction?.content && (
                        <section>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("contentTitle")}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{t("contentHint")}</p>
                            <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-y-auto p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                                {doc.extraction.content}
                            </pre>
                        </section>
                    )}

                    {!isInvoice && editable && (
                        <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("createCommitmentTitle")}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t("contractHint")}</p>
                            <CommitmentForm
                                initial={{
                                    ...emptyCommitmentDraft(),
                                    vendorName: doc.vendorName ?? "",
                                    currency: doc.currency ?? "USD",
                                    startDate: doc.periodStart ?? "",
                                    endDate: doc.periodEnd ?? "",
                                    renewalDate: terms?.renewalDate ?? "",
                                }}
                                sourceDocumentId={doc.id}
                                busy={busy}
                                onSubmit={onCreateCommitment}
                            />
                        </section>
                    )}
                </div>

                {rejectable && (
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-end gap-2 flex-wrap">
                        <button className={`${secondaryButton} text-red-700 dark:text-red-400`} onClick={reject} disabled={busy}>
                            <XCircle className="w-4 h-4" />
                            {t("reject")}
                        </button>
                        {editable && isInvoice && (
                            <>
                                <button className={secondaryButton} onClick={save} disabled={busy || !dirty}>
                                    {t("save")}
                                </button>
                                <button className={primaryButton} onClick={approve} disabled={busy}>
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    {t("approve")}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
