"use client";
/**
 * ExecutiveReportsHistoryPanel.tsx — Historial de Reportes Ejecutivos FinOps con Persistencia en Azure Blob Storage.
 *
 * Cumple estrictamente con:
 *   - Directiva Full-Width (100% de ancho de ventana, sin max-w-5xl/7xl).
 *   - Paleta corporativa: Fondos neutros y cifras numéricas en azul corporativo (#0078D4 / #2563EB / #0284C7).
 *   - Retención de almacenamiento mapeada por Tier (Professional: 90d, Business: 180d, Enterprise: 365d).
 *   - Tabla CMP redimensionable (ResizableTh) con scrollbar visible en macOS.
 *   - Menú de columnas en z-[100] con persistencia en localStorage.
 *   - Drawer lateral de previsualización rápida en z-50 con backdrop.
 *   - Modal de confirmación para eliminación con actualización optimista (Optimistic UI).
 *   - Iconografía exclusiva Tabler Icons sin fondos de color.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    IconAlertCircle,
    IconArrowUpRight,
    IconClockCheck,
    IconCloudDataConnection,
    IconColumns,
    IconDownload,
    IconEye,
    IconFileText,
    IconHistory,
    IconInfoCircle,
    IconLoader2,
    IconMailCheck,
    IconRefresh,
    IconSearch,
    IconTrash,
    IconX,
} from "@tabler/icons-react";
import { errorMessage } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import { ColumnMenu, useColumnConfig, type TableColumnConfig } from "@/components/TableColumns";
import type { ExecutiveReportHistoryItem, ReportHistorySummaryMetrics, SaaSPlanTier } from "@/types/executiveReportHistory.types";
import toast from "react-hot-toast";

const HISTORY_COLUMNS: TableColumnConfig[] = [
    { id: "date", label: "Fecha y Hora", visible: true },
    { id: "scope", label: "Alcance", visible: true },
    { id: "requestedBy", label: "Solicitado por", visible: true },
    { id: "cost", label: "Gasto Snapshot", visible: true },
    { id: "savings", label: "Ahorro Snapshot", visible: true },
    { id: "emailSent", label: "Enviado por Email", visible: true },
    { id: "storage", label: "Almacenamiento / Retención", visible: true },
    { id: "actions", label: "Acciones", visible: true },
];

const MACOS_SCROLL =
    "w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
    "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
    "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
    "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
    "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

function fmtUSD(n: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

export default function ExecutiveReportsHistoryPanel() {
    const t = useTranslations("AdminReportHistory");
    const localeT = useTranslations("AdminReport");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "";
    const isMock = isMockTenant(tenantId);

    const [summaryData, setSummaryData] = useState<ReportHistorySummaryMetrics>({
        totalReportsCount: 0,
        tierRetentionDays: 90,
        activePlanTier: "Professional",
        totalStorageSizeBytes: 0,
        formattedTotalStorageMb: "0.0 MB",
        emailDeliveredCount: 0,
        reports: [],
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filtros y búsqueda
    const [searchTerm, setSearchTerm] = useState("");
    const [scopeFilter, setScopeFilter] = useState("ALL");
    const [emailFilter, setEmailFilter] = useState("ALL");
    const [sortBy, setSortBy] = useState<"date" | "cost" | "savings">("date");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(15);

    // Drawer de previsualización lateral
    const [previewItem, setPreviewItem] = useState<ExecutiveReportHistoryItem | null>(null);
    const [previewContent, setPreviewContent] = useState<string>("");
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Modal de confirmación de eliminación
    const [itemToDelete, setItemToDelete] = useState<ExecutiveReportHistoryItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const tableCols = useColumnConfig(`table_columns_config_reports_history_${tenantId}`, HISTORY_COLUMNS);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock) return {};
        const account = accounts[0];
        if (!account) return {};
        try {
            const token = await getFreshIdToken(instance, account);
            return { Authorization: `Bearer ${token}` };
        } catch {
            return {};
        }
    }, [accounts, instance, isMock]);

    const loadHistory = useCallback(async () => {
        if (!tenantId || tenantId === "default") return;
        setLoading(true);
        setError(null);
        try {
            const headers = await authHeaders();
            const url = `/api/reports/history?tenantId=${encodeURIComponent(tenantId)}&page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(searchTerm)}&scopeFilter=${encodeURIComponent(scopeFilter)}&emailFilter=${encodeURIComponent(emailFilter)}&sortBy=${sortBy}`;
            const res = await fetch(url, { headers });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || `HTTP ${res.status}`);
            }
            setSummaryData({
                totalReportsCount: Number(json.totalReportsCount || 0),
                tierRetentionDays: Number(json.tierRetentionDays || 90),
                activePlanTier: (json.activePlanTier || "Professional") as SaaSPlanTier,
                totalStorageSizeBytes: Number(json.totalStorageSizeBytes || 0),
                formattedTotalStorageMb: String(json.formattedTotalStorageMb || "0.0 MB"),
                emailDeliveredCount: Number(json.emailDeliveredCount || 0),
                reports: Array.isArray(json.reports) ? json.reports : [],
            });
        } catch (e) {
            setError(errorMessage(e) || t("loadError"));
            setSummaryData((prev) => ({ ...prev, reports: [], totalReportsCount: 0 }));
        } finally {
            setLoading(false);
        }
    }, [tenantId, page, pageSize, searchTerm, scopeFilter, emailFilter, sortBy, authHeaders, t]);

    useEffect(() => {
        setPage(1);
    }, [tenantId, searchTerm, scopeFilter, emailFilter, sortBy]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    // Previsualización en Drawer
    const handleOpenPreview = async (item: ExecutiveReportHistoryItem) => {
        setPreviewItem(item);
        setLoadingPreview(true);
        setPreviewContent(item.reportMarkdown || "");
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/reports/history/${item.id}/rehydrate?tenantId=${encodeURIComponent(tenantId)}`, { headers });
            const json = await res.json();
            if (res.ok && json.report) {
                setPreviewContent(String(json.report));
            }
        } catch {
            // best-effort
        } finally {
            setLoadingPreview(false);
        }
    };

    const handleDownload = async (reportId: string, fileType: "pdf" | "json" = "pdf") => {
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/reports/history/${reportId}/download?tenantId=${encodeURIComponent(tenantId)}&fileType=${fileType}`, { headers });
            if (!res.ok) throw new Error("Error al descargar");
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Reporte-FinOps-${tenantId}-${reportId}.${fileType}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success(`Descarga de ${fileType.toUpperCase()} iniciada.`);
        } catch (err) {
            toast.error(errorMessage(err));
        }
    };

    const handleConfirmDelete = async () => {
        if (!itemToDelete) return;
        const targetId = itemToDelete.id;
        setIsDeleting(true);

        // Optimistic UI update
        const prevReports = [...summaryData.reports];
        setSummaryData((prev) => ({
            ...prev,
            totalReportsCount: Math.max(0, prev.totalReportsCount - 1),
            reports: prev.reports.filter((r) => r.id !== targetId),
        }));

        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/reports/history/${targetId}?tenantId=${encodeURIComponent(tenantId)}`, {
                method: "DELETE",
                headers,
            });
            if (!res.ok) throw new Error("Error al eliminar del almacenamiento");
            toast.success(t("deleteSuccessToast"));
            setItemToDelete(null);
            if (previewItem?.id === targetId) setPreviewItem(null);
        } catch (err) {
            toast.error(errorMessage(err));
            // Rollback optimistic update
            setSummaryData((prev) => ({ ...prev, reports: prevReports, totalReportsCount: prevReports.length }));
        } finally {
            setIsDeleting(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(summaryData.totalReportsCount / pageSize));

    if (!selectedTenant || selectedTenant.id === "default") {
        return <div className="p-6 text-sm text-slate-500">{localeT("selectTenantSubtitle")}</div>;
    }

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in">
            {/* HEADER PRINCIPAL Y SUBTÍTULO DINÁMICO */}
            <div className="w-full flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 dark:border-slate-800 pb-5 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white tracking-tight flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                        <IconHistory size={28} stroke={1.5} className="text-[#0078D4]" />
                        {t("title")}
                        <InfoTooltip content={t("titleTooltip")} />
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t("subtitle", { days: summaryData.tierRetentionDays, plan: summaryData.activePlanTier })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => void loadHistory()}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-[#0078D4] dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-xs"
                    >
                        <IconRefresh size={14} stroke={1.5} className={loading ? "animate-spin" : ""} />
                        Actualizar
                    </button>
                </div>
            </div>

            {/* 4 KPI CARDS SUPERIORES EN TONOS DE AZUL Y FONDOS NEUTROS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span>{t("kpiStoredReports")}</span>
                        <IconFileText size={18} stroke={1.5} className="text-[#0078D4]" />
                    </div>
                    <div className="text-2xl font-extrabold tabular-nums text-[#0078D4]">
                        {summaryData.totalReportsCount}
                    </div>
                    <div className="text-[11px] text-slate-400">{t("snapshotsInStorage")}</div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span>{t("kpiTierRetention")}</span>
                        <IconClockCheck size={18} stroke={1.5} className="text-[#2563EB]" />
                    </div>
                    <div className="text-2xl font-extrabold tabular-nums text-[#2563EB]">
                        {t("daysValue", { n: summaryData.tierRetentionDays })}
                    </div>
                    <div className="text-[11px] text-slate-400">Plan {summaryData.activePlanTier}</div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span>{t("kpiStorageSpace")}</span>
                        <IconCloudDataConnection size={18} stroke={1.5} className="text-[#0284C7]" />
                    </div>
                    <div className="text-2xl font-extrabold tabular-nums text-[#0284C7]">
                        {summaryData.formattedTotalStorageMb}
                    </div>
                    <div className="text-[11px] text-slate-400">Blobs PDF & JSON cifrados</div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span>{t("kpiNotifiedReports")}</span>
                        <IconMailCheck size={18} stroke={1.5} className="text-[#0078D4]" />
                    </div>
                    <div className="text-2xl font-extrabold tabular-nums text-[#0078D4]">
                        {t("kpiDeliveredSuffix", { count: summaryData.emailDeliveredCount })}
                    </div>
                    <div className="text-[11px] text-slate-400">{t("emailNotifications")}</div>
                </div>
            </div>

            {/* BARRA DE HERRAMIENTAS, FILTROS Y PERSONALIZACIÓN DE COLUMNAS */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5 flex-1">
                    <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
                        <IconSearch size={16} stroke={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder={t("searchPlaceholder")}
                            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 outline-none focus:border-[#0078D4]"
                        />
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500">{t("filterScope")}:</span>
                        <select
                            value={scopeFilter}
                            onChange={(e) => setScopeFilter(e.target.value)}
                            className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-[#0078D4]"
                        >
                            <option value="ALL">{t("filterScopeAll")}</option>
                            <option value="TENANT_ALL">{t("filterScopeTenant")}</option>
                            <option value="mock-sub-1">Production (mock-sub-1)</option>
                            <option value="mock-sub-2">Staging (mock-sub-2)</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500">{t("filterEmail")}:</span>
                        <select
                            value={emailFilter}
                            onChange={(e) => setEmailFilter(e.target.value)}
                            className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-[#0078D4]"
                        >
                            <option value="ALL">{t("filterEmailAll")}</option>
                            <option value="SENT">{t("filterEmailSent")}</option>
                            <option value="NOT_SENT">{t("filterEmailNotSent")}</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500">{t("sortBy")}:</span>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-[#0078D4]"
                        >
                            <option value="date">{t("sortRecent")}</option>
                            <option value="cost">{t("sortCost")}</option>
                            <option value="savings">{t("sortSavings")}</option>
                        </select>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto">
                    <ColumnMenu {...tableCols} />
                </div>
            </div>

            {/* TABLA PRINCIPAL DE HISTORIAL REDIMENSIONABLE & MACOS SCROLL */}
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className={MACOS_SCROLL}>
                    <table className="w-full text-xs border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                            <tr>
                                {tableCols.isVisible("date") && <ResizableTh minWidth={140} className="px-3.5 py-3 text-left font-bold">{t("colDate")}</ResizableTh>}
                                {tableCols.isVisible("scope") && <ResizableTh minWidth={160} className="px-3.5 py-3 text-left font-bold">{t("colScope")}</ResizableTh>}
                                {tableCols.isVisible("requestedBy") && <ResizableTh minWidth={180} className="px-3.5 py-3 text-left font-bold">{t("colRequestedBy")}</ResizableTh>}
                                {tableCols.isVisible("cost") && <ResizableTh minWidth={120} className="px-3.5 py-3 text-right font-bold">{t("colCost")}</ResizableTh>}
                                {tableCols.isVisible("savings") && <ResizableTh minWidth={120} className="px-3.5 py-3 text-right font-bold">{t("colSavings")}</ResizableTh>}
                                {tableCols.isVisible("emailSent") && <ResizableTh minWidth={110} className="px-3.5 py-3 text-center font-bold">{t("colEmailSent")}</ResizableTh>}
                                {tableCols.isVisible("storage") && <ResizableTh minWidth={160} className="px-3.5 py-3 text-left font-bold">{t("colStorage")}</ResizableTh>}
                                {tableCols.isVisible("actions") && <ResizableTh minWidth={220} className="px-3.5 py-3 text-right font-bold">{t("colActions")}</ResizableTh>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="py-12 text-center text-slate-500">
                                        <div className="inline-flex items-center gap-2 text-[#0078D4] text-sm">
                                            <IconLoader2 size={20} stroke={1.5} className="animate-spin" />
                                            {t("loading")}
                                        </div>
                                    </td>
                                </tr>
                            ) : summaryData.reports.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="py-12 text-center text-slate-400 dark:text-slate-500">
                                        <IconAlertCircle size={32} stroke={1.5} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                                        <p className="text-sm font-semibold">{t("empty")}</p>
                                        <p className="text-xs mt-1">{t("emptyHint")}</p>
                                    </td>
                                </tr>
                            ) : (
                                summaryData.reports.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {tableCols.isVisible("date") && (
                                            <td className="px-3.5 py-3 font-medium whitespace-nowrap text-slate-900 dark:text-slate-100">
                                                {item.formattedCreatedAt}
                                            </td>
                                        )}
                                        {tableCols.isVisible("scope") && (
                                            <td className="px-3.5 py-3">
                                                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                    {item.scopeDisplayName}
                                                </span>
                                            </td>
                                        )}
                                        {tableCols.isVisible("requestedBy") && (
                                            <td className="px-3.5 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-950/60 text-[#0078D4] font-bold flex items-center justify-center text-[10px] shrink-0">
                                                        {item.requestedByName.charAt(0)}
                                                    </div>
                                                    <div className="truncate max-w-[150px]" title={item.requestedByEmail}>
                                                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">{item.requestedByName}</div>
                                                        <div className="text-[10px] text-slate-400 truncate">{item.requestedByEmail}</div>
                                                    </div>
                                                </div>
                                            </td>
                                        )}
                                        {tableCols.isVisible("cost") && (
                                            <td className="px-3.5 py-3 text-right font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                                                {item.totalMonthlyCostSnapshotUSD === null ? "—" : fmtUSD(item.totalMonthlyCostSnapshotUSD)}
                                            </td>
                                        )}
                                        {tableCols.isVisible("savings") && (
                                            <td className="px-3.5 py-3 text-right font-mono tabular-nums font-bold text-[#2563EB] dark:text-blue-400">
                                                {item.totalMonthlySavingsSnapshotUSD === null ? "—" : fmtUSD(item.totalMonthlySavingsSnapshotUSD)}
                                            </td>
                                        )}
                                        {tableCols.isVisible("emailSent") && (
                                            <td className="px-3.5 py-3 text-center">
                                                {item.sentByEmail ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                                        {t("yes")}
                                                    </span>
                                                ) : (
                                                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                                        {t("no")}
                                                    </span>
                                                )}
                                            </td>
                                        )}
                                        {tableCols.isVisible("storage") && (
                                            <td className="px-3.5 py-3">
                                                <div className="space-y-0.5">
                                                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] dark:text-blue-400 border border-blue-200 dark:border-blue-900">
                                                        PDF ({item.formattedSizeMb})
                                                    </span>
                                                    <div className="text-[10px] text-slate-400">
                                                        {t("expiresInDays", { days: item.daysRemainingBeforeExpiry })}
                                                    </div>
                                                </div>
                                            </td>
                                        )}
                                        {tableCols.isVisible("actions") && (
                                            <td className="px-3.5 py-3 text-right">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleOpenPreview(item)}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-[#0078D4] text-white hover:bg-[#0060AA] transition-colors shadow-2xs"
                                                    >
                                                        <IconEye size={13} stroke={1.5} />
                                                        {t("view")}
                                                    </button>
                                                    <a
                                                        href={`/es/admin/reports?tab=executive&reportJob=${item.id}`}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs"
                                                    >
                                                        <IconArrowUpRight size={13} stroke={1.5} />
                                                        Abrir
                                                    </a>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDownload(item.id, "pdf")}
                                                        title="Descargar PDF"
                                                        className="p-1 text-[#0078D4] hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-md transition-colors"
                                                    >
                                                        <IconDownload size={15} stroke={1.5} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setItemToDelete(item)}
                                                        title="Eliminar Snapshot"
                                                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md transition-colors"
                                                    >
                                                        <IconTrash size={15} stroke={1.5} />
                                                    </button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* PAGINACIÓN CMP ESTÁNDAR (15 / 30 / 45 / 60) */}
                <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 gap-3 bg-slate-50/50 dark:bg-slate-900/50 text-xs">
                    <div className="flex items-center gap-2 text-slate-500">
                        <span>{t("totalLabel", { total: summaryData.totalReportsCount })}</span>
                        <span>·</span>
                        <div className="flex items-center gap-1">
                            <span>{t("pageSize")}:</span>
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setPage(1);
                                }}
                                className="h-7 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 text-xs text-slate-700 dark:text-slate-200"
                            >
                                <option value={15}>15</option>
                                <option value={30}>30</option>
                                <option value={45}>45</option>
                                <option value={60}>60</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
                        >
                            {t("prev")}
                        </button>
                        <span className="text-slate-600 dark:text-slate-400 font-medium">
                            {t("pageLabel", { page, totalPages })}
                        </span>
                        <button
                            type="button"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
                        >
                            {t("next")}
                        </button>
                    </div>
                </div>
            </div>

            {/* DRAWER LATERAL DE PREVISUALIZACIÓN RÁPIDA (z-50) */}
            {previewItem && (
                <div className="fixed inset-0 bg-black/50 z-50 flex justify-end animate-in fade-in duration-200">
                    <div className="w-full max-w-2xl bg-white dark:bg-slate-900 h-full shadow-2xl overflow-y-auto p-6 space-y-6 flex flex-col justify-between">
                        <div className="space-y-6">
                            <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                                <div>
                                    <h3 className="text-xl font-extrabold text-[#1B2A41] dark:text-white flex items-center gap-2 font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                                        <IconFileText size={22} stroke={1.5} className="text-[#0078D4]" />
                                        {t("selectedReportTitle", { id: previewItem.id })}
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {previewItem.formattedCreatedAt} · {previewItem.scopeDisplayName}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPreviewItem(null)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <IconX size={18} stroke={1.5} />
                                </button>
                            </div>

                            {/* TARJETAS CONGELADAS DEL SNAPSHOT */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("colCost")}</div>
                                    <div className="text-lg font-extrabold text-[#0078D4] tabular-nums mt-0.5">{previewItem.totalMonthlyCostSnapshotUSD === null ? "—" : fmtUSD(previewItem.totalMonthlyCostSnapshotUSD)}</div>
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("colSavings")}</div>
                                    <div className="text-lg font-extrabold text-[#2563EB] tabular-nums mt-0.5">{previewItem.totalMonthlySavingsSnapshotUSD === null ? "—" : fmtUSD(previewItem.totalMonthlySavingsSnapshotUSD)}</div>
                                </div>
                            </div>

                            {/* CONTENIDO MARKDOWN DEL ANÁLISIS */}
                            <div className="bg-slate-50/70 dark:bg-slate-800/30 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                {loadingPreview ? (
                                    <div className="flex items-center justify-center py-12 text-[#0078D4] text-xs">
                                        <IconLoader2 size={18} stroke={1.5} className="animate-spin mr-2" />
                                        {t("loadingReport")}
                                    </div>
                                ) : (
                                    <div className="prose prose-sm max-w-none text-slate-800 dark:text-slate-200 leading-relaxed text-justify">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ACCIONES DEL DRAWER */}
                        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                            <a
                                href={`/es/admin/reports?tab=executive&reportJob=${previewItem.id}`}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors"
                            >
                                <IconArrowUpRight size={15} stroke={1.5} />
                                {t("openExecutiveTab")}
                            </a>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => void handleDownload(previewItem.id, "json")}
                                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#0078D4] dark:text-blue-400 hover:bg-slate-50 transition-colors"
                                >
                                    {t("downloadJson")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleDownload(previewItem.id, "pdf")}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0078D4] hover:bg-[#0060AA] text-white text-xs font-semibold shadow-xs transition-colors"
                                >
                                    <IconDownload size={15} stroke={1.5} />
                                    {t("downloadPdf")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN (z-[100]) */}
            {itemToDelete && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-in fade-in">
                    <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                        <div className="flex items-center gap-3 text-rose-600">
                            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/50 rounded-xl border border-rose-200 dark:border-rose-900">
                                <IconTrash size={22} stroke={1.5} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white font-[Montserrat,'Montserrat_Fallback',sans-serif]">
                                {t("deleteModalTitle")}
                            </h3>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {t("deleteModalBody")}
                        </p>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                            <strong>Snapshot #{itemToDelete.id}:</strong> {itemToDelete.formattedCreatedAt} ({itemToDelete.scopeDisplayName})
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setItemToDelete(null)}
                                disabled={isDeleting}
                                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors"
                            >
                                {t("cancelButton")}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleConfirmDelete()}
                                disabled={isDeleting}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors"
                            >
                                {isDeleting ? <IconLoader2 size={14} stroke={1.5} className="animate-spin" /> : null}
                                {t("deleteButton")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
