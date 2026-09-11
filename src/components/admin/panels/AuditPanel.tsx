"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import DemoModeBadge from "@/components/DemoModeBadge";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import { AuditTrailLogItem, AuditActionType, AuditStatusType } from "@/types/auditTrail.types";
import {
    IconFileText,
    IconFilter,
    IconEraser,
    IconFileSpreadsheet,
    IconBraces,
    IconFileCode,
    IconEye,
    IconColumns,
    IconLoader2,
    IconRefresh,
    IconSparkles,
    IconCalendar,
    IconChevronLeft,
    IconChevronRight,
    IconDownload,
    IconX,
    IconSearch,
} from "@tabler/icons-react";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

// Los rotulos salen del catalogo: el menu de columnas se traducia pero
// sus items seguian en castellano.
const columnasAuditoria = (t: (k: string) => string): ColumnConfig[] => [
    { id: "timestamp", label: t("col_timestamp"), visible: true, width: 190 },
    { id: "user", label: t("col_user"), visible: true, width: 220 },
    { id: "action", label: t("col_action"), visible: true, width: 210 },
    { id: "resource", label: t("col_resource"), visible: true, width: 260 },
    { id: "status", label: t("col_status"), visible: true, width: 120 },
    { id: "ip", label: t("col_ip"), visible: true, width: 140 },
    { id: "actions", label: t("col_actions"), visible: true, width: 110 },
];

const ACTION_TYPE_OPTIONS: { value: string; label: string }[] = [
    { value: "ALL", label: "Todas las acciones" },
    { value: "ROTATE_APP_SECRET", label: "ROTATE_APP_SECRET" },
    { value: "START_VM", label: "START_VM" },
    { value: "STOP_VM", label: "STOP_VM" },
    { value: "DELETE_ZOMBIE", label: "DELETE_ZOMBIE" },
    { value: "APPLY_RIGHTSIZING", label: "APPLY_RIGHTSIZING" },
    { value: "UPDATE_TAGS", label: "UPDATE_TAGS" },
    { value: "WHAT_IF_SIMULATION", label: "WHAT_IF_SIMULATION" },
    { value: "AKS_CHARGEBACK_REPORT", label: "AKS_CHARGEBACK_REPORT" },
    { value: "EXPORT_FOCUS", label: "EXPORT_FOCUS" },
    { value: "UNLINK_SUBSCRIPTION", label: "UNLINK_SUBSCRIPTION" },
    { value: "RELINK_SUBSCRIPTION", label: "RELINK_SUBSCRIPTION" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "ALL", label: "Todos los estados" },
    { value: "SUCCESS", label: "Exitoso (SUCCESS)" },
    { value: "FAILED", label: "Fallido (FAILED)" },
    { value: "PENDING", label: "Pendiente (PENDING)" },
];

