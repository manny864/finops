"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { LifeBuoy, Loader2, ArrowLeft, Send, Paperclip, Download } from "lucide-react";
import { toast } from "sonner";

interface TicketAttachment {
    id: number;
    uploaded_by_role: "user" | "support";
    original_name: string;
    size_bytes: number;
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

interface AdminTicket {
    id: number;
    tenant_id: string;
    tenant_name: string | null;
    tenant_tier: string;
    subject: string;
    category: string;
    status: string;
    priority: string;
    created_by_email: string;
    created_by_name: string | null;
    created_at: string;
    last_message_at: string;
    message_count: number;
}

interface TicketMessage {
    id: number;
    author_email: string;
    author_name: string | null;
    author_role: "user" | "support";
    body: string;
    created_at: string;
}

const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const STATUS_STYLES: Record<string, string> = {
    open: "bg-blue-50 text-blue-700 border-blue-200",
    in_progress: "bg-amber-50 text-amber-700 border-amber-200",
    waiting_customer: "bg-purple-50 text-purple-700 border-purple-200",
    resolved: "bg-green-50 text-green-700 border-green-200",
    closed: "bg-gray-100 text-gray-500 border-gray-200",
};

export default function SuperAdminSupportPage() {
    const t = useTranslations("SuperAdminSupport");
    const ts = useTranslations("Support");
    const { instance, accounts } = useMsal();

    const [tickets, setTickets] = useState<AdminTicket[]>([]);
    const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
    const [filter, setFilter] = useState<string>("");
    const [loading, setLoading] = useState(true);

    const [selected, setSelected] = useState<AdminTicket | null>(null);
    const [messages, setMessages] = useState<TicketMessage[]>([]);
    const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
    const [threadLoading, setThreadLoading] = useState(false);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [replyFile, setReplyFile] = useState<File | null>(null);
    const searchParams = useSearchParams();
    const deepLinkHandled = useRef(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const loadQueue = useCallback(async () => {
        setLoading(true);
        try {
            const headers = await authHeaders();
            const qs = filter ? `?status=${filter}` : "";
            const res = await fetch(`/api/admin/support/tickets${qs}`, { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setTickets(json.tickets || []);
            setStatusCounts(json.statusCounts || {});
        } catch {
            toast.error(t("errorGeneric"));
        } finally {
            setLoading(false);
        }
    }, [authHeaders, filter, t]);

    useEffect(() => {
        loadQueue();
    }, [loadQueue]);

    // Deep-link desde la campanita: /superadmin/support?ticket=N abre el hilo.
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

    const openThread = async (ticket: AdminTicket) => {
        setSelected(ticket);
        setReply("");
        setThreadLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${ticket.id}?tenantId=${ticket.tenant_id}`, { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setMessages(json.messages || []);
            setAttachments(json.attachments || []);
        } catch {
            toast.error(t("errorGeneric"));
        } finally {
            setThreadLoading(false);
        }
    };

    const downloadAttachment = async (att: TicketAttachment) => {
        if (!selected) return;
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/attachments/${att.id}?tenantId=${selected.tenant_id}`, { headers });
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

    const sendReply = async () => {
        if (!selected || sending || !reply.trim()) return;
        setSending(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${selected.id}`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selected.tenant_id, message: reply.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            if (replyFile) {
                const form = new FormData();
                form.append("tenantId", selected.tenant_id);
                form.append("file", replyFile);
                const upRes = await fetch(`/api/support/tickets/${selected.id}/attachments`, { method: "POST", headers, body: form });
                if (!upRes.ok) {
                    const upJson = await upRes.json();
                    toast.error(upJson.error || t("errorGeneric"));
                }
                setReplyFile(null);
            }
            toast.success(t("sentOk"));
            setReply("");
            setSelected({ ...selected, status: json.status });
            await openThread({ ...selected, status: json.status });
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        } finally {
            setSending(false);
        }
    };

    const updateTicket = async (fields: { status?: string; priority?: string }) => {
        if (!selected) return;
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${selected.id}`, {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selected.tenant_id, ...fields }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("updated"));
            setSelected({ ...selected, ...fields } as AdminTicket);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        }
    };

    const statusBadge = (status: string) => (
        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-[6px] border ${STATUS_STYLES[status] || STATUS_STYLES.closed}`}>
            {ts(`status_${status}` as Parameters<typeof ts>[0])}
        </span>
    );

    // ── Hilo ─────────────────────────────────────────────────────────────────
    if (selected) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <button onClick={() => { setSelected(null); loadQueue(); }} className="flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink mb-4">
                    <ArrowLeft className="w-4 h-4" /> {t("backToList")}
                </button>

                <div className="bg-surface border border-line rounded-[14px] shadow-sm overflow-hidden">
                    <div className="p-[18px] border-b border-line">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <h1 className="font-heading font-bold text-[17px] text-ink">#{selected.id} · {selected.subject}</h1>
                                <div className="text-[12px] text-ink-soft mt-1">
                                    <b>{selected.tenant_name || selected.tenant_id}</b> ({selected.tenant_tier}) · {t("by")} {selected.created_by_name || selected.created_by_email}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {statusBadge(selected.status)}
                                <select
                                    value={selected.status}
                                    onChange={(e) => updateTicket({ status: e.target.value })}
                                    title={t("setStatus")}
                                    className="border border-line rounded-[8px] px-2 py-1 text-[12px] bg-surface outline-none"
                                >
                                    {STATUSES.map((s) => <option key={s} value={s}>{ts(`status_${s}` as Parameters<typeof ts>[0])}</option>)}
                                </select>
                                <select
                                    value={selected.priority}
                                    onChange={(e) => updateTicket({ priority: e.target.value })}
                                    title={t("setPriority")}
                                    className="border border-line rounded-[8px] px-2 py-1 text-[12px] bg-surface outline-none"
                                >
                                    {PRIORITIES.map((p) => <option key={p} value={p}>{ts(`priority_${p}` as Parameters<typeof ts>[0])}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="p-[18px] flex flex-col gap-3 bg-surface-2/40">
                        {threadLoading ? (
                            <div className="flex items-center gap-2 text-ink-soft text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}</div>
                        ) : messages.map((m) => (
                            <div key={m.id} className={`max-w-[85%] rounded-[12px] border p-3 ${m.author_role === "support" ? "self-end bg-[#EAF3FB] border-blue-100" : "self-start bg-surface border-line"}`}>
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
                                <Paperclip className="w-3.5 h-3.5" /> {attachments.length} adjunto(s)
                            </div>
                            <div className="flex flex-col gap-1">
                                {attachments.map((att) => (
                                    <button key={att.id} onClick={() => downloadAttachment(att)} className="flex items-center gap-2 text-[12.5px] text-brand-deep hover:underline text-left w-fit">
                                        <Download className="w-3.5 h-3.5 shrink-0" />
                                        {att.original_name}
                                        <span className="text-ink-soft">({formatBytes(att.size_bytes)}{att.uploaded_by_role === "support" ? " · 🛟" : ""})</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="p-[18px] border-t border-line flex flex-col gap-2">
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
                                {replyFile ? `${replyFile.name} (${formatBytes(replyFile.size)})` : "Adjuntar (jpg/png/txt/json, máx 5 MB)"}
                                <input type="file" accept={ATTACHMENT_EXTENSIONS} className="hidden" onChange={(e) => {
                                    const f = e.target.files?.[0] || null;
                                    if (f && !validAttachment(f)) { toast.error("Archivo inválido: jpg/jpeg/png/txt/json de hasta 5 MB."); return; }
                                    setReplyFile(f);
                                }} />
                            </label>
                            <button onClick={sendReply} disabled={sending || !reply.trim()} className="bg-brand-deep text-white px-4 py-2 rounded-[8px] font-semibold text-[13px] flex items-center gap-2 disabled:opacity-50 hover:brightness-110">
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                {sending ? t("sending") : t("send")}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Cola global ──────────────────────────────────────────────────────────
    return (
        <div className="p-6 max-w-6xl mx-auto">
            <h1 className="font-heading font-extrabold text-[20px] text-ink flex items-center gap-2">
                <LifeBuoy className="w-5 h-5 text-brand-deep" /> {t("title")}
            </h1>
            <p className="text-[13px] text-ink-soft mt-1 mb-4">{t("subtitle")}</p>

            <div className="flex gap-2 mb-4 flex-wrap">
                <button onClick={() => setFilter("")} className={`text-[12px] font-semibold px-3 py-1 rounded-[8px] border ${filter === "" ? "bg-brand-deep text-white border-brand-deep" : "bg-surface border-line text-ink-soft hover:text-ink"}`}>
                    {t("all")} ({Object.values(statusCounts).reduce((a, b) => a + b, 0)})
                </button>
                {STATUSES.map((s) => (
                    <button key={s} onClick={() => setFilter(s)} className={`text-[12px] font-semibold px-3 py-1 rounded-[8px] border ${filter === s ? "bg-brand-deep text-white border-brand-deep" : "bg-surface border-line text-ink-soft hover:text-ink"}`}>
                        {ts(`status_${s}` as Parameters<typeof ts>[0])} ({statusCounts[s] || 0})
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-ink-soft text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> {t("loading")}</div>
            ) : tickets.length === 0 ? (
                <div className="bg-surface border border-line rounded-[14px] p-10 text-center text-[13px] text-ink-soft">{t("empty")}</div>
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
                                    <b>{ticket.tenant_name || ticket.tenant_id}</b> ({ticket.tenant_tier}) · {ts(`priority_${ticket.priority}` as Parameters<typeof ts>[0])} · {ticket.message_count} 💬 · {new Date(ticket.last_message_at).toLocaleString()}
                                </div>
                            </div>
                            {statusBadge(ticket.status)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
