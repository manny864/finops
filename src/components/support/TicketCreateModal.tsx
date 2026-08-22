"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { IconCheck, IconLoader2, IconPaperclip, IconTrash, IconX } from "@tabler/icons-react";
import type { CreateTicketPayload, TicketCategory, TicketPriority } from "@/types/supportTickets.types";
import { TICKET_RELATED_MODULES } from "@/types/supportTickets.types";
import { ATTACHMENT_EXTENSIONS, formatBytes, isValidAttachment } from "@/services/supportTickets.service";
import { CATEGORY_I18N, PRIORITY_I18N } from "./supportUi";

/**
 * Modal de creación de ticket.
 *
 * El `subject` y el `messageText` se validan acá y también en la ruta: la
 * validación de cliente es UX (deshabilitar el botón), la del servidor es la que
 * cuenta. Los adjuntos se suben DESPUÉS de crear el ticket porque necesitan su
 * id; si la subida falla el ticket ya existe, y eso es deliberado — perder el
 * texto del reporte por un adjunto rechazado sería peor.
 */

const CATEGORIES: TicketCategory[] = [
    "CONSULTA",
    "FACTURACION_AZURE",
    "CONEXION_TENANT",
    "INCIDENCIA_TECNICA",
    "SOLICITUD_FEATURE",
];
const PRIORITIES: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const MESSAGE_MAX = 10000;
const SUBJECT_MAX = 255;

export default function TicketCreateModal({
    onClose,
    onSubmit,
    submitting,
}: {
    onClose: () => void;
    onSubmit: (payload: CreateTicketPayload) => Promise<void>;
    submitting: boolean;
}) {
    const t = useTranslations("Support");
    const [subject, setSubject] = useState("");
    const [category, setCategory] = useState<TicketCategory>("CONSULTA");
    const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
    const [relatedModule, setRelatedModule] = useState("");
    const [messageText, setMessageText] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        function onEsc(e: KeyboardEvent) {
            if (e.key === "Escape" && !submitting) onClose();
        }
        document.addEventListener("keydown", onEsc);
        return () => document.removeEventListener("keydown", onEsc);
    }, [onClose, submitting]);

    const previews = useMemo(
        () => files.map((f) => ({ file: f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null })),
        [files]
    );
    useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews]);

    const addFiles = (picked: FileList | null) => {
        if (!picked) return;
        const accepted: File[] = [];
        for (const f of Array.from(picked)) {
            if (isValidAttachment(f)) accepted.push(f);
            else toast.error(t("attachInvalid"));
        }
        if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    };

    const canSubmit = subject.trim().length >= 3 && messageText.trim().length > 0 && !submitting;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => !submitting && onClose()}>
            <div
                className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-3 p-5 border-b border-slate-200 dark:border-slate-800">
                    <h2 className="font-heading font-bold text-[17px] text-slate-900 dark:text-white">{t("newTicket")}</h2>
                    <button onClick={() => !submitting && onClose()} aria-label={t("close")} className="cursor-pointer">
                        <IconX size={20} stroke={1.5} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />
                    </button>
                </div>

                <div className="p-5 flex flex-col gap-4">
                    <div>
                        <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("subject")}</label>
                        <input
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            placeholder={t("subjectPlaceholder")}
                            maxLength={SUBJECT_MAX}
                            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("category")}</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                                className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] cursor-pointer"
                            >
                                {CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                        {t(CATEGORY_I18N[c] as never)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("priority")}</label>
                            <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                                className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] cursor-pointer"
                            >
                                {PRIORITIES.map((p) => (
                                    <option key={p} value={p}>
                                        {t(PRIORITY_I18N[p] as never)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("relatedModule")}</label>
                        <select
                            value={relatedModule}
                            onChange={(e) => setRelatedModule(e.target.value)}
                            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] cursor-pointer"
                        >
                            <option value="">{t("relatedModuleNone")}</option>
                            {TICKET_RELATED_MODULES.map((m) => (
                                <option key={m} value={m}>
                                    {t(`module_${m}` as never)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">{t("message")}</label>
                            <span className="text-[11px] text-slate-400">
                                {messageText.length} / {MESSAGE_MAX}
                            </span>
                        </div>
                        <textarea
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            placeholder={t("messagePlaceholder")}
                            rows={6}
                            maxLength={MESSAGE_MAX}
                            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] resize-y"
                        />
                    </div>

                    <div>
                        <label
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setDragging(false);
                                addFiles(e.dataTransfer.files);
                            }}
                            className={`block border-dashed border-2 p-3 rounded-lg text-center cursor-pointer text-[12px] transition-colors ${dragging
                                ? "border-[#0078D4] bg-blue-50/60 dark:bg-blue-950/20"
                                : "border-slate-300 dark:border-slate-700 hover:border-[#0078D4]"
                                }`}
                        >
                            <IconPaperclip size={18} stroke={1.5} className="text-[#0078D4] inline mr-1" />
                            <span className="text-slate-600 dark:text-slate-400">{t("attachDropHint")}</span>
                            <input type="file" multiple accept={ATTACHMENT_EXTENSIONS} className="hidden" onChange={(e) => addFiles(e.target.files)} />
                        </label>

                        {previews.length > 0 && (
                            <div className="flex flex-col gap-1.5 mt-2">
                                {previews.map((p, i) => (
                                    <div
                                        key={`${p.file.name}-${i}`}
                                        className="flex items-center gap-2 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5"
                                    >
                                        {p.url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={p.url} alt={p.file.name} className="w-9 h-9 object-cover rounded" />
                                        ) : (
                                            <IconPaperclip size={18} stroke={1.5} className="text-[#0078D4]" />
                                        )}
                                        <span className="text-[12px] text-slate-700 dark:text-slate-300 flex-1 truncate" title={p.file.name}>
                                            {p.file.name}
                                        </span>
                                        <span className="text-[11px] text-slate-500">{formatBytes(p.file.size)}</span>
                                        <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="cursor-pointer">
                                            <IconTrash size={14} className="text-rose-500 hover:text-rose-700" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-200 dark:border-slate-800">
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold text-[13px] cursor-pointer disabled:opacity-50"
                    >
                        {t("cancel")}
                    </button>
                    <button
                        onClick={() =>
                            onSubmit({
                                subject: subject.trim(),
                                category,
                                priority,
                                messageText: messageText.trim(),
                                relatedModule: relatedModule || undefined,
                                attachments: files,
                            })
                        }
                        disabled={!canSubmit}
                        className="bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold px-5 py-2 rounded-lg text-[13px] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {submitting ? <IconLoader2 size={16} className="animate-spin" /> : <IconCheck size={16} stroke={2} />}
                        {submitting ? t("creating") : t("create")}
                    </button>
                </div>
            </div>
        </div>
    );
}
