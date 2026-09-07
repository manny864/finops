"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import {
    IconChevronDown,
    IconCircleCheck,
    IconClock,
    IconHelpCircle,
    IconLifebuoy,
    IconLoader2,
    IconMessageCircle,
    IconMessages,
    IconPlus,
    IconRotateClockwise,
    IconSearch,
    IconShieldCheck,
    IconTicket,
} from "@tabler/icons-react";
import { toast } from "sonner";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import { CELL, ColumnMenu, SCROLL_X, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
import TicketCreateModal from "@/components/support/TicketCreateModal";
import TicketConversationDrawer, { type DrawerActions } from "@/components/support/TicketConversationDrawer";
import {
    CATEGORY_I18N,
    KpiCard,
    PRIORITY_I18N,
    PriorityPill,
    SlaBadge,
    STATUS_I18N,
    StatusBadge,
    formatDateTime,
} from "@/components/support/supportUi";
import type {
    CreateTicketPayload,
    SupportTicketItem,
    TicketAttachmentItem,
    TicketMessageItem,
    TicketStatus,
    UserSupportPayload,
} from "@/types/supportTickets.types";

/**
 * Soporte — vista del usuario del tenant.
 *
 * Tenant demo: los datos sintéticos los sirve la propia ruta
 * (`/api/support/tickets` chequea `isMockTenant`), así que acá no hay una rama
 * de mock aparte. Un tenant real con cero tickets muestra el empty state
 * legítimo; nunca se rellena con demo.
 *
 * RBAC: cualquier miembro del tenant puede ver y crear sus tickets. El backend
 * valida pertenencia en cada request (`requireTenantAccess`).
 */

const TICKET_COLUMNS: TableColumnConfig[] = [
    { id: "number", label: "# Ticket", visible: true },
    { id: "subject", label: "Asunto", visible: true },
    { id: "category", label: "Categoría", visible: true },
    { id: "priority", label: "Prioridad", visible: true },
    { id: "status", label: "Estado", visible: true },
    { id: "updated", label: "Última actualización", visible: true },
    { id: "sla", label: "SLA restante", visible: true },
    { id: "actions", label: "Acciones", visible: true },
];

const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";

export default function SupportPage() {
    const t = useTranslations("Support");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const searchParams = useSearchParams();

    const tenantId = selectedTenant?.id || "";
    const isMock = useMemo(
        () =>
            isMockTenant(tenantId) ||
            searchParams.get("mock") === "true" ||
            tenantId.startsWith("demo-") ||
            tenantId.startsWith("mock-"),
        [tenantId, searchParams]
    );

    const [payload, setPayload] = useState<UserSupportPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");

    const [selected, setSelected] = useState<SupportTicketItem | null>(null);
    const [messages, setMessages] = useState<TicketMessageItem[]>([]);
    const [orphanAttachments, setOrphanAttachments] = useState<TicketAttachmentItem[]>([]);
    const [threadLoading, setThreadLoading] = useState(false);

    const cols = useColumnConfig(`table_columns_config_user_tickets_${tenantId}`, TICKET_COLUMNS);
    const deepLinkHandled = useRef(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    // Sin cuenta MSAL y sin tenant demo no se despacha nada: es la guarda que
    // evita el 401 a los 11 ms cuando MSAL todavía está resolviendo la sesión.
    const canFetch = Boolean(tenantId) && tenantId !== "default" && (isMock || accounts.length > 0);

    const loadTickets = useCallback(async () => {
        if (!canFetch) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`, { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setPayload(json as UserSupportPayload);
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setLoading(false);
        }
    }, [canFetch, authHeaders, tenantId, isMock, t]);

    useEffect(() => {
        loadTickets();
    }, [loadTickets]);

    const tickets = payload?.summary.tickets || [];

    const openThread = useCallback(
        async (ticket: SupportTicketItem) => {
            setSelected(ticket);
            setMessages(ticket.messages || []);
            setOrphanAttachments([]);
            if (isMock) return;
            setThreadLoading(true);
            try {
                const headers = await authHeaders();
                const res = await fetch(`/api/support/tickets/${ticket.id}?tenantId=${encodeURIComponent(tenantId)}`, { headers });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error);
                setSelected(json.ticket);
                setMessages(json.messages || []);
                setOrphanAttachments(json.attachments || []);
            } catch (e) {
                toast.error(errorMessage(e) || t("errorGeneric"));
            } finally {
                setThreadLoading(false);
            }
        },
        [isMock, authHeaders, tenantId, t]
    );

    // Deep-link desde la campanita: /support?ticket=N abre el hilo directamente.
    useEffect(() => {
        const param = searchParams.get("ticket");
        if (deepLinkHandled.current || !param || tickets.length === 0) return;
        const target = tickets.find((tk) => tk.id === param);
        if (target) {
            deepLinkHandled.current = true;
            openThread(target);
        }
    }, [tickets, searchParams, openThread]);

    const createTicket = async (form: CreateTicketPayload) => {
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
                body: JSON.stringify({
                    tenantId,
                    subject: form.subject,
                    category: form.category,
                    priority: form.priority,
                    messageText: form.messageText,
                    relatedModule: form.relatedModule,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            for (const file of form.attachments || []) {
                await uploadAttachment(json.ticketId, file, null);
            }
            toast.success(t("createdOk"));
            setShowCreate(false);
            await loadTickets();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setCreating(false);
        }
    };

    const uploadAttachment = async (ticketId: string | number, file: File, messageId: number | null): Promise<boolean> => {
        try {
            const headers = await authHeaders();
            const body = new FormData();
            body.append("tenantId", tenantId);
            body.append("file", file);
            if (messageId) body.append("messageId", String(messageId));
            const res = await fetch(`/api/support/tickets/${ticketId}/attachments`, { method: "POST", headers, body });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            return true;
        } catch (e) {
            toast.error(errorMessage(e) || t("attachError"));
            return false;
        }
    };

    const fetchAttachmentBlob = async (attachmentId: string): Promise<Blob | null> => {
        if (isMock) {
            toast.info(t("attachDemoNote"));
            return null;
        }
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/support/attachments/${attachmentId}?tenantId=${encodeURIComponent(tenantId)}`, { headers });
            if (!res.ok) throw new Error((await res.json()).error);
            return await res.blob();
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
            return null;
        }
    };

    const drawerActions: DrawerActions = {
        sendMessage: async (text) => {
            if (!selected) return null;
            if (isMock) {
                toast.success(t("sentOk"));
                return null;
            }
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${selected.id}`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, message: text }),
            });
            const json = await res.json();
            if (!res.ok) {
                toast.error(json.error || t("errorGeneric"));
                return null;
            }
            toast.success(t("sentOk"));
            return json.messageId ?? null;
        },
        uploadAttachment: async (file, messageId) => (selected ? uploadAttachment(selected.id, file, messageId) : false),
        downloadAttachment: async (attachmentId, fileName) => {
            const blob = await fetchAttachmentBlob(attachmentId);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
        },
        previewAttachment: async (attachmentId) => {
            const blob = await fetchAttachmentBlob(attachmentId);
            return blob ? URL.createObjectURL(blob) : null;
        },
        // El usuario del tenant sólo puede cerrar o reabrir; el backend rechaza
        // los estados intermedios para un rol no-soporte.
        changeStatus: async (status) => {
            if (!selected || (status !== "CLOSED" && status !== "OPEN")) return;
            if (isMock) {
                setSelected({ ...selected, status });
                return;
            }
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${selected.id}`, {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, status: status === "CLOSED" ? "closed" : "open" }),
            });
            if (!res.ok) {
                toast.error((await res.json()).error || t("errorGeneric"));
                return;
            }
            setSelected({ ...selected, status });
            await loadTickets();
        },
        refresh: async () => {
            if (selected) await openThread(selected);
            await loadTickets();
        },
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return tickets.filter((tk) => {
            if (statusFilter && tk.status !== statusFilter) return false;
            if (!q) return true;
            return (
                tk.subject.toLowerCase().includes(q) ||
                tk.ticketNumber.toLowerCase().includes(q) ||
                tk.creatorEmail.toLowerCase().includes(q)
            );
        });
    }, [tickets, search, statusFilter]);

    const pg = usePagination(filtered, 15);
    const summary = payload?.summary;
    const quota = payload?.quota;
    const quotaExhausted = quota?.monthlyLimit != null && quota.usedThisMonth >= quota.monthlyLimit;

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
                <div>
                    <h1 className="font-heading font-extrabold text-[20px] text-slate-900 dark:text-white flex items-center">
                        <IconLifebuoy size={24} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                        {t("title")}
                        <InfoTooltip content={t("titleHelp")} />
                    </h1>
                    <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">{t("subtitle")}</p>
                    {quota && (
                        <div className="flex items-center gap-3 mt-2 text-[12px] text-slate-500 dark:text-slate-400 flex-wrap">
                            <span className="flex items-center">
                                <IconClock size={16} stroke={1.5} className="inline mr-1 text-[#0078D4]" />
                                {t("slaNote", { hours: quota.firstResponseSlaHours })}
                            </span>
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
                    className="bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold px-4 py-2 rounded-lg text-[13px] flex items-center disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                    <IconPlus size={16} stroke={2} className="inline mr-1.5" />
                    {t("newTicket")}
                </button>
            </div>

            {payload?.mock && (
                <div className="mb-4 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                    {t("mockBanner")}
                </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <KpiCard
                    icon={IconTicket}
                    label={t("kpiOpen")}
                    value={summary?.openTicketsCount ?? 0}
                    tone="#0078D4"
                    tooltip={<InfoTooltip content={t("kpiOpenHelp")} />}
                />
                <KpiCard
                    icon={IconRotateClockwise}
                    label={t("kpiInProgress")}
                    value={summary?.inProgressCount ?? 0}
                    tone="#2563EB"
                    tooltip={<InfoTooltip content={t("kpiInProgressHelp")} />}
                />
                <KpiCard
                    icon={IconCircleCheck}
                    label={t("kpiResolved")}
                    value={summary?.resolvedCount ?? 0}
                    tone="#0284C7"
                    tooltip={<InfoTooltip content={t("kpiResolvedHelp")} />}
                />
                <KpiCard
                    icon={IconShieldCheck}
                    label={t("kpiSla")}
                    value={`< ${summary?.planSlaHours ?? quota?.firstResponseSlaHours ?? 4} h`}
                    tone="#1B2A41"
                    hint={t("kpiSlaHint")}
                    tooltip={<InfoTooltip content={t("kpiSlaHelp")} />}
                />
            </div>

            <TroubleshootingSection />

            {/* Contenido principal */}
            {loading ? (
                <div className="flex items-center gap-2 text-slate-500 text-[13px]">
                    <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                </div>
            ) : tickets.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-12 text-center rounded-xl">
                    <IconMessageCircle size={40} stroke={1.5} className="text-[#0078D4] mx-auto mb-3" />
                    <div className="font-bold text-[15px] text-slate-900 dark:text-white">{t("emptyTitle")}</div>
                    <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 mb-4">{t("emptyBody")}</div>
                    <button
                        onClick={() => setShowCreate(true)}
                        disabled={quotaExhausted}
                        className="bg-[#0078D4] text-white hover:bg-[#0060AA] font-semibold px-4 py-2 rounded-lg text-[13px] inline-flex items-center disabled:opacity-50 cursor-pointer"
                    >
                        <IconPlus size={16} stroke={2} className="inline mr-1.5" />
                        {t("emptyCta")}
                    </button>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <div className="p-3 flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 dark:border-slate-800">
                        <h2 className="font-heading font-bold text-[14px] text-slate-900 dark:text-white flex items-center">
                            {t("myTickets")}
                            <InfoTooltip content={t("myTicketsHelp")} />
                        </h2>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={t("searchPlaceholder")}
                                    className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] w-52"
                                />
                            </div>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as TicketStatus | "")}
                                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
                            >
                                <option value="">{t("allStatuses")}</option>
                                {(["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"] as TicketStatus[]).map((s) => (
                                    <option key={s} value={s}>
                                        {t(STATUS_I18N[s] as never)}
                                    </option>
                                ))}
                            </select>
                            <ColumnMenu {...cols} label={t("customizeColumns")} />
                        </div>
                    </div>

                    <div className={SCROLL_X}>
                        <table className="w-full table-fixed">
                            <thead className="bg-slate-50 dark:bg-slate-800/50">
                                <tr>
                                    {TICKET_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                                        <ResizableTh key={c.id} minWidth={100} className={TH}>
                                            {t(`col_${c.id}` as never)}
                                            <InfoTooltip content={t(`col_${c.id}_help` as never)} />
                                        </ResizableTh>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {pg.paged.map((tk) => (
                                    <tr key={tk.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                                        {cols.isVisible("number") && (
                                            <td className={TD}>
                                                <span className="font-mono font-bold text-[#0078D4]">{tk.ticketNumber}</span>
                                            </td>
                                        )}
                                        {cols.isVisible("subject") && (
                                            <td className={TD}>
                                                <div className={`${CELL} font-semibold text-slate-900 dark:text-white`} title={tk.subject}>
                                                    {tk.subject}
                                                </div>
                                                {tk.lastMessageSnippet && (
                                                    <div className={`${CELL} text-[11px] text-slate-500`} title={tk.lastMessageSnippet}>
                                                        {tk.lastMessageSnippet}
                                                    </div>
                                                )}
                                            </td>
                                        )}
                                        {cols.isVisible("category") && <td className={TD}>{t(CATEGORY_I18N[tk.category] as never)}</td>}
                                        {cols.isVisible("priority") && (
                                            <td className={TD}>
                                                <PriorityPill priority={tk.priority} label={t(PRIORITY_I18N[tk.priority] as never)} />
                                            </td>
                                        )}
                                        {cols.isVisible("status") && (
                                            <td className={TD}>
                                                <StatusBadge status={tk.status} label={t(STATUS_I18N[tk.status] as never)} />
                                            </td>
                                        )}
                                        {cols.isVisible("updated") && <td className={TD}>{formatDateTime(tk.updatedAt)}</td>}
                                        {cols.isVisible("sla") && (
                                            <td className={TD}>
                                                <SlaBadge minutes={tk.slaRemainingMinutes} atRisk={tk.isSlaBreachRisk} expiredLabel={t("slaExpired")} />
                                            </td>
                                        )}
                                        {cols.isVisible("actions") && (
                                            <td className={TD}>
                                                <button
                                                    onClick={() => openThread(tk)}
                                                    className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] dark:text-blue-400 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                >
                                                    <IconMessages size={16} stroke={1.5} className="inline mr-1" />
                                                    {t("viewConversation")}
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-3">
                        <Pagination {...pg} pageSizes={[15, 30, 45, 60]} />
                    </div>
                </div>
            )}

            {showCreate && <TicketCreateModal onClose={() => setShowCreate(false)} onSubmit={createTicket} submitting={creating} />}

            {selected && (
                <TicketConversationDrawer
                    ticket={selected}
                    messages={messages}
                    orphanAttachments={orphanAttachments}
                    mode="user"
                    loading={threadLoading}
                    onClose={() => setSelected(null)}
                    actions={drawerActions}
                />
            )}
        </div>
    );
}

/**
 * Base de conocimiento plegable. Los artículos y su disclaimer viven en los
 * diccionarios (`troubleshooting_items`), no acá: son contenido editorial y
 * tienen que traducirse sin tocar el componente.
 */
function TroubleshootingSection() {
    const t = useTranslations("Support");
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const items = t.raw("troubleshooting_items") as { q: string; a: string }[];

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter((i) => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q));
    }, [items, query]);

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl mb-5 overflow-hidden w-full">
            <div
                role="button"
                tabIndex={0}
                onClick={() => setOpen(!open)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen(!open);
                    }
                }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer select-none"
            >
                <span className="flex items-center font-semibold text-[14px] text-slate-900 dark:text-white">
                    <IconHelpCircle size={18} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                    {t("troubleshootingTitle")}
                    <span onClick={(e) => e.stopPropagation()}>
                        <InfoTooltip content={t("troubleshootingHelp")} />
                    </span>
                </span>
                <IconChevronDown size={16} stroke={1.5} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
            </div>

            {open && (
                <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-800 pt-3">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-3">{t("troubleshootingSubtitle")}</p>

                    <div className="relative mb-3 max-w-md">
                        <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("troubleshootingSearch")}
                            className="w-full pl-8 pr-3 py-1.5 text-[12.5px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4]"
                        />
                    </div>

                    <div className="flex items-start gap-2 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2.5 mb-4">
                        <IconHelpCircle size={16} stroke={1.5} className="text-[#0078D4] shrink-0 mt-0.5" />
                        <p className="text-[12.5px] text-slate-700 dark:text-slate-300">{t("troubleshootingDisclaimer")}</p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                        {filtered.map((item, i) => (
                            <details key={i} className="group border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900">
                                <summary className="cursor-pointer text-[13px] font-semibold text-slate-900 dark:text-white list-none flex items-start justify-between gap-2">
                                    {item.q}
                                    <IconChevronDown size={14} stroke={1.5} className="text-slate-400 shrink-0 mt-0.5 transition-transform group-open:rotate-180" />
                                </summary>
                                <p className="text-[12.5px] text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">{item.a}</p>
                            </details>
                        ))}
                        {filtered.length === 0 && <p className="text-[12.5px] text-slate-500">{t("troubleshootingNoResults")}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
