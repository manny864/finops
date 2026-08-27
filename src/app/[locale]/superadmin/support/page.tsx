"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import {
    IconAlertCircle,
    IconCheck,
    IconClockCheck,
    IconInbox,
    IconLifebuoy,
    IconLoader2,
    IconSearch,
    IconSparkles,
    IconUserCheck,
    IconUserQuestion,
} from "@tabler/icons-react";
import { toast } from "sonner";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import { CELL, ColumnMenu, SCROLL_X, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
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
    GlobalSupportPayload,
    SupportTicketItem,
    TicketAttachmentItem,
    TicketMessageItem,
    TicketPriority,
    TicketStatus,
} from "@/types/supportTickets.types";

/**
 * Soporte (Global) — cola de tickets de todos los tenants.
 *
 * Sin rama de demo: `requireSuperAdmin` exige dominio corporativo y rol
 * SUPERADMIN en base, así que no existe un superadmin sintético al que servirle
 * mocks. Si la cola está vacía se muestra vacía.
 *
 * RBAC: la ruta de listado es superadmin-only. Las respuestas y cambios de
 * estado van por `/api/support/tickets/[id]` con el tenantId del ticket, que
 * revalida acceso y detecta al agente por dominio + rol.
 */

const GLOBAL_COLUMNS: TableColumnConfig[] = [
    { id: "number", label: "# Ticket", visible: true },
    { id: "tenant", label: "Organización / Tenant", visible: true },
    { id: "subject", label: "Asunto", visible: true },
    { id: "category", label: "Categoría", visible: true },
    { id: "priority", label: "Prioridad", visible: true },
    { id: "assignee", label: "Asignado a", visible: true },
    { id: "status", label: "Estado", visible: true },
    { id: "sla", label: "SLA restante", visible: true },
    { id: "created", label: "Fecha de creación", visible: true },
    { id: "actions", label: "Acciones rápidas", visible: true },
];

const STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"];
const PRIORITIES: TicketPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

// Secuencia armónica de las pills de estado (directiva de botones corporativos).
const PILL_TONES = ["#0078D4", "#00AEEF", "#10B981", "#8B5CF6", "#F59E0B", "#0284C7"];

const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";

