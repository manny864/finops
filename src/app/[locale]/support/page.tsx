"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { LifeBuoy, Plus, Loader2, ArrowLeft, Send, MessageSquare, Clock, Paperclip, Download, HelpCircle, AlertTriangle, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface TicketMessage {
    id: number;
    author_email: string;
    author_name: string | null;
    author_role: "user" | "support";
    body: string;
    created_at: string;
}

interface TicketAttachment {
    id: number;
    uploaded_by_email: string;
    uploaded_by_role: "user" | "support";
    original_name: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
}

const ATTACHMENT_EXTENSIONS = ".jpg,.jpeg,.png,.txt,.json";
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

function validAttachment(file: File): boolean {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    return ["jpg", "jpeg", "png", "txt", "json"].includes(ext) && file.size > 0 && file.size <= ATTACHMENT_MAX_BYTES;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Ticket {
    id: number;
    subject: string;
    category: string;
    status: string;
    priority: string;
    created_by_email: string;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    message_count: number;
    mockMessages?: TicketMessage[];
}

interface Quota {
    monthlyLimit: number | null;
    usedThisMonth: number;
    firstResponseSlaHours: number;
}

const STATUS_STYLES: Record<string, string> = {
    open: "bg-blue-50 text-blue-700 border-blue-200",
    in_progress: "bg-amber-50 text-amber-700 border-amber-200",
    waiting_customer: "bg-purple-50 text-purple-700 border-purple-200",
    resolved: "bg-green-50 text-green-700 border-green-200",
    closed: "bg-gray-100 text-gray-500 border-gray-200",
};

const PRIORITY_STYLES: Record<string, string> = {
    low: "text-gray-500",
    medium: "text-blue-600",
    high: "text-amber-600",
    urgent: "text-red-600",
};

export default function SupportPage() {
    const t = useTranslations("Support");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [quota, setQuota] = useState<Quota | null>(null);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({ subject: "", category: "question", priority: "medium", message: "" });

    const [selected, setSelected] = useState<Ticket | null>(null);
    const [messages, setMessages] = useState<TicketMessage[]>([]);
    const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
    const [threadLoading, setThreadLoading] = useState(false);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [newFile, setNewFile] = useState<File | null>(null);
    const [replyFile, setReplyFile] = useState<File | null>(null);

    const isMock = isMockTenant(selectedTenant?.id || "");
    const searchParams = useSearchParams();
    const deepLinkHandled = useRef(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const loadTickets = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            let json;
            if (isMock) {
                json = getMockDataForRoute("support", (selectedTenant as { tier?: string }).tier || selectedTenant.id);
            } else {
                const headers = await authHeaders();
                const res = await fetch(`/api/support/tickets?tenantId=${selectedTenant.id}`, { headers });
                json = await res.json();
                if (!res.ok) throw new Error(json.error);
            }
            setTickets(json.tickets || []);
            setQuota(json.quota || null);
        } catch {
            toast.error(t("errorGeneric"));
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, isMock, authHeaders, t]);

    useEffect(() => {
        loadTickets();
    }, [loadTickets]);

    // Deep-link desde la campanita: /support?ticket=N abre el hilo directamente.
    const openThread = async (ticket: Ticket) => {
        setSelected(ticket);
        setReply("");
        setReplyFile(null);
        if (isMock) {
            setMessages(ticket.mockMessages || []);
            setAttachments([]);
            return;
        }
        setThreadLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${ticket.id}?tenantId=${selectedTenant.id}`, { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setSelected(json.ticket);
            setMessages(json.messages || []);
            setAttachments(json.attachments || []);
        } catch {
            toast.error(t("errorGeneric"));
        } finally {
            setThreadLoading(false);
        }
    };

    useEffect(() => {
        const ticketParam = Number(searchParams.get("ticket"));
        if (deepLinkHandled.current || !Number.isInteger(ticketParam) || ticketParam <= 0 || tickets.length === 0) return;
        const target = tickets.find((tk) => tk.id === ticketParam);
        if (target) {
            deepLinkHandled.current = true;
            openThread(target);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tickets, searchParams]);
    const uploadAttachment = async (ticketId: number, file: File): Promise<boolean> => {
        try {
            const headers = await authHeaders();
            const form = new FormData();
            form.append("tenantId", selectedTenant.id);
            form.append("file", file);
            const res = await fetch(`/api/support/tickets/${ticketId}/attachments`, { method: "POST", headers, body: form });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            return true;
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("attachError"));
            return false;
        }
    };

    const downloadAttachment = async (att: TicketAttachment) => {
        if (isMock) {
            toast.info(t("attachDemoNote"));
            return;
        }
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/attachments/${att.id}?tenantId=${selectedTenant.id}`, { headers });
            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = att.original_name;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        }
    };

    const onPickFile = (file: File | null, setter: (f: File | null) => void) => {
        if (file && !validAttachment(file)) {
            toast.error(t("attachInvalid"));
            setter(null);
            return;
        }
        setter(file);
    };

    const createTicket = async () => {
        if (creating) return;
        if (isMock) {
            toast.success(t("createdOk"));
            setShowCreate(false);
            return;
        }
        setCreating(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/support/tickets", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selectedTenant.id, ...form }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            if (newFile && json.ticketId) {
                await uploadAttachment(json.ticketId, newFile);
            }
            toast.success(t("createdOk"));
            setShowCreate(false);
            setForm({ subject: "", category: "question", priority: "medium", message: "" });
            setNewFile(null);
            await loadTickets();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        } finally {
            setCreating(false);
        }
    };

    const sendReply = async () => {
        if (!selected || sending || !reply.trim()) return;
        if (isMock) {
            toast.success(t("sentOk"));
            setReply("");
            return;
        }
        setSending(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${selected.id}`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selectedTenant.id, message: reply.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            if (replyFile) {
                await uploadAttachment(selected.id, replyFile);
                setReplyFile(null);
            }
            toast.success(t("sentOk"));
            setReply("");
            await openThread(selected);
            await loadTickets();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        } finally {
            setSending(false);
        }
    };

    const setTicketStatus = async (status: "closed" | "open") => {
        if (!selected) return;
        if (isMock) {
            setSelected({ ...selected, status });
            return;
        }
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${selected.id}`, {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selectedTenant.id, status }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setSelected({ ...selected, status });
            await loadTickets();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        }
    };

    const statusBadge = (status: string) => (
        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-[6px] border ${STATUS_STYLES[status] || STATUS_STYLES.closed}`}>
            {t(`status_${status}` as Parameters<typeof t>[0])}
        </span>
    );

    const quotaExhausted = quota?.monthlyLimit != null && quota.usedThisMonth >= quota.monthlyLimit;

    // ── Vista de hilo ────────────────────────────────────────────────────────
    if (selected) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <button onClick={() => { setSelected(null); }} className="flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink mb-4">
                    <ArrowLeft className="w-4 h-4" /> {t("backToList")}
                </button>

                <div className="bg-surface border border-line rounded-[14px] shadow-sm overflow-hidden">
                    <div className="p-[18px] border-b border-line">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <h1 className="font-heading font-bold text-[17px] text-ink">#{selected.id} · {selected.subject}</h1>
                                <div className="text-[12px] text-ink-soft mt-1">
                                    {t("createdBy")} <b>{selected.created_by_name || selected.created_by_email}</b> · {t(`category_${selected.category}` as Parameters<typeof t>[0])} · <span className={`font-semibold ${PRIORITY_STYLES[selected.priority] || ""}`}>{t(`priority_${selected.priority}` as Parameters<typeof t>[0])}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {statusBadge(selected.status)}
                                {selected.status === "closed" ? (
                                    <button onClick={() => setTicketStatus("open")} className="text-[12px] font-semibold text-brand-deep hover:underline">{t("reopenTicket")}</button>
                                ) : (
                                    <button onClick={() => setTicketStatus("closed")} className="text-[12px] font-semibold text-ink-soft hover:text-ink hover:underline">{t("closeTicket")}</button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="p-[18px] flex flex-col gap-3 bg-surface-2/40">
                        {threadLoading ? (
                            <div className="flex items-center gap-2 text-ink-soft text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}</div>
                        ) : messages.map((m) => (
                            <div key={m.id} className={`max-w-[85%] rounded-[12px] border p-3 ${m.author_role === "support" ? "self-start bg-[#EAF3FB] border-blue-100" : "self-end bg-surface border-line"}`}>
                                <div className="text-[11px] font-semibold text-ink-soft mb-1">
                                    {m.author_role === "support" ? "🛟 " : ""}{m.author_name || m.author_email}
                                    <span className="font-normal"> · {new Date(m.created_at).toLocaleString()}</span>
                                </div>
                                <div className="text-[13px] text-ink whitespace-pre-wrap">{m.body}</div>
                            </div>
                        ))}
                    </div>

                    {attachments.length > 0 && (
                        <div className="p-[18px] border-t border-line">
                            <div className="text-[12px] font-semibold text-ink-soft mb-2 flex items-center gap-1">
                                <Paperclip className="w-3.5 h-3.5" /> {t("attachments")} ({attachments.length})
                            </div>
                            <div className="flex flex-col gap-1">
                                {attachments.map((att) => (
                                    <button key={att.id} onClick={() => downloadAttachment(att)} className="flex items-center gap-2 text-[12.5px] text-brand-deep hover:underline text-left w-fit">
                                        <Download className="w-3.5 h-3.5 shrink-0" />
                                        {att.original_name}
                                        <span className="text-ink-soft no-underline">({formatBytes(att.size_bytes)}{att.uploaded_by_role === "support" ? " · 🛟" : ""})</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="p-[18px] border-t border-line">
                        {selected.status === "closed" ? (
                            <div className="text-[13px] text-ink-soft">{t("ticketClosedNote")}</div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <textarea
                                    value={reply}
                                    onChange={(e) => setReply(e.target.value)}
                                    placeholder={t("replyPlaceholder")}
                                    rows={3}
                                    maxLength={10000}
                                    className="w-full border border-line rounded-[10px] p-3 text-[13px] outline-none focus:border-brand-deep resize-y"
                                />
                                <div className="flex justify-between items-center gap-2 flex-wrap">
                                    <label className="flex items-center gap-1.5 text-[12px] text-ink-soft cursor-pointer hover:text-ink">
                                        <Paperclip className="w-3.5 h-3.5" />
                                        {replyFile ? `${replyFile.name} (${formatBytes(replyFile.size)})` : t("attach")}
                                        <input type="file" accept={ATTACHMENT_EXTENSIONS} className="hidden" onChange={(e) => onPickFile(e.target.files?.[0] || null, setReplyFile)} />
                                    </label>
                                    <button onClick={sendReply} disabled={sending || !reply.trim()} className="bg-brand-deep text-white px-4 py-2 rounded-[8px] font-semibold text-[13px] flex items-center gap-2 disabled:opacity-50 hover:brightness-110">
                                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                        {sending ? t("sending") : t("send")}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ── Lista + creación ─────────────────────────────────────────────────────
    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
                <div>
                    <h1 className="font-heading font-extrabold text-[20px] text-ink flex items-center gap-2">
                        <LifeBuoy className="w-5 h-5 text-brand-deep" /> {t("title")}
                    </h1>
                    <p className="text-[13px] text-ink-soft mt-1">{t("subtitle")}</p>
                    {quota && (
                        <div className="flex items-center gap-3 mt-2 text-[12px] text-ink-soft">
                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {t("slaNote", { hours: quota.firstResponseSlaHours })}</span>
                            <span>
                                {quota.monthlyLimit == null
                                    ? t("quotaUnlimited")
                                    : t("quotaUsed", { used: quota.usedThisMonth, limit: quota.monthlyLimit })}
                            </span>
                        </div>
                    )}
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    disabled={quotaExhausted}
                    className="bg-brand-deep text-white px-4 py-2 rounded-[8px] font-semibold text-[13px] flex items-center gap-2 hover:brightness-110 disabled:opacity-50"
                >
                    <Plus className="w-4 h-4" /> {t("newTicket")}
                </button>
            </div>

            <TroubleshootingSection t={t} />

            {loading ? (
                <div className="flex items-center gap-2 text-ink-soft text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}</div>
            ) : tickets.length === 0 ? (
                <div className="bg-surface border border-line rounded-[14px] p-10 text-center">
                    <MessageSquare className="w-8 h-8 text-ink-soft mx-auto mb-2" />
                    <div className="font-bold text-[14px] text-ink">{t("emptyTitle")}</div>
                    <div className="text-[13px] text-ink-soft mt-1">{t("emptyBody")}</div>
                </div>
            ) : (
                <div className="bg-surface border border-line rounded-[14px] shadow-sm overflow-hidden">
                    {tickets.map((ticket) => (
                        <button
                            key={ticket.id}
                            onClick={() => openThread(ticket)}
                            className="w-full text-left grid grid-cols-[1fr_auto] gap-3 items-center p-[14px_18px] border-b border-line last:border-b-0 hover:bg-surface-2 transition-colors"
                        >
                            <div>
                                <div className="font-bold text-[13.5px] text-ink">#{ticket.id} · {ticket.subject}</div>
                                <div className="text-[12px] text-ink-soft mt-[2px]">
                                    {t(`category_${ticket.category}` as Parameters<typeof t>[0])} · <span className={`font-semibold ${PRIORITY_STYLES[ticket.priority] || ""}`}>{t(`priority_${ticket.priority}` as Parameters<typeof t>[0])}</span> · {ticket.message_count} 💬 · {new Date(ticket.last_message_at).toLocaleString()}
                                </div>
                            </div>
                            {statusBadge(ticket.status)}
                        </button>
                    ))}
                </div>
            )}

            {showCreate && (
                <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => !creating && setShowCreate(false)}>
                    <div className="bg-surface rounded-[14px] w-full max-w-lg p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h2 className="font-heading font-bold text-[16px] text-ink mb-4">{t("newTicket")}</h2>
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-[12px] font-semibold text-ink-soft">{t("subject")}</label>
                                <input
                                    value={form.subject}
                                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                                    placeholder={t("subjectPlaceholder")}
                                    maxLength={255}
                                    className="w-full border border-line rounded-[8px] p-2 text-[13px] outline-none focus:border-brand-deep mt-1"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12px] font-semibold text-ink-soft">{t("category")}</label>
                                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-line rounded-[8px] p-2 text-[13px] outline-none mt-1 bg-surface">
                                        <option value="question">{t("category_question")}</option>
                                        <option value="technical">{t("category_technical")}</option>
                                        <option value="billing">{t("category_billing")}</option>
                                        <option value="feature_request">{t("category_feature_request")}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[12px] font-semibold text-ink-soft">{t("priority")}</label>
                                    <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-line rounded-[8px] p-2 text-[13px] outline-none mt-1 bg-surface">
                                        <option value="low">{t("priority_low")}</option>
                                        <option value="medium">{t("priority_medium")}</option>
                                        <option value="high">{t("priority_high")}</option>
                                        <option value="urgent">{t("priority_urgent")}</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[12px] font-semibold text-ink-soft">{t("message")}</label>
                                <textarea
                                    value={form.message}
                                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                                    placeholder={t("messagePlaceholder")}
                                    rows={5}
                                    maxLength={10000}
                                    className="w-full border border-line rounded-[10px] p-3 text-[13px] outline-none focus:border-brand-deep mt-1 resize-y"
                                />
                            </div>
                            <label className="flex items-center gap-1.5 text-[12px] text-ink-soft cursor-pointer hover:text-ink w-fit">
                                <Paperclip className="w-3.5 h-3.5" />
                                {newFile ? `${newFile.name} (${formatBytes(newFile.size)})` : t("attachHint")}
                                <input type="file" accept={ATTACHMENT_EXTENSIONS} className="hidden" onChange={(e) => onPickFile(e.target.files?.[0] || null, setNewFile)} />
                            </label>
                            <div className="flex justify-end gap-2 mt-1">
                                <button onClick={() => setShowCreate(false)} disabled={creating} className="px-4 py-2 rounded-[8px] font-semibold text-[13px] text-ink-soft hover:text-ink">{t("cancel")}</button>
                                <button
                                    onClick={createTicket}
                                    disabled={creating || form.subject.trim().length < 3 || !form.message.trim()}
                                    className="bg-brand-deep text-white px-4 py-2 rounded-[8px] font-semibold text-[13px] flex items-center gap-2 disabled:opacity-50 hover:brightness-110"
                                >
                                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {creating ? t("creating") : t("create")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function TroubleshootingSection({ t }: { t: ReturnType<typeof useTranslations> }) {
    const [open, setOpen] = useState(false);
    const items = t.raw("troubleshooting_items") as { q: string; a: string }[];

    return (
        <div className="bg-white border border-line rounded-[10px] mb-4 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface/50 transition-colors"
            >
                <span className="flex items-center gap-2 font-semibold text-[16px] text-ink">
                    <HelpCircle className="w-4 h-4 text-brand-deep" /> {t("troubleshootingTitle")}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="px-4 pb-4 border-t border-line pt-3">
                    <p className="text-[14px] text-gray-500 mb-3">{t("troubleshootingSubtitle")}</p>

                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-[8px] px-3 py-2.5 mb-4">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-[14px] text-amber-800">{t("troubleshootingDisclaimer")}</p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        {items.map((item, i) => (
                            <details key={i} className="group border border-line rounded-[8px] px-3 py-2">
                                <summary className="cursor-pointer text-[15px] font-medium text-ink list-none flex items-center justify-between gap-2">
                                    {item.q}
                                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform group-open:rotate-180" />
                                </summary>
                                <p className="text-[14.5px] text-gray-600 mt-2 leading-relaxed">{item.a}</p>
                            </details>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
