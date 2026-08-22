"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    IconDownload,
    IconLoader2,
    IconLock,
    IconMessages,
    IconPaperclip,
    IconPhoto,
    IconSend,
    IconTrash,
    IconUserCheck,
    IconX,
    IconZoomIn,
} from "@tabler/icons-react";
import type { SupportTicketItem, TicketMessageItem, TicketStatus } from "@/types/supportTickets.types";
import { ATTACHMENT_EXTENSIONS, formatBytes, isPreviewableImage, isValidAttachment } from "@/services/supportTickets.service";
import { InternalNoteTag, PRIORITY_I18N, PriorityPill, SlaBadge, STATUS_I18N, StatusBadge, formatDateTime } from "./supportUi";

/**
 * Drawer de conversación de un ticket. Uno solo para las dos vistas: la de
 * usuario y la cola global del equipo. Lo que cambia es `mode`.
 *
 * `mode="agent"` habilita el selector de estado completo, el de asignación y el
 * toggle de nota interna. En `mode="user"` esos controles no se renderizan, pero
 * la garantía real está en el backend: las notas internas se filtran antes de
 * salir del servidor y el flag `isInternalNote` de un usuario de tenant se
 * ignora. El modo acá es UX, no seguridad.
 */

export type DrawerMode = "user" | "agent";

const AGENT_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"];

export interface DrawerActions {
    /** Envía un mensaje. Devuelve el id del mensaje creado para colgarle adjuntos. */
    sendMessage: (text: string, isInternalNote: boolean) => Promise<number | null>;
    uploadAttachment: (file: File, messageId: number | null) => Promise<boolean>;
    downloadAttachment: (attachmentId: string, fileName: string) => Promise<void>;
    /**
     * Devuelve una object URL del adjunto para previsualizarlo. Hace falta porque
     * `/api/support/attachments/[id]` exige el Bearer y un `<img src>` no manda
     * headers: sin esto la vista previa daría 401.
     */
    previewAttachment: (attachmentId: string) => Promise<string | null>;
    changeStatus?: (status: TicketStatus) => Promise<void>;
    assignToMe?: () => Promise<void>;
    refresh: () => Promise<void>;
}