export default function SuperAdminSupportPage() {
    const t = useTranslations("SuperAdminSupport");
    const ts = useTranslations("Support");
    const { instance, accounts } = useMsal();
    const searchParams = useSearchParams();

    const [payload, setPayload] = useState<GlobalSupportPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
    const [tenantFilter, setTenantFilter] = useState("");
    const [priorityFilter, setPriorityFilter] = useState<TicketPriority | "">("");
    const [assigneeFilter, setAssigneeFilter] = useState<"" | "mine" | "unassigned">("");
    const [search, setSearch] = useState("");

    const [selected, setSelected] = useState<SupportTicketItem | null>(null);
    const [messages, setMessages] = useState<TicketMessageItem[]>([]);
    const [orphanAttachments, setOrphanAttachments] = useState<TicketAttachmentItem[]>([]);
    const [threadLoading, setThreadLoading] = useState(false);

    const cols = useColumnConfig("table_columns_config_global_tickets", GLOBAL_COLUMNS);
    const deepLinkHandled = useRef(false);
    const myEmail = accounts[0]?.username?.toLowerCase() || "";

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const loadQueue = useCallback(async () => {
        if (accounts.length === 0) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const headers = await authHeaders();
            const qs = statusFilter ? `?status=${statusFilter}` : "";
            const res = await fetch(`/api/admin/support/tickets${qs}`, { headers });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setPayload(json as GlobalSupportPayload);
        } catch (e) {
            toast.error(errorMessage(e) || t("errorGeneric"));
        } finally {
            setLoading(false);
        }
    }, [accounts.length, authHeaders, statusFilter, t]);

    useEffect(() => {
        loadQueue();
    }, [loadQueue]);

    const tickets = payload?.summary.tickets || [];

    const openThread = useCallback(
        async (ticket: SupportTicketItem) => {
            setSelected(ticket);
            setMessages([]);
            setOrphanAttachments([]);
            setThreadLoading(true);
            try {
                const headers = await authHeaders();
                const res = await fetch(`/api/support/tickets/${ticket.id}?tenantId=${encodeURIComponent(ticket.tenantId)}`, { headers });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error);
                setSelected({ ...json.ticket, tenantDisplayName: ticket.tenantDisplayName });
                setMessages(json.messages || []);
                setOrphanAttachments(json.attachments || []);
            } catch (e) {
                toast.error(errorMessage(e) || t("errorGeneric"));
            } finally {
                setThreadLoading(false);
            }
        },
        [authHeaders, t]
    );

    // Deep-link desde la campanita: /superadmin/support?ticket=N abre el hilo.
    useEffect(() => {
        const param = searchParams.get("ticket");
        if (deepLinkHandled.current || !param || tickets.length === 0) return;
        const target = tickets.find((tk) => tk.id === param);
        if (target) {
            deepLinkHandled.current = true;
            openThread(target);
        }
    }, [tickets, searchParams, openThread]);

    /** Asigna (o libera) un ticket. Optimista: la fila se actualiza antes de la respuesta. */
    const assign = async (ticket: SupportTicketItem, release = false) => {
        const previous = ticket.assignedAdminEmail;
        const next = release ? undefined : myEmail;
        setPayload((p) =>
            p
                ? {
                    ...p,
                    summary: {
                        ...p.summary,
                        tickets: p.summary.tickets.map((tk) => (tk.id === ticket.id ? { ...tk, assignedAdminEmail: next } : tk)),
                    },
                }
                : p
        );
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/admin/support/tickets", {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ ticketId: Number(ticket.id), assignedAdminEmail: release ? null : "me" }),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            toast.success(release ? t("released") : t("taken"));
            await loadQueue();
        } catch (e) {
            // Rollback: si el PATCH falla la fila vuelve a su asignación real.
            setPayload((p) =>
                p
                    ? {
                        ...p,
                        summary: {
                            ...p.summary,
                            tickets: p.summary.tickets.map((tk) => (tk.id === ticket.id ? { ...tk, assignedAdminEmail: previous } : tk)),
                        },
                    }
                    : p
            );
            toast.error(errorMessage(e) || t("errorGeneric"));
        }
    };

    const patchTicket = async (ticket: SupportTicketItem, body: Record<string, unknown>) => {
        const headers = await authHeaders();
        const res = await fetch(`/api/support/tickets/${ticket.id}`, {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId: ticket.tenantId, ...body }),
        });
        if (!res.ok) {
            toast.error((await res.json()).error || t("errorGeneric"));
            return false;
        }
        toast.success(t("updated"));
        await loadQueue();
        return true;
    };

    const fetchAttachmentBlob = async (attachmentId: string, tenantId: string): Promise<Blob | null> => {
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
        sendMessage: async (text, isInternalNote) => {
            if (!selected) return null;
            const headers = await authHeaders();
            const res = await fetch(`/api/support/tickets/${selected.id}`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selected.tenantId, message: text, isInternalNote }),
            });
            const json = await res.json();
            if (!res.ok) {
                toast.error(json.error || t("errorGeneric"));
                return null;
            }
            toast.success(isInternalNote ? t("noteSaved") : t("sentOk"));
            return json.messageId ?? null;
        },
        uploadAttachment: async (file, messageId) => {
            if (!selected) return false;
            try {
                const headers = await authHeaders();
                const body = new FormData();
                body.append("tenantId", selected.tenantId);
                body.append("file", file);
                if (messageId) body.append("messageId", String(messageId));
                const res = await fetch(`/api/support/tickets/${selected.id}/attachments`, { method: "POST", headers, body });
                if (!res.ok) throw new Error((await res.json()).error);
                return true;
            } catch (e) {
                toast.error(errorMessage(e) || ts("attachError"));
                return false;
            }
        },
        downloadAttachment: async (attachmentId, fileName) => {
            if (!selected) return;
            const blob = await fetchAttachmentBlob(attachmentId, selected.tenantId);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
        },
        previewAttachment: async (attachmentId) => {
            if (!selected) return null;
            const blob = await fetchAttachmentBlob(attachmentId, selected.tenantId);
            return blob ? URL.createObjectURL(blob) : null;
        },
        changeStatus: async (status) => {
            if (!selected) return;
            const dbStatus = { OPEN: "open", IN_PROGRESS: "in_progress", WAITING_USER: "waiting_customer", RESOLVED: "resolved", CLOSED: "closed" }[status];
            if (await patchTicket(selected, { status: dbStatus })) setSelected({ ...selected, status });
        },
        changePriority: async (priority) => {
            if (!selected) return;
            const dbPriority = { CRITICAL: "urgent", HIGH: "high", MEDIUM: "medium", LOW: "low" }[priority];
            if (await patchTicket(selected, { priority: dbPriority })) setSelected({ ...selected, priority });
        },
        assignToMe: async () => {
            if (!selected) return;
            await assign(selected, selected.assignedAdminEmail === myEmail);
            setSelected({ ...selected, assignedAdminEmail: selected.assignedAdminEmail === myEmail ? undefined : myEmail });
        },
        refresh: async () => {
            if (selected) await openThread(selected);
            await loadQueue();
        },
    };

    const tenantOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const tk of tickets) if (!seen.has(tk.tenantId)) seen.set(tk.tenantId, tk.tenantDisplayName || tk.tenantId);
        return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [tickets]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return tickets.filter((tk) => {
            if (tenantFilter && tk.tenantId !== tenantFilter) return false;
            if (priorityFilter && tk.priority !== priorityFilter) return false;
            if (assigneeFilter === "mine" && tk.assignedAdminEmail?.toLowerCase() !== myEmail) return false;
            if (assigneeFilter === "unassigned" && tk.assignedAdminEmail) return false;
            if (!q) return true;
            return (
                tk.subject.toLowerCase().includes(q) ||
                tk.creatorEmail.toLowerCase().includes(q) ||
                tk.ticketNumber.toLowerCase().includes(q) ||
                (tk.tenantDisplayName || "").toLowerCase().includes(q)
            );
        });
    }, [tickets, tenantFilter, priorityFilter, assigneeFilter, search, myEmail]);

    const pg = usePagination(filtered, 15);
    const summary = payload?.summary;
    const counts = payload?.statusCounts;
    const totalAll = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-5">
                <h1 className="font-heading font-extrabold text-[20px] text-slate-900 dark:text-white flex items-center">
                    <IconLifebuoy size={24} stroke={1.5} className="text-[#0078D4] inline mr-2" />
                    {t("title")}
                    <InfoTooltip content={t("titleHelp")} />
                </h1>
                <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>

            {/* KPIs globales */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <KpiCard
                    icon={IconInbox}
                    label={t("kpiTotal")}
                    value={summary?.totalTicketsCount ?? 0}
                    tone="#0078D4"
                    tooltip={<InfoTooltip content={t("kpiTotalHelp")} />}
                />
                <KpiCard
                    icon={IconUserQuestion}
                    label={t("kpiUnassigned")}
                    value={summary?.unassignedCount ?? 0}
                    tone="#2563EB"
                    tooltip={<InfoTooltip content={t("kpiUnassignedHelp")} />}
                />
                <KpiCard
                    icon={IconAlertCircle}
                    label={t("kpiSlaRisk")}
                    value={summary?.slaBreachRiskCount ?? 0}
                    tone="#0284C7"
                    badge={
                        (summary?.slaBreachRiskCount ?? 0) > 0 ? (
                            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" title={t("kpiSlaRiskHelp")} />
                        ) : (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                        )
                    }
                    tooltip={<InfoTooltip content={t("kpiSlaRiskHelp")} />}
                />
                <KpiCard
                    icon={IconClockCheck}
                    label={t("kpiMttr")}
                    value={summary?.avgResolutionTimeHours ? `${summary.avgResolutionTimeHours} h` : "—"}
                    tone="#1B2A41"
                    hint={t("kpiMttrHint")}
                    tooltip={<InfoTooltip content={t("kpiMttrHelp")} />}
                />
            </div>

            {/* Filtros */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 mb-5 flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => setStatusFilter("")}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white dark:bg-slate-900 cursor-pointer whitespace-nowrap ${statusFilter === "" ? "" : "opacity-60"
                            }`}
                        style={{ borderColor: PILL_TONES[0], color: PILL_TONES[0] }}
                    >
                        {t("all")} ({totalAll})
                    </button>
                    {STATUSES.map((s, i) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white dark:bg-slate-900 cursor-pointer whitespace-nowrap ${statusFilter === s ? "" : "opacity-60"
                                }`}
                            style={{ borderColor: PILL_TONES[i + 1], color: PILL_TONES[i + 1] }}
                        >
                            {ts(STATUS_I18N[s] as never)} ({counts?.[s] ?? 0})
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <IconSearch size={14} stroke={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t("searchPlaceholder")}
                            className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-[#0078D4] w-64"
                        />
                    </div>
                    <select
                        value={tenantFilter}
                        onChange={(e) => setTenantFilter(e.target.value)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer max-w-[220px]"
                    >
                        <option value="">{t("allTenants")}</option>
                        {tenantOptions.map(([id, name]) => (
                            <option key={id} value={id}>
                                {name}
                            </option>
                        ))}
                    </select>
                    <select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value as TicketPriority | "")}
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                        <option value="">{t("allPriorities")}</option>
                        {PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                                {ts(PRIORITY_I18N[p] as never)}
                            </option>
                        ))}
                    </select>
                    <select
                        value={assigneeFilter}
                        onChange={(e) => setAssigneeFilter(e.target.value as "" | "mine" | "unassigned")}
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                        <option value="">{t("allAgents")}</option>
                        <option value="mine">{t("myTickets")}</option>
                        <option value="unassigned">{t("unassignedFilter")}</option>
                    </select>
                    <ColumnMenu {...cols} label={t("customizeColumns")} />
                </div>
            </div>

            {/* Tabla maestra */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {loading ? (
                    <div className="p-6 flex items-center gap-2 text-slate-500 text-[13px]">
                        <IconLoader2 size={16} className="animate-spin text-[#0078D4]" /> {t("loading")}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <IconInbox size={40} stroke={1.5} className="text-[#0078D4] mx-auto mb-3" />
                        <div className="font-bold text-[15px] text-slate-900 dark:text-white">{t("empty")}</div>
                    </div>
                ) : (
                    <>
                        <div className={SCROLL_X}>
                            <table className="w-full table-fixed">
                                <thead className="bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        {GLOBAL_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
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
                                            {cols.isVisible("tenant") && (
                                                <td className={TD}>
                                                    <span
                                                        className={`${CELL} inline-block text-[11px] font-semibold px-2 py-[3px] rounded-md bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800`}
                                                        title={tk.tenantDisplayName || tk.tenantId}
                                                    >
                                                        {tk.tenantDisplayName || tk.tenantId}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible("subject") && (
                                                <td className={TD}>
                                                    <div className={`${CELL} font-semibold text-slate-900 dark:text-white`} title={tk.subject}>
                                                        {tk.subject}
                                                    </div>
                                                    <div className={`${CELL} text-[11px] text-slate-500`} title={tk.creatorEmail}>
                                                        {tk.creatorEmail}
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible("category") && <td className={TD}>{ts(CATEGORY_I18N[tk.category] as never)}</td>}
                                            {cols.isVisible("priority") && (
                                                <td className={TD}>
                                                    <select
                                                        value={tk.priority}
                                                        onChange={async (e) => {
                                                            const newP = e.target.value as TicketPriority;
                                                            const dbP = { CRITICAL: "urgent", HIGH: "high", MEDIUM: "medium", LOW: "low" }[newP];
                                                            await patchTicket(tk, { priority: dbP });
                                                        }}
                                                        className="text-[11px] font-semibold rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as TicketPriority[]).map((p) => (
                                                            <option key={p} value={p}>
                                                                {ts(PRIORITY_I18N[p] as never)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </td>
                                            )}
                                            {cols.isVisible("assignee") && (
                                                <td className={TD}>
                                                    {tk.assignedAdminEmail ? (
                                                        <span className="flex items-center gap-1.5">
                                                            <span className="w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] text-[10px] font-bold grid place-items-center border border-blue-200 dark:border-blue-800">
                                                                {(tk.assignedAdminName || tk.assignedAdminEmail).slice(0, 2).toUpperCase()}
                                                            </span>
                                                            <span className={CELL} title={tk.assignedAdminEmail}>
                                                                {tk.assignedAdminName || tk.assignedAdminEmail}
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                            {t("unassignedFilter")}
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            {cols.isVisible("status") && (
                                                <td className={TD}>
                                                    <StatusBadge status={tk.status} label={ts(STATUS_I18N[tk.status] as never)} />
                                                </td>
                                            )}
                                            {cols.isVisible("sla") && (
                                                <td className={TD}>
                                                    <SlaBadge minutes={tk.slaRemainingMinutes} atRisk={tk.isSlaBreachRisk} expiredLabel={ts("slaExpired")} />
                                                </td>
                                            )}
                                            {cols.isVisible("created") && <td className={TD}>{formatDateTime(tk.createdAt)}</td>}
                                            {cols.isVisible("actions") && (
                                                <td className={TD}>
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <button
                                                            onClick={() => openThread(tk)}
                                                            className="text-xs font-semibold rounded-lg border border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                        >
                                                            <IconSparkles size={16} stroke={1.5} className="inline mr-1 text-[#0078D4]" />
                                                            {t("attend")}
                                                        </button>
                                                        <button
                                                            onClick={() => assign(tk, tk.assignedAdminEmail?.toLowerCase() === myEmail)}
                                                            className="text-xs font-semibold rounded-lg border border-[#00AEEF] text-[#00AEEF] bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                        >
                                                            <IconUserCheck size={16} stroke={1.5} className="inline mr-1" />
                                                            {tk.assignedAdminEmail?.toLowerCase() === myEmail ? t("release") : t("take")}
                                                        </button>
                                                        {tk.status !== "RESOLVED" && tk.status !== "CLOSED" && (
                                                            <button
                                                                onClick={() => patchTicket(tk, { status: "resolved" })}
                                                                className="text-xs font-semibold rounded-lg border border-emerald-600 text-emerald-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
                                                            >
                                                                <IconCheck size={16} stroke={2} className="inline mr-1 text-emerald-600" />
                                                                {t("resolve")}
                                                            </button>
                                                        )}
                                                    </div>
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
                    </>
                )}
            </div>

            {selected && (
                <TicketConversationDrawer
                    ticket={selected}
                    messages={messages}
                    orphanAttachments={orphanAttachments}
                    mode="agent"
                    loading={threadLoading}
                    onClose={() => setSelected(null)}
                    actions={drawerActions}
                />
            )}
        </div>
    );
}
