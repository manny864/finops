"use client";

import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { COMMITMENT_TYPES, type Commitment, type CommitmentType } from "@/types/externalSpend.types";
import { cardClass, daysUntil, formatMoney, inputClass, primaryButton, secondaryButton } from "./externalSpendUi";

/** El cuerpo del alta (`POST .../commitments`), sin el tenant. */
export interface CommitmentPayload {
    vendorName: string;
    commitmentType: CommitmentType;
    amount: number;
    currency: string;
    startDate: string;
    endDate: string;
    renewalDate: string | null;
    noticeDays: number;
    autoRenew: boolean;
    sourceDocumentId: number | null;
}

/** El formulario trabaja con texto; se convierte al mandar. */
export interface CommitmentDraft {
    vendorName: string;
    commitmentType: CommitmentType;
    amount: string;
    currency: string;
    startDate: string;
    endDate: string;
    renewalDate: string;
    noticeDays: string;
    autoRenew: boolean;
}

export const emptyCommitmentDraft = (): CommitmentDraft => ({
    vendorName: "", commitmentType: "other", amount: "", currency: "USD",
    startDate: "", endDate: "", renewalDate: "", noticeDays: "30", autoRenew: false,
});

/** La misma cuenta que el cron de avisos: la renovación (o el fin) menos los días de preaviso. */
export function noticeDeadline(c: Pick<Commitment, "renewalDate" | "endDate" | "noticeDays">): string {
    return new Date(Date.parse(`${c.renewalDate ?? c.endDate}T00:00:00Z`) - c.noticeDays * 86_400_000).toISOString().slice(0, 10);
}

/** Las mismas reglas que `commitmentSchema` en el servidor, para avisar antes de mandar. */
function toPayload(d: CommitmentDraft, sourceDocumentId: number | null): CommitmentPayload | null {
    const amount = Number(d.amount);
    const noticeDays = d.noticeDays.trim() === "" ? 0 : Number(d.noticeDays);
    const currency = d.currency.trim().toUpperCase();
    const valid =
        d.vendorName.trim() !== "" && d.amount.trim() !== "" && Number.isFinite(amount) && amount >= 0 &&
        /^[A-Z]{3}$/.test(currency) && Number.isInteger(noticeDays) && noticeDays >= 0 && noticeDays <= 3650 &&
        d.startDate !== "" && d.endDate !== "" && d.startDate <= d.endDate && (!d.renewalDate || d.renewalDate >= d.startDate);
    if (!valid) return null;
    return {
        vendorName: d.vendorName.trim(), commitmentType: d.commitmentType, amount, currency,
        startDate: d.startDate, endDate: d.endDate, renewalDate: d.renewalDate || null,
        noticeDays, autoRenew: d.autoRenew, sourceDocumentId,
    };
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <label className={`flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 ${wide ? "sm:col-span-2" : ""}`}>
            {label}
            {children}
        </label>
    );
}

