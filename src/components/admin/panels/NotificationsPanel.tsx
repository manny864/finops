"use client";
/**
 * Configuración Global — pestaña Notificaciones.
 *
 * Refactor visual sobre la lógica existente. Lo que NO cambió y no debe cambiar:
 *   - Los siete contratos de API (GET / POST / PUT edición / PUT toggle /
 *     DELETE / POST test / PATCH master), incluidos los dos PUT al MISMO
 *     endpoint con bodies distintos.
 *   - La forma exacta de `config_json`: `{ webhook_url }` para slack/teams/
 *     webhook y `{ recipients: [...] }` para email. El motor de despacho
 *     (`src/lib/notifications.ts`) lee esas claves.
 *   - `severityFilter` sigue siendo la lista cruda ('info,warning,error') que
 *     el dispatcher parsea con split(','). Se muestra con etiqueta legible pero
 *     se guarda igual.
 *   - El botón "volver" del modal sólo aparece en alta, no en edición.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    IconAlertOctagon,
    IconAlertTriangle,
    IconBellRinging,
    IconBrandSlack,
    IconBrandTeams,
    IconCircleCheck,
    IconEdit,
    IconLoader2,
    IconMail,
    IconPlus,
    IconSend,
    IconShare,
    IconSparkles,
    IconTrash,
    IconWebhook,
    IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { errorMessage } from '@/lib/apiErrors';
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import { CELL, ColumnMenu, SCROLL_X, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
import { severityFilterFromDb } from "@/types/tenantNotifications.types";
import { isMockTenant } from "@/lib/mockData";

type ChannelType = "slack" | "teams" | "email" | "webhook";

interface Channel {
    id: number;
    type: ChannelType;
    name: string;
    config_json?: { webhook_url?: string; recipients?: string[] };
    severity_filter: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
    event_categories?: string[];
    last_delivered_at?: string | null;
    last_delivery_status?: "SUCCESS" | "FAILED" | null;
}

const CHANNEL_COLUMNS: TableColumnConfig[] = [
    { id: "name", label: "Nombre", visible: true },
    { id: "type", label: "Tipo", visible: true },
    { id: "severity", label: "Severidad", visible: true },
    { id: "categories", label: "Categorías", visible: true },
    { id: "status", label: "Estado", visible: true },
    { id: "lastDelivery", label: "Último disparo", visible: true },
    { id: "actions", label: "Acciones", visible: true },
];

const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const TD = "px-3 py-2.5 text-[12.5px] text-slate-700 dark:text-slate-300 align-middle";
const BADGE = "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border whitespace-nowrap";

const BTN_PRIMARY =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium " +
    "bg-[#0078D4] text-white border border-[#0078D4] hover:bg-[#0060AA] disabled:opacity-50 transition-colors";
const BTN_NEUTRAL =
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium " +
    "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 " +
    "hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors";
const BTN_TEST =
    "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium " +
    "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 " +
    "hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors";

const INPUT =
    "w-full px-3.5 py-2.5 rounded-lg text-sm bg-white dark:bg-slate-800 " +
    "border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white " +
    "outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] transition-colors";

const LABEL = "text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

/** Iconografía Tabler por tipo, en azul corporativo (antes badges morado/naranja). */
function typeIcon(type: string) {
    switch (type) {
        case "slack": return <IconBrandSlack size={14} stroke={1.5} className="text-[#0078D4]" />;
        case "teams": return <IconBrandTeams size={14} stroke={1.5} className="text-[#0078D4]" />;
        case "email": return <IconMail size={14} stroke={1.5} className="text-[#0078D4]" />;
        default: return <IconWebhook size={14} stroke={1.5} className="text-[#0078D4]" />;
    }
}

function typeLabel(type: string): string {
    switch (type) {
        case "slack": return "Slack";
        case "teams": return "Teams";
        case "email": return "Email";
        default: return "Webhook";
    }
}

function fmtDateTime(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function KpiCard({
    icon, label, value, tooltip, valueClass = "text-[#0078D4]",
}: {
    icon: React.ReactNode; label: string; value: string; tooltip: string; valueClass?: string;
}) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {icon}
                {label}
                <InfoTooltip content={tooltip} />
            </div>
            <div className={`mt-2 text-2xl font-extrabold tabular-nums ${valueClass}`}>{value}</div>
        </div>
    );
}

