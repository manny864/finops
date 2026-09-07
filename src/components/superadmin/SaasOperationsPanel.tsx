"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import DemoModeBadge from "@/components/DemoModeBadge";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import {
    SaaSOperationsSummary,
    SaaSComponentStatus,
    SaaSCronJobStatus,
    CronJobKey,
} from "@/types/saasOperations.types";
import {
    IconActivity,
    IconHeartRateMonitor,
    IconAlertTriangle,
    IconRefresh,
    IconWebhook,
    IconShieldExclamation,
    IconBellRinging,
    IconPlayerPlay,
    IconColumns,
    IconLoader2,
    IconCheck,
    IconSparkles,
    IconX,
    IconSend,
} from "@tabler/icons-react";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_CRON_COLUMNS: ColumnConfig[] = [
    { id: "cron", label: "Cron", visible: true, width: 190 },
    { id: "status", label: "Estado", visible: true, width: 120 },
    { id: "lastRun", label: "Última Ejecución", visible: true, width: 170 },
    { id: "summary", label: "Resumen", visible: true, width: 340 },
    { id: "actions", label: "Acciones", visible: true, width: 150 },
];

export default function SaasOperationsPanel() {
    const t = useTranslations("SuperAdminOps");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [summary, setSummary] = useState<SaaSOperationsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Forzar ejecución de cron individual
    const [triggeringCronKey, setTriggeringCronKey] = useState<string | null>(null);

    // Modal Notificar Superadmins
    const [isNotifyModalOpen, setIsNotifyModalOpen] = useState(false);
    const [notifySeverity, setNotifySeverity] = useState<"warning" | "error">("warning");
    const [notifyTitle, setNotifyTitle] = useState("");
    const [notifyMessage, setNotifyMessage] = useState("");
    const [sendingNotification, setSendingNotification] = useState(false);

    // Columnas y Redimensionamiento para Tabla de Crons
    const storageKey = `table_columns_config_saas_operations_${tenantId}`;
    const [columns, setColumns] = useState<ColumnConfig[]>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) return JSON.parse(saved);
            } catch {
                /* noop */
            }
        }
        return DEFAULT_CRON_COLUMNS;
    });
    const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
    const columnPickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            try {
                localStorage.setItem(storageKey, JSON.stringify(columns));
            } catch {
                /* noop */
            }
        }
    }, [columns, storageKey]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (columnPickerRef.current && !columnPickerRef.current.contains(event.target as Node)) {
                setIsColumnPickerOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || !accounts || accounts.length === 0) return {};
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }, [instance, accounts, isMock]);

    // Cargar datos
    const loadOperationsHealth = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? "/api/superadmin/operations/health?mock=true"
                : "/api/superadmin/operations/health";

            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al cargar la telemetría operativa");
            }

            setSummary(json);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [isMock, getAuthHeaders]);

    useEffect(() => {
        loadOperationsHealth();
    }, [loadOperationsHealth]);

    // Forzar ejecución de cron
    const handleTriggerCron = async (cronKey: CronJobKey) => {
        setTriggeringCronKey(cronKey);
        setError(null);
        setSuccessMessage(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? `/api/superadmin/operations/crons/${cronKey}/trigger?mock=true`
                : `/api/superadmin/operations/crons/${cronKey}/trigger`;

            const res = await fetch(url, { method: "POST", headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || `Error al ejecutar el cron '${cronKey}'`);
            }

            // Actualización optimista de estado
            if (summary) {
                setSummary({
                    ...summary,
                    cronJobs: summary.cronJobs.map((c) =>
                        c.key === cronKey
                            ? {
                                  ...c,
                                  status: "HEALTHY",
                                  formattedLastRun: "Hace unos instantes",
                                  summaryText: "Ejecución manual forzada completada exitosamente.",
                              }
                            : c
                    ),
                });
            }

            setSuccessMessage(t("triggerSuccess", { name: cronKey }) || `Cron job '${cronKey}' ejecutado exitosamente.`);
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setTriggeringCronKey(null);
        }
    };

    // Broadcast de Notificación
    const handleSendBroadcast = async (e: React.FormEvent) => {
        e.preventDefault();
        setSendingNotification(true);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/operations/notify-admins?mock=true"
                : "/api/superadmin/operations/notify-admins";

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    severity: notifySeverity,
                    title: notifyTitle.trim() || t("dispatchTitle") || "Alerta operativa de plataforma",
                    message: notifyMessage.trim() || t("dispatchMessage") || "Se detectó una degradación operativa.",
                }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al enviar la notificación");
            }

            setIsNotifyModalOpen(false);
            setNotifyTitle("");
            setNotifyMessage("");
            setSuccessMessage(
                t("dispatchSuccess", { delivered: json.delivered || 1, failed: json.failed || 0 }) ||
                    `Notificaciones enviadas. Entregadas: ${json.delivered || 1}.`
            );
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setSendingNotification(false);
        }
    };

    // Redimensionamiento de Columnas
    const handleResizeMouseDown = (columnId: string, e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const targetCol = columns.find((c) => c.id === columnId);
        if (!targetCol) return;
        const startWidth = targetCol.width;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            const newWidth = Math.max(100, Math.min(600, startWidth + delta));
            setColumns((prev) => prev.map((col) => (col.id === columnId ? { ...col, width: newWidth } : col)));
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const toggleColumnVisibility = (columnId: string) => {
        setColumns((prev) =>
            prev.map((col) => (col.id === columnId ? { ...col, visible: !col.visible } : col))
        );
    };

    const resetColumnsToDefault = () => {
        setColumns(DEFAULT_CRON_COLUMNS);
    };

    const isDegraded = summary?.generalStatus !== "OPERATIONAL";

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header y Acciones Globales */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconActivity size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("title") || "Operaciones SaaS (Global)"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Centro global de operaciones SaaS, salud de microservicios, latencia y ejecución en tiempo real de cron jobs de Azure."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("subtitle") ||
                            "Estado de crons Azure, salud de componentes y envío de alertas para SuperAdmin."}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {isMock && (
                        <DemoModeBadge />
                    )}

                    {/* Botón 1: Actualizar Estado */}
                    <button
                        type="button"
                        onClick={loadOperationsHealth}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                    >
                        <IconRefresh size={14} className={`text-[#0078D4] ${loading ? "animate-spin" : ""}`} />
                        <span>{t("refresh") || "Actualizar Estado"}</span>
                    </button>

                    {/* Botón 2: Notificar Superadmins */}
                    <button
                        type="button"
                        onClick={() => {
                            setNotifyTitle(t("dispatchTitle") || "Alerta operativa de plataforma");
                            setNotifyMessage(t("dispatchMessage") || "Se detectó un estado degradado en la plataforma.");
                            setIsNotifyModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all"
                    >
                        <IconBellRinging size={14} stroke={1.5} className="text-white" />
                        <span>{t("dispatch") || "Notificar superadmins"}</span>
                    </button>
                </div>
            </div>

            {/* Banner de Éxito / Error */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconX size={16} />
                    <span>{error}</span>
                </div>
            )}
            {successMessage && (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconCheck size={16} />
                    <span>{successMessage}</span>
                </div>
            )}

            {/* ─── FILA DE 4 KPI CARDS DE TELEMETRÍA (Tonos de azul corporativo) ──────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: ESTADO GENERAL */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("overall") || "Estado General"}
                        </span>
                        <div className="text-2xl font-bold text-[#0078D4] mt-1 font-['Montserrat',sans-serif]">
                            {summary?.generalStatus === "OPERATIONAL" ? "Operacional" : "Degradado"}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("uptime", { value: summary?.uptime30dPercent ?? 100 }) || `Uptime 30d: ${summary?.uptime30dPercent ?? 100}%`}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0078D4]">
                        <IconHeartRateMonitor size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 2: ALERTAS ACTIVAS */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("alerts") || "Alertas Activas"}
                        </span>
                        <div className="text-2xl font-bold text-[#2563EB] mt-1 font-['Montserrat',sans-serif]">
                            {summary?.unacknowledgedAlertsCount ?? 0}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("pendingAlerts") || "Alertas sin reconocer"}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#2563EB]">
                        <IconAlertTriangle size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 3: SYNC DE TENANTS */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("tenantsSync") || "Sync de Tenants"}
                        </span>
                        <div className="text-2xl font-bold text-[#0284C7] mt-1 font-['Montserrat',sans-serif]">
                            {summary?.syncedTenantsRatio || "3/4"}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("azureSyncRatio", { value: "1.0" }) || "Ratio de sync Azure: 1.0"}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0284C7]">
                        <IconRefresh size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 4: CANALES ACTIVOS */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("channels") || "Canales Activos"}
                        </span>
                        <div className="text-2xl font-bold text-[#0054A6] mt-1 font-['Montserrat',sans-serif]">
                            {summary?.activeChannelsCount ?? 2}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Cobertura en tenants
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0054A6]">
                        <IconWebhook size={22} stroke={1.5} />
                    </div>
                </div>
            </div>

            {/* Banner de Estado Informativo si hay Degradación */}
            {isDegraded && (
                <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 rounded-2xl text-xs text-slate-700 dark:text-slate-300 flex items-center gap-3">
                    <IconShieldExclamation size={20} stroke={1.5} className="text-[#0078D4] shrink-0" />
                    <span>
                        {t("degradedBanner") ||
                            "Se detectó degradación en la sincronización de telemetría. Revisá el estado de componentes y crons para identificar la causa raíz."}
                    </span>
                </div>
            )}

            {/* ─── GRID DE 2 BLOQUES OPERATIVOS (Grid 1x2 - Ancho 100%) ──────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* ─── BLOQUE 1: Estado de Componentes del SaaS ──────────────────────── */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("componentsTitle") || "Estado de componentes del SaaS"}
                        </h2>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {t("colComponent") || "Componente"}
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {t("colStatus") || "Estado"}
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {t("colLatency") || "Latencia"}
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {t("colUptime") || "Uptime (30d)"}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                                            <div className="inline-flex items-center gap-2">
                                                <IconLoader2 size={16} className="animate-spin text-[#0078D4]" />
                                                <span>Cargando componentes...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    (summary?.components || []).map((comp) => (
                                        <tr key={comp.key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                            <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                                                {comp.name}
                                            </td>
                                            <td className="px-3 py-2.5 whitespace-nowrap">
                                                <span
                                                    className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                                                        comp.status === "HEALTHY"
                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                                            : comp.status === "DEGRADED"
                                                            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                                            : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800"
                                                    }`}
                                                >
                                                    {comp.status === "HEALTHY" ? "Operacional" : comp.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                                {comp.latencyMs} ms
                                            </td>
                                            <td className="px-3 py-2.5 font-mono text-[11px] text-[#0078D4] dark:text-blue-400 font-semibold">
                                                {comp.uptimePercent.toFixed(2)}%
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ─── BLOQUE 2: Estado de Ejecución de Crons ────────────────────────── */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("cronTitle") || "Estado de ejecución de crons"}
                        </h2>

                        {/* Selector de Columnas (z-[100]) */}
                        <div className="relative" ref={columnPickerRef}>
                            <button
                                type="button"
                                onClick={() => setIsColumnPickerOpen((prev) => !prev)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 transition-colors shadow-sm"
                            >
                                <IconColumns size={15} stroke={1.5} className="text-[#0078D4]" />
                                <span>Personalizar Columnas</span>
                            </button>

                            {isColumnPickerOpen && (
                                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-[100] p-3 space-y-2 animate-in fade-in">
                                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200">
                                        <span>Columnas Visibles</span>
                                        <button
                                            onClick={resetColumnsToDefault}
                                            className="text-[11px] font-normal text-[#0078D4] hover:underline"
                                        >
                                            Restaurar
                                        </button>
                                    </div>
                                    <div className="space-y-1 max-h-48 overflow-y-auto">
                                        {columns.map((col) => (
                                            <label
                                                key={col.id}
                                                className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 p-1.5 rounded cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={col.visible}
                                                    onChange={() => toggleColumnVisibility(col.id)}
                                                    className="rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                                                />
                                                <span>{col.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Contenedor de Tabla con Scrollbar visible en macOS */}
                    <div className="w-full max-w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                                    {columns
                                        .filter((c) => c.visible)
                                        .map((col) => (
                                            <th
                                                key={col.id}
                                                style={{ width: `${col.width}px` }}
                                                className="relative px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px] select-none"
                                            >
                                                <span>{col.label}</span>
                                                <div
                                                    onMouseDown={(e) => handleResizeMouseDown(col.id, e)}
                                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#0078D4] transition-colors"
                                                />
                                            </th>
                                        ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {loading ? (
                                    <tr>
                                        <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500">
                                            <div className="inline-flex items-center gap-2">
                                                <IconLoader2 size={16} className="animate-spin text-[#0078D4]" />
                                                <span>Cargando crons...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    (summary?.cronJobs || []).map((cron) => (
                                        <tr key={cron.key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                            {/* Cron Key */}
                                            {columns.find((c) => c.id === "cron")?.visible && (
                                                <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                                    <span title={cron.name}>{cron.key}</span>
                                                </td>
                                            )}

                                            {/* Estado */}
                                            {columns.find((c) => c.id === "status")?.visible && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                                                            cron.status === "HEALTHY"
                                                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                                                : cron.status === "RUNNING"
                                                                ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 animate-pulse"
                                                                : cron.status === "ERROR"
                                                                ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800"
                                                                : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400"
                                                        }`}
                                                    >
                                                        {cron.status}
                                                    </span>
                                                </td>
                                            )}

                                            {/* Última Ejecución */}
                                            {columns.find((c) => c.id === "lastRun")?.visible && (
                                                <td className="px-3 py-2.5 font-mono text-[10.5px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                    {cron.formattedLastRun}
                                                </td>
                                            )}

                                            {/* Resumen */}
                                            {columns.find((c) => c.id === "summary")?.visible && (
                                                <td className="px-3 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                                                    <span className="line-clamp-2" title={cron.summaryText}>
                                                        {cron.summaryText}
                                                    </span>
                                                </td>
                                            )}

                                            {/* Acciones (Forzar Ejecución) */}
                                            {columns.find((c) => c.id === "actions")?.visible && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleTriggerCron(cron.key)}
                                                        disabled={triggeringCronKey === cron.key}
                                                        className="inline-flex items-center gap-1 text-[#0078D4] hover:text-[#0054A6] dark:text-blue-400 font-semibold hover:underline disabled:opacity-50"
                                                        title="Ejecutar cron job inmediatamente"
                                                    >
                                                        {triggeringCronKey === cron.key ? (
                                                            <IconLoader2 size={13} className="animate-spin text-[#0078D4]" />
                                                        ) : (
                                                            <IconPlayerPlay size={13} stroke={1.5} className="text-[#0078D4]" />
                                                        )}
                                                        <span>{t("btnTriggerCron") || "Forzar Ejecución"}</span>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ─── MODAL: Difundir Incidente a Superadmins (z-[100]) ─────────────────── */}
            {isNotifyModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
                        <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                    {t("modalBroadcastTitle") || "Difundir Alerta de Incidente a Superadmins"}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {t("modalBroadcastSubtitle") ||
                                        "Envío inmediato multicanal a todos los administradores registrados."}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsNotifyModalOpen(false)}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSendBroadcast} className="space-y-4">
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("severityLabel") || "Severidad del Incidente"}
                                </label>
                                <select
                                    value={notifySeverity}
                                    onChange={(e) => setNotifySeverity(e.target.value as "warning" | "error")}
                                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                >
                                    <option value="warning">{t("severityWarning") || "Advertencia (Warning)"}</option>
                                    <option value="error">{t("severityError") || "Crítico (Error / Outage)"}</option>
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("alertTitleLabel") || "Título del Incidente"}
                                </label>
                                <input
                                    type="text"
                                    value={notifyTitle}
                                    onChange={(e) => setNotifyTitle(e.target.value)}
                                    placeholder="Alerta operativa de plataforma"
                                    required
                                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("alertMessageLabel") || "Mensaje / Instrucciones"}
                                </label>
                                <textarea
                                    rows={3}
                                    value={notifyMessage}
                                    onChange={(e) => setNotifyMessage(e.target.value)}
                                    placeholder="Detalles sobre la degradación y pasos de remediación..."
                                    required
                                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsNotifyModalOpen(false)}
                                    className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    {t("close") || "Cerrar"}
                                </button>
                                <button
                                    type="submit"
                                    disabled={sendingNotification}
                                    className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                                >
                                    {sendingNotification ? (
                                        <IconLoader2 size={14} className="animate-spin text-white" />
                                    ) : (
                                        <IconSend size={14} stroke={1.5} className="text-white" />
                                    )}
                                    <span>{t("btnSendAlert") || "Enviar Notificación"}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export { SaasOperationsPanel };