export function CommitmentForm({ initial, sourceDocumentId = null, busy, onSubmit, onCancel }: {
    initial: CommitmentDraft;
    sourceDocumentId?: number | null;
    busy: boolean;
    onSubmit: (payload: CommitmentPayload) => Promise<boolean>;
    onCancel?: () => void;
}) {
    const t = useTranslations("ExternalSpend");
    const [d, setD] = useState(initial);
    const set = <K extends keyof CommitmentDraft>(key: K, value: CommitmentDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const payload = toPayload(d, sourceDocumentId);
        if (!payload) {
            toast.error(t("formInvalid"));
            return;
        }
        void onSubmit(payload);
    };

    return (
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label={t("formVendor")} wide>
                <input className={inputClass} value={d.vendorName} maxLength={255} onChange={(e) => set("vendorName", e.target.value)} />
            </Field>
            <Field label={t("formType")}>
                <select className={inputClass} value={d.commitmentType} onChange={(e) => set("commitmentType", e.target.value as CommitmentType)}>
                    {COMMITMENT_TYPES.map((type) => <option key={type} value={type}>{t(`type_${type}`)}</option>)}
                </select>
            </Field>
            <Field label={t("formAutoRenew")}>
                <span className="flex items-center h-[34px]">
                    <input type="checkbox" className="w-4 h-4 accent-[#0078D4]" checked={d.autoRenew} onChange={(e) => set("autoRenew", e.target.checked)} />
                </span>
            </Field>
            <Field label={t("formAmount")}>
                <input className={inputClass} type="number" min={0} step="0.01" value={d.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label={t("formCurrency")}>
                <input className={`${inputClass} uppercase`} value={d.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
            </Field>
            <Field label={t("formStart")}>
                <input className={inputClass} type="date" value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field label={t("formEnd")}>
                <input className={inputClass} type="date" value={d.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </Field>
            <Field label={t("formRenewal")}>
                <input className={inputClass} type="date" value={d.renewalDate} onChange={(e) => set("renewalDate", e.target.value)} />
            </Field>
            <Field label={t("formNoticeDays")}>
                <input className={inputClass} type="number" min={0} max={3650} step={1} value={d.noticeDays} onChange={(e) => set("noticeDays", e.target.value)} />
            </Field>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
                {onCancel && (
                    <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>{t("cancel")}</button>
                )}
                <button type="submit" className={primaryButton} disabled={busy}>
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t("formSubmit")}
                </button>
            </div>
        </form>
    );
}

function DeadlineChip({ days }: { days: number }) {
    const t = useTranslations("ExternalSpend");
    const tone = days < 0
        ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
        : days <= 30
            ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
            : days <= 90
                ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    return (
        <span className={`ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded ${tone}`}>
            {days < 0 ? t("deadlinePassed") : t("daysLeft", { days })}
        </span>
    );
}

export default function CommitmentsSection({ commitments, canWrite, busy, onCreate, onDelete }: {
    commitments: Commitment[];
    canWrite: boolean;
    busy: boolean;
    onCreate: (payload: CommitmentPayload) => Promise<boolean>;
    onDelete: (commitment: Commitment) => void;
}) {
    const t = useTranslations("ExternalSpend");
    const locale = useLocale();
    const [adding, setAdding] = useState(false);

    return (
        <section className={`${cardClass} p-5`}>
            <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <CalendarClock className="w-5 h-5 text-[#0054A6]" />
                        {t("commitmentsTitle")}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("commitmentsSubtitle")}</p>
                </div>
                {canWrite && !adding && (
                    <button className={secondaryButton} onClick={() => setAdding(true)}>
                        <Plus className="w-4 h-4" />
                        {t("addCommitment")}
                    </button>
                )}
            </div>

            {adding && (
                <div className="mb-5 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                    <CommitmentForm
                        initial={emptyCommitmentDraft()}
                        busy={busy}
                        onCancel={() => setAdding(false)}
                        onSubmit={async (payload) => {
                            const ok = await onCreate(payload);
                            if (ok) setAdding(false);
                            return ok;
                        }}
                    />
                </div>
            )}

            {commitments.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">{t("commitmentsEmpty")}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                <th className="py-2 pr-3">{t("colVendor")}</th>
                                <th className="py-2 pr-3">{t("colCommitmentType")}</th>
                                <th className="py-2 pr-3 text-right">{t("colAmount")}</th>
                                <th className="py-2 pr-3">{t("colStart")}</th>
                                <th className="py-2 pr-3">{t("colEnd")}</th>
                                <th className="py-2 pr-3">{t("colRenewal")}</th>
                                <th className="py-2 pr-3">{t("colNoticeDeadline")}</th>
                                {canWrite && <th className="py-2" />}
                            </tr>
                        </thead>
                        <tbody>
                            {commitments.map((c) => {
                                const deadline = noticeDeadline(c);
                                return (
                                    <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800/60 align-top">
                                        <td className="py-2.5 pr-3">
                                            <div className="font-semibold text-slate-800 dark:text-slate-100">{c.vendorName}</div>
                                            {c.sourceDocumentId !== null && (
                                                <div className="text-[11px] text-slate-500">{t("fromDocument", { id: c.sourceDocumentId })}</div>
                                            )}
                                        </td>
                                        <td className="py-2.5 pr-3 whitespace-nowrap">{t(`type_${c.commitmentType}`)}</td>
                                        <td className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap">{formatMoney(c.amount, c.currency, locale)}</td>
                                        <td className="py-2.5 pr-3 tabular-nums whitespace-nowrap">{c.startDate}</td>
                                        <td className="py-2.5 pr-3 tabular-nums whitespace-nowrap">{c.endDate}</td>
                                        <td className="py-2.5 pr-3 tabular-nums whitespace-nowrap">
                                            {c.renewalDate ?? "—"}
                                            {c.autoRenew && (
                                                <div className="text-[11px] text-slate-500">{t("autoRenewBadge")}</div>
                                            )}
                                        </td>
                                        <td className="py-2.5 pr-3 tabular-nums whitespace-nowrap">
                                            {deadline}
                                            <DeadlineChip days={daysUntil(deadline)} />
                                            <div className="text-[11px] text-slate-500">{t("noticeDays", { days: c.noticeDays })}</div>
                                        </td>
                                        {canWrite && (
                                            <td className="py-2.5 text-right">
                                                <button
                                                    onClick={() => onDelete(c)}
                                                    disabled={busy}
                                                    aria-label={t("deleteCommitment")}
                                                    title={t("deleteCommitment")}
                                                    className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