export default function AuditTrailPanel() {
    const t = useTranslations("AdminAudit");
    const tc = useTranslations("Common");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [logs, setLogs] = useState<AuditTrailLogItem[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Filtros de búsqueda
    const [userEmailFilter, setUserEmailFilter] = useState("");
    const [actionTypeFilter, setActionTypeFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [fromDateFilter, setFromDateFilter] = useState("");
    const [toDateFilter, setToDateFilter] = useState("");

    // Paginación CMP
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(15);

    // Drawer Lateral de Metadatos (Detalle del Evento)
    const [selectedLog, setSelectedLog] = useState<AuditTrailLogItem | null>(null);

    // Configuración y Redimensionamiento de Columnas
    const storageKey = `table_columns_config_audit_trail_${tenantId}`;
    const [columns, setColumns] = useState<ColumnConfig[]>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) return JSON.parse(saved);
            } catch {
                /* noop */
            }
        }
        return columnasAuditoria(t);
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

    // Cargar Registros de Auditoría
    const loadLogs = useCallback(
        async (pageToLoad = currentPage, resetPage = false) => {
            if (!tenantId || tenantId === "default") {
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);
            const actualPage = resetPage ? 1 : pageToLoad;
            if (resetPage) setCurrentPage(1);

            try {
                const headers = await getAuthHeaders();
                const params = new URLSearchParams({
                    tenantId,
                    page: String(actualPage),
                    pageSize: String(pageSize),
                });

                if (userEmailFilter.trim()) params.append("userEmail", userEmailFilter.trim());
                if (actionTypeFilter && actionTypeFilter !== "ALL") params.append("actionType", actionTypeFilter);
                if (statusFilter && statusFilter !== "ALL") params.append("status", statusFilter);
                if (fromDateFilter) params.append("fromDate", fromDateFilter);
                if (toDateFilter) params.append("toDate", toDateFilter);
                if (isMock) params.append("mock", "true");

                const res = await fetch(`/api/admin/audit-trail?${params.toString()}`, { headers });
                const json = await res.json();

                if (!res.ok || !json.success) {
                    throw new Error(json.error || t("errorLoading") || "Error al cargar registros");
                }

                setLogs(json.items || []);
                setTotalCount(json.totalCount || 0);
            } catch (e: any) {
                setError(errorMessage(e));
            } finally {
                setLoading(false);
            }
        },
        [
            tenantId,
            isMock,
            getAuthHeaders,
            currentPage,
            pageSize,
            userEmailFilter,
            actionTypeFilter,
            statusFilter,
            fromDateFilter,
            toDateFilter,
            t,
        ]
    );

    useEffect(() => {
        loadLogs(currentPage, false);
    }, [loadLogs, currentPage, pageSize]);

    // Manejadores de Filtros
    const handleApplyFilters = (e: React.FormEvent) => {
        e.preventDefault();
        loadLogs(1, true);
    };

    const handleClearFilters = () => {
        setUserEmailFilter("");
        setActionTypeFilter("ALL");
        setStatusFilter("ALL");
        setFromDateFilter("");
        setToDateFilter("");
        setCurrentPage(1);
    };

    // Exportación Unificada
    const handleExport = async (format: "csv-page" | "csv-all" | "json" | "ndjson") => {
        setExporting(format);
        try {
            const headers = await getAuthHeaders();
            const params = new URLSearchParams({
                tenantId,
            });

            if (userEmailFilter.trim()) params.append("userEmail", userEmailFilter.trim());
            if (actionTypeFilter && actionTypeFilter !== "ALL") params.append("actionType", actionTypeFilter);
            if (statusFilter && statusFilter !== "ALL") params.append("status", statusFilter);
            if (fromDateFilter) params.append("fromDate", fromDateFilter);
            if (toDateFilter) params.append("toDate", toDateFilter);
            if (isMock) params.append("mock", "true");

            if (format === "csv-page") {
                params.append("format", "csv");
                params.append("page", String(currentPage));
                params.append("pageSize", String(pageSize));
            } else if (format === "csv-all") {
                params.append("format", "csv");
                params.append("page", "1");
                params.append("pageSize", "5000");
            } else if (format === "json") {
                params.append("format", "json");
                params.append("page", "1");
                params.append("pageSize", "5000");
            } else if (format === "ndjson") {
                params.append("format", "ndjson");
                params.append("page", "1");
                params.append("pageSize", "5000");
            }

            const res = await fetch(`/api/admin/audit-trail/export?${params.toString()}`, { headers });
            if (!res.ok) throw new Error("Error en la descarga");

            const blob = await res.blob();
            const dateStr = new Date().toISOString().split("T")[0];
            const ext = format.startsWith("csv") ? "csv" : format;
            const filename = `audit-trail-${tenantId}-${format}-${dateStr}.${ext}`;

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setExporting(null);
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
        setColumns(columnasAuditoria(t));
    };

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header y Subtítulo de Sección */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconFileText size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("pageTitle") || "Registro de Auditoría"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Historial inmutable de acciones de remediación, cambios de infraestructura y ejecuciones en recursos de Azure."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("pageSubtitle") ||
                            "Historial inmutable de acciones de remediación, cambios de infraestructura y ejecuciones en recursos de Azure."}
                    </p>
                </div>

                {isMock && (
                    <DemoModeBadge />
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                    <IconX size={16} />
                    <span>{error}</span>
                </div>
            )}

            {/* ─── SECCIÓN 1: Tarjeta Filtros de Búsqueda (Ancho 100%) ─────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                    <IconFilter size={18} stroke={1.5} className="text-[#0078D4]" />
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        {t("filtersTitle") || "Filtros de Búsqueda"}
                    </h2>
                </div>

                <form onSubmit={handleApplyFilters} className="space-y-4">
                    {/* Fila 1: Email, Tipo de Acción, Estado */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("filterUserEmail") || "Email de Usuario"}
                            </label>
                            <input
                                type="text"
                                value={userEmailFilter}
                                onChange={(e) => setUserEmailFilter(e.target.value)}
                                placeholder={t("filterUserEmailPlaceholder") || "ej: user@example.com"}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("filterActionType") || "Tipo de Acción"}
                            </label>
                            <select
                                value={actionTypeFilter}
                                onChange={(e) => setActionTypeFilter(e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            >
                                {ACTION_TYPE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("filterStatus") || "Estado"}
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            >
                                {STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Fila 2: Desde y Hasta */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                <IconCalendar size={14} className="text-[#0078D4]" />
                                <span>{t("filterFrom") || "Desde"}</span>
                            </label>
                            <input
                                type="date"
                                value={fromDateFilter}
                                onChange={(e) => setFromDateFilter(e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                <IconCalendar size={14} className="text-[#0078D4]" />
                                <span>{t("filterTo") || "Hasta"}</span>
                            </label>
                            <input
                                type="date"
                                value={toDateFilter}
                                onChange={(e) => setToDateFilter(e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>
                    </div>

                    {/* Botones de Filtro */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="inline-flex items-center justify-center gap-1.5 bg-[#0078D4] text-white hover:bg-[#0060AA] px-5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                        >
                            <IconFilter size={15} stroke={1.5} className="text-white" />
                            <span>{t("applyFilters") || "Aplicar filtros"}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleClearFilters}
                            className="inline-flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-lg text-xs font-medium transition-all"
                        >
                            <IconEraser size={15} stroke={1.5} className="text-slate-500" />
                            <span>{t("clearFilters") || "Limpiar"}</span>
                        </button>
                    </div>
                </form>
            </div>

            {/* ─── SECCIÓN 2: Tarjeta Exportar Registros (Paleta Corporativa Unificada) ─ */}
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <IconDownload size={18} stroke={1.5} className="text-[#0078D4]" />
                    <span className="font-bold text-xs text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                        Exportar Registros Filtrados
                    </span>
                </div>

                {/* 4 Botones Corporativos Unificados */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Botón 1: CSV Página Actual (Azul cobalto) */}
                    <button
                        type="button"
                        onClick={() => handleExport("csv-page")}
                        disabled={exporting !== null || logs.length === 0}
                        className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                        {exporting === "csv-page" ? (
                            <IconLoader2 size={13} className="animate-spin text-white" />
                        ) : (
                            <IconFileSpreadsheet size={14} className="text-white" />
                        )}
                        <span>{t("csvCurrentPage")}</span>
                    </button>

                    {/* Botón 2: CSV Filtrado Completo (Azul corporativo profundo) */}
                    <button
                        type="button"
                        onClick={() => handleExport("csv-all")}
                        disabled={exporting !== null || totalCount === 0}
                        className="inline-flex items-center gap-1 bg-[#0078D4] hover:bg-[#0060AA] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                        {exporting === "csv-all" ? (
                            <IconLoader2 size={13} className="animate-spin text-white" />
                        ) : (
                            <IconFileSpreadsheet size={14} className="text-white" />
                        )}
                        <span>CSV (filtrado completo)</span>
                    </button>

                    {/* Botón 3: JSON (Slate corporativo) */}
                    <button
                        type="button"
                        onClick={() => handleExport("json")}
                        disabled={exporting !== null || totalCount === 0}
                        className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                        {exporting === "json" ? (
                            <IconLoader2 size={13} className="animate-spin text-white" />
                        ) : (
                            <IconBraces size={14} className="text-white" />
                        )}
                        <span>JSON</span>
                    </button>

                    {/* Botón 4: NDJSON (Borde slate neutro con texto azul) */}
                    <button
                        type="button"
                        onClick={() => handleExport("ndjson")}
                        disabled={exporting !== null || totalCount === 0}
                        className="inline-flex items-center gap-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0078D4] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700/50 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                        {exporting === "ndjson" ? (
                            <IconLoader2 size={13} className="animate-spin text-[#0078D4]" />
                        ) : (
                            <IconFileCode size={14} className="text-[#0078D4]" />
                        )}
                        <span>NDJSON</span>
                    </button>
                </div>
            </div>

            {/* ─── SECCIÓN 3: Tabla Registro de Auditoría (Estándar CMP) ───────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
                {/* Cabecera y Selector de Columnas */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("pageTitle") || "Registro de Auditoría"} ({totalCount})
                        </h2>
                        <button
                            onClick={() => loadLogs(currentPage, false)}
                            className="p-1 text-slate-400 hover:text-[#0078D4] rounded transition-colors"
                            title={t("refreshHint")}
                        >
                            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                    </div>

                    {/* Selector de Columnas (z-[100]) */}
                    <div className="relative" ref={columnPickerRef}>
                        <button
                            type="button"
                            onClick={() => setIsColumnPickerOpen((prev) => !prev)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 transition-colors shadow-sm"
                        >
                            <IconColumns size={15} stroke={1.5} className="text-[#0078D4]" />
                            <span>{tc("customizeColumns")}</span>
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
                                            className="relative px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px] select-none"
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
                                            <span>{t("loadingLogs")}</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500 italic">
                                        {t("emptyFiltered")}
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {columns.find((c) => c.id === "timestamp")?.visible && (
                                            <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                {log.formattedCreatedAt}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "user")?.visible && (
                                            <td className="px-4 py-3 text-slate-800 dark:text-slate-200">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-[#0078D4] flex items-center justify-center font-bold text-[10px] shrink-0">
                                                        {(log.userName || log.userEmail || "A").charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="truncate max-w-[180px]" title={log.userEmail}>
                                                        {log.userEmail}
                                                    </span>
                                                </div>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "action")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                                                    {log.actionType}
                                                </span>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "resource")?.visible && (
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                                <span className="truncate max-w-[240px] block" title={log.resourceTargetName}>
                                                    {log.resourceTargetName}
                                                </span>
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "status")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {log.status === "SUCCESS" ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                                                        Exitoso
                                                    </span>
                                                ) : log.status === "FAILED" ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800">
                                                        Fallido
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400">
                                                        Pendiente
                                                    </span>
                                                )}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "ip")?.visible && (
                                            <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                {log.ipAddress || "—"}
                                            </td>
                                        )}

                                        {columns.find((c) => c.id === "actions")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedLog(log)}
                                                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:text-[#0060AA] transition-colors"
                                                >
                                                    <IconEye size={14} className="text-[#0078D4]" />
                                                    <span>Ver Detalles</span>
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Paginación Estándar CMP */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>{tc("showing")}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="px-2 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                        <span>{tc("ofRecords", { count: totalCount })}</span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                        >
                            <IconChevronLeft size={14} />
                        </button>
                        <span className="px-3">
                            {t("pageOf", { current: currentPage, total: totalPages })}
                        </span>
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                        >
                            <IconChevronRight size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── DRAWER LATERAL: Metadatos del Log de Auditoría (z-[100]) ─────────── */}
            {selectedLog && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex justify-end backdrop-blur-xs animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 w-full max-w-xl h-full overflow-y-auto p-6 space-y-6 shadow-2xl animate-in slide-in-from-right duration-200">
                        {/* Cabecera del Drawer */}
                        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
                            <div className="space-y-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400">
                                    {selectedLog.actionType}
                                </span>
                                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                    {t("drawerTitle")}
                                </h3>
                                <p className="text-[11px] font-mono text-slate-500">ID: {selectedLog.id}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedLog(null)}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                            >
                                <IconX size={20} />
                            </button>
                        </div>

                        {/* Información del Actor */}
                        <div className="space-y-2 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs">
                            <h4 className="font-bold text-slate-800 dark:text-slate-200">{t("actorInfo")}</h4>
                            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                                <div>
                                    <span className="text-slate-500 block">Usuario:</span>
                                    <span className="font-medium text-slate-800 dark:text-slate-200">{selectedLog.userEmail}</span>
                                </div>
                                <div>
                                    <span className="text-slate-500 block">Fecha y Hora UTC:</span>
                                    <span className="font-mono text-slate-800 dark:text-slate-200">{selectedLog.createdAtIso}</span>
                                </div>
                                <div>
                                    <span className="text-slate-500 block">{t("sourceIp")}</span>
                                    <span className="font-mono text-slate-800 dark:text-slate-200">{selectedLog.ipAddress || "—"}</span>
                                </div>
                                <div>
                                    <span className="text-slate-500 block">Estado:</span>
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{selectedLog.status}</span>
                                </div>
                            </div>
                            {selectedLog.userAgent && (
                                <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60 text-[11px]">
                                    <span className="text-slate-500 block">User Agent:</span>
                                    <span className="font-mono text-slate-600 dark:text-slate-300 break-all">{selectedLog.userAgent}</span>
                                </div>
                            )}
                        </div>

                        {/* Recurso Afectado */}
                        <div className="space-y-2 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs">
                            <h4 className="font-bold text-slate-800 dark:text-slate-200">Recurso Afectado</h4>
                            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">{selectedLog.resourceTargetName}</p>
                            {selectedLog.resourceTargetId && (
                                <p className="text-[10px] font-mono text-slate-500 break-all">{selectedLog.resourceTargetId}</p>
                            )}
                        </div>

                        {/* Metadatos Payload JSON */}
                        <div className="space-y-2">
                            <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200">{t("changeMetadata")}</h4>
                            <div className="bg-slate-950 text-slate-100 font-mono text-xs p-4 rounded-xl border border-slate-800 overflow-x-auto max-h-72">
                                <pre>{JSON.stringify(selectedLog.metadataJson || {}, null, 2)}</pre>
                            </div>
                        </div>

                        {/* Botón de Cierre */}
                        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setSelectedLog(null)}
                                className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-5 py-2 rounded-lg text-xs font-semibold transition-colors"
                            >
                                {t("closeDrawer")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export { AuditTrailPanel as AuditPanel };