export default function TicketConversationDrawer({
    ticket,
    messages,
    orphanAttachments,
    mode,
    loading,
    onClose,
    actions,
}: {
    ticket: SupportTicketItem;
    messages: TicketMessageItem[];
    /** Adjuntos previos a la migración, sin `message_id`: se listan aparte. */
    orphanAttachments: { id: string; fileName: string; fileSizeBytes: number; contentType: string }[];
    mode: DrawerMode;
    loading: boolean;
    onClose: () => void;
    actions: DrawerActions;
}) {
    const t = useTranslations("Support");
    const [text, setText] = useState("");
    const [asInternalNote, setAsInternalNote] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [zoomed, setZoomed] = useState<{ url: string; name: string } | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLTextAreaElement>(null);

    const isClosed = ticket.status === "CLOSED";

    // El hilo se lee de arriba hacia abajo: al abrir y al recibir mensajes
    // nuevos hay que quedar al final, no al principio.
    useEffect(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [messages.length, loading]);

    // Autogrow del textarea: crece con el contenido hasta un techo, sin saltar
    // el layout del footer.
    useEffect(() => {
        const el = textRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(160, el.scrollHeight)}px`;
    }, [text]);

    useEffect(() => {
        function onEsc(e: KeyboardEvent) {
            if (e.key !== "Escape") return;
            if (zoomed) setZoomed(null);
            else onClose();
        }
        document.addEventListener("keydown", onEsc);
        return () => document.removeEventListener("keydown", onEsc);
    }, [onClose, zoomed]);

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

    const send = async () => {
        const body = text.trim();
        if (!body || sending) return;
        setSending(true);
        try {
            const messageId = await actions.sendMessage(body, asInternalNote);
            for (const f of files) await actions.uploadAttachment(f, messageId);
            setText("");
            setFiles([]);
            setAsInternalNote(false);
            await actions.refresh();
        } finally {
            setSending(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
            <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-50 flex flex-col h-full shadow-2xl">
                {/* Header */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[11px] font-mono font-bold text-[#0078D4]">#{ticket.ticketNumber}</div>
                            <h2 className="font-heading font-bold text-[16px] text-slate-900 dark:text-white break-words">{ticket.subject}</h2>
                            <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {t("createdBy")} <b>{ticket.creatorName}</b>
                                {mode === "agent" && ticket.tenantDisplayName ? ` · ${ticket.tenantDisplayName}` : ""}
                                {` · ${formatDateTime(ticket.createdAt)}`}
                            </div>
                        </div>
                        <button onClick={onClose} aria-label={t("close")} className="shrink-0 cursor-pointer">
                            <IconX size={20} stroke={1.5} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <StatusBadge status={ticket.status} label={t(STATUS_I18N[ticket.status] as never)} />
                        <PriorityPill priority={ticket.priority} label={t(PRIORITY_I18N[ticket.priority] as never)} />
                        <SlaBadge minutes={ticket.slaRemainingMinutes} atRisk={ticket.isSlaBreachRisk} expiredLabel={t("slaExpired")} />
                        {ticket.relatedModule && (
                            <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {ticket.relatedModule}
                            </span>
                        )}
                    </div>

                    {mode === "agent" && (
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                            <select
                                value={ticket.status}
                                onChange={(e) => actions.changeStatus?.(e.target.value as TicketStatus)}
                                className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer"
                            >
                                {AGENT_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                        {t(STATUS_I18N[s] as never)}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => actions.assignToMe?.()}
                                className="text-xs font-semibold rounded-lg border border-[#00AEEF] text-[#00AEEF] bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                            >
                                <IconUserCheck size={14} stroke={1.5} className="inline mr-1" />
                                {ticket.assignedAdminEmail ? ticket.assignedAdminEmail : t("unassigned")}
                            </button>
                        </div>
                    )}
                </div>

                {/* Cuerpo del hilo */}
                <div
                    ref={bodyRef}
                    className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-slate-50/60 dark:bg-slate-950/30 scrollbar-thin [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600"
                >
                    {loading ? (
                        <div className="flex items-center gap-2 text-slate-500 text-[13px]">
                            <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="text-[13px] text-slate-500 dark:text-slate-400">{t("noMessages")}</div>
                    ) : (
                        messages.map((m) => (
                            <MessageBubble
                                key={m.id}
                                message={m}
                                onDownload={actions.downloadAttachment}
                                onPreview={actions.previewAttachment}
                                onZoom={(url, name) => setZoomed({ url, name })}
                                internalLabel={t("internalNote")}
                            />
                        ))
                    )}

                    {orphanAttachments.length > 0 && (
                        <div className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                            <div className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                <IconPaperclip size={14} stroke={1.5} className="text-[#0078D4]" /> {t("attachments")} ({orphanAttachments.length})
                            </div>
                            <div className="flex flex-col gap-1">
                                {orphanAttachments.map((a) => (
                                    <button
                                        key={a.id}
                                        onClick={() => actions.downloadAttachment(a.id, a.fileName)}
                                        className="flex items-center gap-2 text-[12.5px] text-[#0078D4] hover:underline text-left w-fit cursor-pointer"
                                    >
                                        <IconDownload size={14} stroke={1.5} className="shrink-0" />
                                        {a.fileName}
                                        <span className="text-slate-500 no-underline">({formatBytes(a.fileSizeBytes)})</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer de entrada */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900">
                    {isClosed ? (
                        <div className="text-[13px] text-slate-500 dark:text-slate-400">{t("ticketClosedNote")}</div>
                    ) : (
                        <>
                            {mode === "agent" && (
                                <div className="flex items-center gap-1 mb-2">
                                    <button
                                        onClick={() => setAsInternalNote(false)}
                                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border cursor-pointer ${!asInternalNote
                                            ? "border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900"
                                            : "border-slate-300 dark:border-slate-700 text-slate-500 bg-white dark:bg-slate-900"
                                            }`}
                                    >
                                        {t("publicReply")}
                                    </button>
                                    <button
                                        onClick={() => setAsInternalNote(true)}
                                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border cursor-pointer ${asInternalNote
                                            ? "border-amber-500 text-amber-700 bg-white dark:bg-slate-900"
                                            : "border-slate-300 dark:border-slate-700 text-slate-500 bg-white dark:bg-slate-900"
                                            }`}
                                    >
                                        <IconLock size={12} stroke={2} className="inline mr-1" />
                                        {t("internalNote")}
                                    </button>
                                </div>
                            )}

                            {asInternalNote && (
                                <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg px-2.5 py-1.5 mb-2">
                                    {t("internalNoteHint")}
                                </div>
                            )}

                            {previews.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {previews.map((p, i) => (
                                        <div
                                            key={`${p.file.name}-${i}`}
                                            className="flex items-center gap-2 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900"
                                        >
                                            {p.url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={p.url} alt={p.file.name} className="w-8 h-8 object-cover rounded" />
                                            ) : (
                                                <IconPaperclip size={16} stroke={1.5} className="text-[#0078D4]" />
                                            )}
                                            <span className="text-[11px] text-slate-700 dark:text-slate-300 max-w-[140px] truncate" title={p.file.name}>
                                                {p.file.name}
                                            </span>
                                            <span className="text-[10px] text-slate-500">{formatBytes(p.file.size)}</span>
                                            <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="cursor-pointer">
                                                <IconTrash size={14} className="text-rose-500 hover:text-rose-700" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <textarea
                                ref={textRef}
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                placeholder={asInternalNote ? t("internalNotePlaceholder") : t("replyPlaceholder")}
                                rows={2}
                                maxLength={10000}
                                className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-[13px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] resize-none"
                            />

                            <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                                <label className="flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-400 cursor-pointer hover:text-slate-900 dark:hover:text-white">
                                    <IconPaperclip size={16} stroke={1.5} className="text-[#0078D4]" />
                                    {t("attach")}
                                    <input type="file" multiple accept={ATTACHMENT_EXTENSIONS} className="hidden" onChange={(e) => addFiles(e.target.files)} />
                                </label>
                                <button
                                    onClick={send}
                                    disabled={sending || !text.trim()}
                                    className="bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold px-4 py-2 rounded-lg text-[13px] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                >
                                    {sending ? <IconLoader2 size={16} className="animate-spin" /> : <IconSend size={16} stroke={1.5} />}
                                    {sending ? t("sending") : t("sendReply")}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Zoom de imagen: por encima del drawer, que ya está en z-50. */}
            {zoomed && (
                <div
                    className="fixed inset-0 bg-black/80 z-[110] grid place-items-center p-6"
                    onClick={() => {
                        URL.revokeObjectURL(zoomed.url);
                        setZoomed(null);
                    }}
                >
                    <div className="max-w-full max-h-full flex flex-col items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={zoomed.url} alt={zoomed.name} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
                        <span className="text-white text-[12px]">{zoomed.name}</span>
                    </div>
                </div>
            )}
        </>
    );
}

function MessageBubble({
    message,
    onDownload,
    onPreview,
    onZoom,
    internalLabel,
}: {
    message: TicketMessageItem;
    onDownload: (id: string, fileName: string) => Promise<void>;
    onPreview: (id: string) => Promise<string | null>;
    onZoom: (url: string, name: string) => void;
    internalLabel: string;
}) {
    const isSupport = message.senderRole === "SUPPORT_AGENT";
    const isSystem = message.senderRole === "SYSTEM";

    const tone = message.isInternalNote
        ? "self-start bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200"
        : isSystem
            ? "self-center bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            : isSupport
                ? "self-end bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-slate-900 dark:text-white"
                : "self-start bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white";

    return (
        <div className={`max-w-[85%] rounded-xl border p-3 ${tone}`}>
            <div className="text-[11px] font-semibold mb-1 flex items-center gap-1.5 flex-wrap opacity-80">
                {message.isInternalNote && <InternalNoteTag label={internalLabel} />}
                {isSupport && !message.isInternalNote && <IconMessages size={12} stroke={1.5} className="text-[#0078D4]" />}
                {message.senderName}
                <span className="font-normal">· {formatDateTime(message.createdAt)}</span>
            </div>
            <div className="text-[13px] whitespace-pre-wrap break-words">{message.messageText}</div>

            {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                    {message.attachments.map((a) => (
                        <button
                            key={a.id}
                            onClick={async () => {
                                if (!isPreviewableImage(a.contentType)) {
                                    await onDownload(a.id, a.fileName);
                                    return;
                                }
                                const url = await onPreview(a.id);
                                if (url) onZoom(url, a.fileName);
                            }}
                            className="flex items-center gap-1.5 text-[12px] text-[#0078D4] hover:underline text-left w-fit cursor-pointer"
                        >
                            {isPreviewableImage(a.contentType) ? (
                                <IconZoomIn size={14} stroke={1.5} />
                            ) : (
                                <IconDownload size={14} stroke={1.5} />
                            )}
                            {a.fileName}
                            <span className="text-slate-500 no-underline">({formatBytes(a.fileSizeBytes)})</span>
                            {isPreviewableImage(a.contentType) && <IconPhoto size={12} stroke={1.5} className="text-slate-400" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