export default function NotificationsPage() {
    const t = useTranslations("AdminNotifications");
    const { selectedTenant } = useTenant();
    const { instance, accounts, inProgress } = useMsal();
    const [channels, setChannels] = useState<Channel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [selectedType, setSelectedType] = useState<ChannelType | null>(null);
    const [formData, setFormData] = useState<{
        name: string;
        webhookUrl?: string;
        recipients?: string[];
        severityFilter: string;
    }>({ name: "", severityFilter: "info,warning,error" });
    const [creating, setCreating] = useState(false);
    // editingId: null = modo creación; number = editando ese canal existente.
    const [editingId, setEditingId] = useState<number | null>(null);
    const [testing, setTesting] = useState<number | null>(null);
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [togglingMaster, setTogglingMaster] = useState(false);
    const [dispatched30d, setDispatched30d] = useState(0);

    const tenantId = selectedTenant?.id || "";
    const isMock = isMockTenant(tenantId);
    const cols = useColumnConfig(`table_columns_config_notification_channels_${tenantId}`, CHANNEL_COLUMNS);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const loadChannels = useCallback(async () => {
        if (!tenantId || tenantId === "default") {
            setLoading(false);
            return;
        }
        // Directiva 24: no despachar hasta que MSAL resolvió la sesión.
        if (inProgress !== "none" || (!isMock && accounts.length === 0)) return;

        setLoading(true);
        setError(null);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/notifications/channels?tenantId=${tenantId}`, { headers });
            const json = await res.json();
            if (!json.success) setError(json.error || t("errors.loadFailed"));
            else {
                setChannels(json.channels || []);
                setNotificationsEnabled(json.notificationsEnabled ?? true);
                setDispatched30d(json.dispatchedLast30DaysCount ?? 0);
            }
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [tenantId, inProgress, accounts.length, isMock, authHeaders, t]);

    useEffect(() => {
        loadChannels();
    }, [loadChannels]);

    const createChannel = async () => {
        if (!selectedType || !formData.name.trim()) {
            setError(t("errors.nameRequired"));
            return;
        }

        if (!selectedTenant?.id) return;

        let config_json: any = {};

        if (selectedType === "slack" || selectedType === "teams" || selectedType === "webhook") {
            if (!formData.webhookUrl?.trim()) {
                setError(t("errors.webhookUrlRequired"));
                return;
            }
            config_json = { webhook_url: formData.webhookUrl.trim() };
        } else if (selectedType === "email") {
            const recipientList = formData.recipients?.filter((r) => r.trim()) || [];
            if (recipientList.length === 0) {
                setError(t("errors.recipientRequired"));
                return;
            }
            config_json = { recipients: recipientList };
        }

        setCreating(true);
        setError(null);

        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    type: selectedType,
                    name: formData.name.trim(),
                    config_json,
                    severity_filter: formData.severityFilter,
                }),
            });

            const json = await res.json();
            if (!json.success) {
                setError(json.error || t("errors.createFailed"));
            } else {
                toast.success(t("toasts.channelCreated"));
                setShowModal(false);
                setSelectedType(null);
                setFormData({ name: "", severityFilter: "info,warning,error" });
                await loadChannels();
            }
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setCreating(false);
        }
    };

    const openEdit = (ch: Channel) => {
        setEditingId(ch.id);
        setSelectedType(ch.type);
        setError(null);
        setFormData({
            name: ch.name,
            webhookUrl: ch.config_json?.webhook_url || "",
            recipients: ch.config_json?.recipients?.length ? [...ch.config_json.recipients] : [""],
            severityFilter: ch.severity_filter || "info,warning,error",
        });
        setShowModal(true);
    };

    const updateChannel = async () => {
        if (editingId == null || !selectedType || !formData.name.trim()) {
            setError(t("errors.nameRequired"));
            return;
        }
        if (!selectedTenant?.id) return;

        let config_json: any = {};
        if (selectedType === "slack" || selectedType === "teams" || selectedType === "webhook") {
            if (!formData.webhookUrl?.trim()) {
                setError(t("errors.webhookUrlRequired"));
                return;
            }
            config_json = { webhook_url: formData.webhookUrl.trim() };
        } else if (selectedType === "email") {
            const recipientList = formData.recipients?.filter((r) => r.trim()) || [];
            if (recipientList.length === 0) {
                setError(t("errors.recipientRequired"));
                return;
            }
            config_json = { recipients: recipientList };
        }

        setCreating(true);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels/${editingId}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    name: formData.name.trim(),
                    config_json,
                    severity_filter: formData.severityFilter,
                }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || t("errors.updateFailed"));
            } else {
                toast.success(t("toasts.channelUpdated"));
                closeModal();
                await loadChannels();
            }
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setCreating(false);
        }
    };

    const deleteChannel = async (id: number) => {
        if (!confirm(t("deleteConfirm"))) return;

        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/notifications/channels/${id}?tenantId=${selectedTenant?.id}`, {
                method: "DELETE",
                headers,
            });

            const json = await res.json();
            if (!json.success) {
                toast.error(json.error || t("errors.deleteFailed"));
            } else {
                toast.success(t("toasts.channelDeleted"));
                await loadChannels();
            }
        } catch (e) {
            toast.error(errorMessage(e));
        }
    };

    const closeModal = () => {
        setShowModal(false);
        setSelectedType(null);
        setEditingId(null);
        setFormData({ name: "", severityFilter: "info,warning,error" });
        setError(null);
    };

    const testChannel = async (id: number) => {
        if (!selectedTenant?.id) return;

        setTesting(id);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels/${id}/test`, {
                method: "POST",
                headers,
                body: JSON.stringify({ tenantId: selectedTenant.id }),
            });

            const json = await res.json();
            if (json.success) {
                // El backend ahora devuelve latencia y ya no dispara al resto de canales.
                toast.success(t("toasts.testSent"), {
                    description: json.latencyMs ? `${json.latencyMs} ms` : undefined,
                });
                await loadChannels();
            } else {
                toast.error(json.error || t("errors.testFailed"));
                await loadChannels();
            }
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setTesting(null);
        }
    };

    const toggleChannel = async (channel: Channel) => {
        // Optimista: el switch responde al instante y se revierte si falla.
        const previous = channels;
        setChannels((cs) => cs.map((c) => (c.id === channel.id ? { ...c, enabled: !c.enabled } : c)));
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels/${channel.id}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ tenantId: selectedTenant?.id, enabled: !channel.enabled }),
            });

            const json = await res.json();
            if (json.success) {
                toast.success(channel.enabled ? t("toasts.channelDisabled") : t("toasts.channelEnabled"));
            } else {
                setChannels(previous);
                toast.error(json.error || t("errors.toggleFailed"));
            }
        } catch (e) {
            setChannels(previous);
            toast.error(errorMessage(e));
        }
    };

    const toggleMasterSwitch = async () => {
        if (!selectedTenant?.id) return;
        const next = !notificationsEnabled;
        const previous = notificationsEnabled;
        setTogglingMaster(true);
        setNotificationsEnabled(next); // optimista
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/notifications/channels`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ tenantId: selectedTenant.id, notificationsEnabled: next }),
            });
            const json = await res.json();
            if (json.success) {
                toast.success(next ? t("toasts.notificationsEnabled") : t("toasts.notificationsDisabled"));
            } else {
                setNotificationsEnabled(previous);
                toast.error(json.error || t("errors.toggleMasterFailed"));
            }
        } catch (e) {
            setNotificationsEnabled(previous);
            toast.error(errorMessage(e));
        } finally {
            setTogglingMaster(false);
        }
    };

    const metrics = useMemo(() => ({
        total: channels.length,
        enabled: channels.filter((c) => c.enabled).length,
        critical: channels.filter((c) => severityFilterFromDb(c.severity_filter) === "CRITICAL_ONLY").length,
    }), [channels]);

    const pg = usePagination(channels, 15);

    if (loading) {
        return (
            <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 flex justify-center">
                <IconLoader2 size={24} stroke={1.5} className="animate-spin text-[#0078D4]" />
            </div>
        );
    }

    return (
        <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 animate-in fade-in duration-500">
            <div className="mb-6 border-b border-slate-200 dark:border-slate-800 pb-4">
                <h1 className="text-2xl font-extrabold text-[#1B2A41] dark:text-white tracking-tight flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                    <IconBellRinging size={26} stroke={1.5} className="text-[#0078D4]" />
                    {t("title")}
                    <InfoTooltip content={t("tooltips.page")} />
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">{t("subtitle")}</p>
            </div>

            {isMock && (
                <div className="w-full mb-6 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    <IconAlertTriangle size={16} stroke={1.5} className="shrink-0" />
                    {t("mockBanner")}
                </div>
            )}

            {error && (
                <div className="mb-6 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                <KpiCard
                    icon={<IconShare size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpi.total")}
                    value={String(metrics.total)}
                    tooltip={t("tooltips.kpiTotal")}
                />
                <KpiCard
                    icon={<IconCircleCheck size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpi.enabled")}
                    value={String(metrics.enabled)}
                    tooltip={t("tooltips.kpiEnabled")}
                    valueClass="text-blue-600"
                />
                <KpiCard
                    icon={<IconSend size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpi.dispatched")}
                    value={dispatched30d.toLocaleString("es-AR")}
                    tooltip={t("tooltips.kpiDispatched")}
                    valueClass="text-[#0284C7]"
                />
                <KpiCard
                    icon={<IconAlertOctagon size={14} stroke={1.5} className="text-[#0078D4]" />}
                    label={t("kpi.critical")}
                    value={String(metrics.critical)}
                    tooltip={t("tooltips.kpiCritical")}
                    valueClass="text-slate-900 dark:text-white"
                />
            </div>

            {/* Interruptor maestro */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="text-sm font-semibold text-[#1B2A41] dark:text-white flex items-center gap-2">
                        {t("masterSwitch.label")}
                        <InfoTooltip content={t("tooltips.masterSwitch")} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
                        {t("masterSwitch.description")}
                    </p>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={notificationsEnabled}
                    disabled={togglingMaster}
                    onClick={toggleMasterSwitch}
                    className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                        notificationsEnabled ? "bg-[#0078D4]" : "bg-slate-300 dark:bg-slate-700"
                    }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            notificationsEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                    />
                </button>
            </div>

            {/* Tabla de canales */}
            <div className={`w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden ${!notificationsEnabled ? "opacity-60" : ""}`}>
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                        {t("activeChannels.title")}
                        <InfoTooltip content={t("tooltips.channelsTable")} />
                    </h2>
                    <div className="flex items-center gap-2">
                        <ColumnMenu {...cols} label={t("customizeColumns")} />
                        <button onClick={() => setShowModal(true)} className={BTN_PRIMARY}>
                            <IconPlus size={16} stroke={1.5} />
                            {t("addChannel")}
                        </button>
                    </div>
                </div>

                {channels.length === 0 ? (
                    <div className="p-8 text-center">
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t("activeChannels.empty")}</p>
                    </div>
                ) : (
                    <>
                        <div className={SCROLL_X}>
                            <table className="w-full text-left text-xs border-collapse">
                                <thead className="bg-slate-50 dark:bg-slate-800/50">
                                    <tr>
                                        {CHANNEL_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                                            <ResizableTh key={c.id} minWidth={c.id === "name" ? 200 : 130} className={TH}>
                                                {t(`activeChannels.columns.${c.id}`)}
                                                <InfoTooltip content={t(`tooltips.col_${c.id}`)} />
                                            </ResizableTh>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {pg.paged.map((ch) => (
                                        <tr key={ch.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                                            {cols.isVisible("name") && (
                                                <td className={TD}>
                                                    <div className={`${CELL} font-semibold text-[#1B2A41] dark:text-white flex items-center gap-1.5`} title={ch.name}>
                                                        {typeIcon(ch.type)}
                                                        {ch.name}
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible("type") && (
                                                <td className={TD}>
                                                    <span className={`${BADGE} bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/30 dark:border-blue-900`}>
                                                        {typeIcon(ch.type)}
                                                        {typeLabel(ch.type)}
                                                    </span>
                                                </td>
                                            )}
                                            {cols.isVisible("severity") && (
                                                <td className={TD}>
                                                    {(() => {
                                                        const f = severityFilterFromDb(ch.severity_filter);
                                                        const cls = f === "CRITICAL_ONLY"
                                                            ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900"
                                                            : f === "HIGH_AND_ABOVE"
                                                                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900"
                                                                : "bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/30 dark:border-blue-900";
                                                        return <span className={`${BADGE} ${cls}`}>{t(`severity.${f}`)}</span>;
                                                    })()}
                                                </td>
                                            )}
                                            {cols.isVisible("categories") && (
                                                <td className={TD}>
                                                    {/* NULL/vacío = todas (comportamiento previo a 20260822-008). */}
                                                    {!ch.event_categories?.length ? (
                                                        <span className="text-[11px] text-slate-500">{t("categoriesAll")}</span>
                                                    ) : (
                                                        <div className="flex flex-wrap gap-1">
                                                            {ch.event_categories.map((cat) => (
                                                                <span key={cat} className={`${BADGE} bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700`}>
                                                                    {t(`categories.${cat}`)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                            )}
                                            {cols.isVisible("status") && (
                                                <td className={TD}>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            role="switch"
                                                            aria-checked={ch.enabled}
                                                            onClick={() => toggleChannel(ch)}
                                                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                                                ch.enabled ? "bg-[#0078D4]" : "bg-slate-300 dark:bg-slate-700"
                                                            }`}
                                                        >
                                                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                                                ch.enabled ? "translate-x-5" : "translate-x-1"
                                                            }`} />
                                                        </button>
                                                        <span className={`${BADGE} ${
                                                            ch.enabled
                                                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
                                                                : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                                                        }`}>
                                                            {ch.enabled ? t("activeChannels.statusEnabled") : t("activeChannels.statusDisabled")}
                                                        </span>
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible("lastDelivery") && (
                                                <td className={`${TD} whitespace-nowrap`}>
                                                    <div className="flex items-center gap-1.5">
                                                        {ch.last_delivery_status === "SUCCESS" && <IconCircleCheck size={13} stroke={1.5} className="text-emerald-600 shrink-0" />}
                                                        {ch.last_delivery_status === "FAILED" && <IconAlertTriangle size={13} stroke={1.5} className="text-rose-600 shrink-0" />}
                                                        {fmtDateTime(ch.last_delivered_at)}
                                                    </div>
                                                </td>
                                            )}
                                            {cols.isVisible("actions") && (
                                                <td className={TD}>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => testChannel(ch.id)}
                                                            disabled={testing === ch.id}
                                                            className={BTN_TEST}
                                                        >
                                                            {testing === ch.id
                                                                ? <IconLoader2 size={14} stroke={1.5} className="animate-spin" />
                                                                : <IconSend size={14} stroke={1.5} className="text-[#0078D4]" />}
                                                            {t("activeChannels.test")}
                                                        </button>
                                                        <button
                                                            onClick={() => openEdit(ch)}
                                                            aria-label={t("editChannel")}
                                                            title={t("editChannel")}
                                                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                                        >
                                                            <IconEdit size={15} stroke={1.5} className="text-slate-500 hover:text-[#0078D4]" />
                                                        </button>
                                                        <button
                                                            onClick={() => deleteChannel(ch.id)}
                                                            aria-label={t("activeChannels.deleteAction")}
                                                            title={t("activeChannels.deleteAction")}
                                                            className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                                        >
                                                            <IconTrash size={15} stroke={1.5} className="text-slate-400 hover:text-rose-600" />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800">
                            <Pagination {...pg} pageSizes={[15, 30, 45, 60]} />
                        </div>
                    </>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50" onClick={() => !creating && closeModal()} />
                    <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                                <IconBellRinging size={18} stroke={1.5} className="text-[#0078D4]" />
                                {editingId != null ? t("modal.editTitle") : t("modal.title")}
                            </h3>
                            <button
                                onClick={closeModal}
                                aria-label={t("modal.close")}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded p-1 -m-1"
                            >
                                <IconX size={18} stroke={1.5} />
                            </button>
                        </div>

                        {!selectedType ? (
                            <div className="space-y-3">
                                <p className="text-sm text-slate-600 dark:text-slate-400">{t("modal.selectType")}</p>
                                {([
                                    { type: "teams" as const, name: t("modal.teams.name"), desc: t("modal.teams.description") },
                                    { type: "slack" as const, name: t("modal.slack.name"), desc: t("modal.slack.description") },
                                    { type: "email" as const, name: t("modal.email.name"), desc: t("modal.email.description") },
                                    { type: "webhook" as const, name: t("modal.webhook.name"), desc: t("modal.webhook.description") },
                                ]).map((opt) => (
                                    <button
                                        key={opt.type}
                                        onClick={() => {
                                            setSelectedType(opt.type);
                                            setFormData(opt.type === "email"
                                                ? { name: "", recipients: [""], severityFilter: "info,warning,error" }
                                                : { name: "", severityFilter: "info,warning,error" });
                                        }}
                                        className="w-full border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors"
                                    >
                                        {typeIcon(opt.type)}
                                        <div>
                                            <div className="font-medium text-[#1B2A41] dark:text-white text-sm">{opt.name}</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{opt.desc}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {editingId == null && (
                                    <button
                                        onClick={() => setSelectedType(null)}
                                        className="text-sm text-[#0078D4] hover:text-[#0060AA]"
                                    >
                                        {t("modal.back")}
                                    </button>
                                )}

                                <div className="flex flex-col gap-1.5">
                                    <label className={LABEL}>{t("modal.channelNameLabel")}</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder={t("modal.channelNamePlaceholder")}
                                        className={INPUT}
                                    />
                                </div>

                                {(selectedType === "slack" || selectedType === "teams" || selectedType === "webhook") && (
                                    <div className="flex flex-col gap-1.5">
                                        <label className={`${LABEL} flex items-center gap-1.5`}>
                                            {t("modal.webhookUrlLabel")}
                                            <InfoTooltip content={t("tooltips.webhookUrl")} />
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.webhookUrl || ""}
                                            onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                                            placeholder="https://hooks.slack.com/services/..."
                                            className={`${INPUT} font-mono text-xs`}
                                        />
                                    </div>
                                )}

                                {selectedType === "email" && (
                                    <div className="flex flex-col gap-1.5">
                                        <label className={LABEL}>{t("modal.recipientEmailsLabel")}</label>
                                        {(formData.recipients || []).map((email, idx) => (
                                            <input
                                                key={idx}
                                                type="email"
                                                value={email}
                                                onChange={(e) => {
                                                    const updated = [...(formData.recipients || [])];
                                                    updated[idx] = e.target.value;
                                                    setFormData({ ...formData, recipients: updated });
                                                }}
                                                placeholder="email@example.com"
                                                className={`${INPUT} mb-2`}
                                            />
                                        ))}
                                        <button
                                            onClick={() => setFormData({ ...formData, recipients: [...(formData.recipients || []), ""] })}
                                            className="text-xs text-[#0078D4] hover:text-[#0060AA] w-fit"
                                        >
                                            {t("modal.addAnotherEmail")}
                                        </button>
                                    </div>
                                )}

                                <div className="flex flex-col gap-1.5">
                                    <label className={`${LABEL} flex items-center gap-1.5`}>
                                        {t("modal.severityFilterLabel")}
                                        <InfoTooltip content={t("tooltips.severityFilter")} />
                                    </label>
                                    {/* Se guarda la lista cruda que el dispatcher parsea con
                                        split(','), pero se elige con etiquetas legibles. */}
                                    <select
                                        value={formData.severityFilter}
                                        onChange={(e) => setFormData({ ...formData, severityFilter: e.target.value })}
                                        className={INPUT}
                                    >
                                        <option value="info,warning,error">{t("severity.ALL")}</option>
                                        <option value="warning,error">{t("severity.HIGH_AND_ABOVE")}</option>
                                        <option value="error">{t("severity.CRITICAL_ONLY")}</option>
                                    </select>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("modal.severityFilterHint")}</p>
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <button onClick={closeModal} className={`${BTN_NEUTRAL} flex-1`}>
                                        {t("modal.cancel")}
                                    </button>
                                    <button
                                        onClick={editingId != null ? updateChannel : createChannel}
                                        disabled={creating || !formData.name.trim()}
                                        className={`${BTN_PRIMARY} flex-1`}
                                    >
                                        {creating
                                            ? <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
                                            : (editingId != null ? <IconEdit size={16} stroke={1.5} /> : <IconPlus size={16} stroke={1.5} />)}
                                        {editingId != null ? t("modal.save") : t("modal.create")}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
