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
    LoadTestEndpoint,
    LoadTestHistoryItem,
    SystemPerformanceAlertItem,
    RunLoadTestResponse,
} from "@/types/loadTesting.types";
import {
    IconBolt,
    IconShieldExclamation,
    IconPlayerPlay,
    IconTrendingUp,
    IconAlertTriangle,
    IconColumns,
    IconLoader2,
    IconCheck,
    IconSparkles,
    IconX,
    IconChevronLeft,
    IconChevronRight,
    IconFlame,
    IconGauge,
    IconActivity,
} from "@tabler/icons-react";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "date", label: "Fecha", visible: true, width: 170 },
    { id: "target", label: "Target", visible: true, width: 150 },
    { id: "concurrency", label: "Conc.", visible: true, width: 90 },
    { id: "requests", label: "Requests", visible: true, width: 110 },
    { id: "errors", label: "Errores", visible: true, width: 100 },
    { id: "p95", label: "P95", visible: true, width: 110 },
    { id: "throughput", label: "Throughput", visible: true, width: 140 },
    { id: "triggeredBy", label: "Por", visible: true, width: 220 },
];

export default function LoadTestingPanel() {
    const t = useTranslations("AdminLoadTest");
    const tAlerts = useTranslations("AdminSystemAlerts");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    // Estado del Formulario
    const [targetEndpoint, setTargetEndpoint] = useState<LoadTestEndpoint>("/api/status");
    const [concurrency, setConcurrency] = useState<number>(10);
    const [durationSeconds, setDurationSeconds] = useState<number>(5);
    const [runningTest, setRunningTest] = useState(false);
    const [lastTestResult, setLastTestResult] = useState<RunLoadTestResponse | null>(null);

    // Historial y Alertas
    const [history, setHistory] = useState<LoadTestHistoryItem[]>([]);
    const [alerts, setAlerts] = useState<SystemPerformanceAlertItem[]>([]);
    const [onlyPendingAlerts, setOnlyPendingAlerts] = useState(true);
    const [loadingData, setLoadingData] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Acciones de Alertas
    const [actingAlertId, setActingAlertId] = useState<string | null>(null);

    // Paginación
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Columnas y Redimensionamiento
    const storageKey = `table_columns_config_load_test_${tenantId}`;
    const [columns, setColumns] = useState<ColumnConfig[]>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) return JSON.parse(saved);
            } catch {
                /* noop */
            }
        }
        return DEFAULT_COLUMNS;
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

    // Cargar Historial y Alertas
    const loadAllData = useCallback(async () => {
        setLoadingData(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const historyUrl = isMock
                ? "/api/superadmin/load-test/runs?mock=true"
                : "/api/superadmin/load-test/runs";

            const alertsUrl = isMock
                ? `/api/superadmin/load-test/alerts?mock=true&pending=${onlyPendingAlerts}`
                : `/api/superadmin/load-test/alerts?pending=${onlyPendingAlerts}`;

            const [resHistory, resAlerts] = await Promise.all([
                fetch(historyUrl, { headers }),
                fetch(alertsUrl, { headers }),
            ]);

            const jsonHistory = await resHistory.json();
            const jsonAlerts = await resAlerts.json();

            if (jsonHistory.success) {
                setHistory(jsonHistory.history || jsonHistory.runs || []);
            }
            if (jsonAlerts.success) {
                setAlerts(jsonAlerts.alerts || []);
            }
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoadingData(false);
        }
    }, [isMock, onlyPendingAlerts, getAuthHeaders]);

    useEffect(() => {
        loadAllData();
    }, [loadAllData]);

    // Ejecutar Prueba de Carga
    const handleRunLoadTest = async (e: React.FormEvent) => {
        e.preventDefault();
        setRunningTest(true);
        setError(null);
        setSuccessMessage(null);
        setLastTestResult(null);

        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/load-test/run?mock=true"
                : "/api/superadmin/load-test/run";

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    targetEndpoint,
                    concurrencyLevel: concurrency,
                    durationSeconds,
                }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("errorRunningTest"));
            }

            setLastTestResult(json);
            setSuccessMessage("Prueba de carga completada exitosamente.");
            await loadAllData();
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setRunningTest(false);
        }
    };

    // Reconocer Alerta
    const handleAcknowledgeAlert = async (alertId: string) => {
        setActingAlertId(alertId);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? `/api/superadmin/load-test/alerts/${alertId}/ack?mock=true`
                : `/api/superadmin/load-test/alerts/${alertId}/ack`;

            const res = await fetch(url, { method: "POST", headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al reconocer la alerta");
            }

            setAlerts((prev) =>
                prev.map((a) =>
                    a.id === alertId ? { ...a, status: "ACKNOWLEDGED", acknowledgedAtIso: new Date().toISOString() } : a
                )
            );
            setSuccessMessage("Alerta reconocida.");
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setActingAlertId(null);
        }
    };

    // Resolver Alerta
    const handleResolveAlert = async (alertId: string) => {
        setActingAlertId(alertId);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? `/api/superadmin/load-test/alerts/${alertId}/resolve?mock=true`
                : `/api/superadmin/load-test/alerts/${alertId}/resolve`;

            const res = await fetch(url, { method: "POST", headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al resolver la alerta");
            }

            setAlerts((prev) => prev.filter((a) => a.id !== alertId));
            setSuccessMessage("Alerta resuelta.");
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setActingAlertId(null);
        }
    };

    // Redimensionamiento de columnas
    const handleResizeMouseDown = (columnId: string, e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const targetCol = columns.find((c) => c.id === columnId);
        if (!targetCol) return;
        const startWidth = targetCol.width;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            const newWidth = Math.max(80, Math.min(600, startWidth + delta));
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
        setColumns(DEFAULT_COLUMNS);
    };

    const totalHistoryItems = history.length;
    const totalPages = Math.max(1, Math.ceil(totalHistoryItems / pageSize));
    const paginatedHistory = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return history.slice(start, start + pageSize);
    }, [history, currentPage, pageSize]);

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header Principal */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconBolt size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("pageTitle") || "Prueba de Carga"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Ejecuta tráfico HTTP concurrente contra el servidor para medir latencia P95 y throughput bajo carga real."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("pageSubtitle") ||
                            "Genera concurrencia real contra el propio servidor para evaluar su comportamiento bajo carga. Solo visible para Super Administradores."}
                    </p>
                </div>

                {isMock && (
                    <DemoModeBadge />
                )}
            </div>

            {/* Banner de Advertencia (Producción Segura) */}
            <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl flex items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
                <IconAlertTriangle size={20} className="text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                    {t("warningBanner") ||
                        "Esto ejecuta tráfico real contra el servidor en producción (no un simulador aislado). Usá valores conservadores primero. Los límites duros son concurrencia máxima 50 y duración máxima 15s."}
                </span>
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

            {/* ─── SECCIÓN 1: Tarjeta "Configuración de Prueba" (Ancho 100%) ───────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                        <IconFlame size={18} stroke={1.5} className="text-[#0078D4]" />
                        <span>Configuración de Prueba</span>
                    </h2>
                    <span className="text-[11px] text-slate-500 font-mono">Límites: 50 conc · 15s</span>
                </div>

                <form onSubmit={handleRunLoadTest} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Columna 1: Endpoint */}
                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("targetEndpointLabel") || "Endpoint objetivo"}
                            </label>
                            <select
                                value={targetEndpoint}
                                onChange={(e) => setTargetEndpoint(e.target.value as LoadTestEndpoint)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            >
                                <option value="/api/status">{t("targetOptionStatus") || "/api/status (con DB — techo real MySQL)"}</option>
                                <option value="/api/health">{t("targetOptionHealth") || "/api/health (sin DB — techo del procesador)"}</option>
                                <option value="/api/loadtest/probe">{t("targetOptionProbe") || "/api/loadtest/probe (autenticado SP — DB + Redis)"}</option>
                                <option value="/api/v1/costs">{t("targetOptionCosts") || "/api/v1/costs (consulta de costos)"}</option>
                                <option value="/api/exports/powerbi-feed">{t("targetOptionPowerBi") || "/api/exports/powerbi-feed (feed PowerBI)"}</option>
                            </select>
                        </div>

                        {/* Columna 2: Concurrencia */}
                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("concurrencyLabel") || "Concurrencia (1-50)"}
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={50}
                                value={concurrency}
                                onChange={(e) => setConcurrency(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                                required
                                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>

                        {/* Columna 3: Duración */}
                        <div className="space-y-1">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {t("durationLabel") || "Duración (segundos, máx 15)"}
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={15}
                                value={durationSeconds}
                                onChange={(e) => setDurationSeconds(Math.max(1, Math.min(15, parseInt(e.target.value) || 1)))}
                                required
                                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <span className="text-[11px] text-slate-500">
                            {t("runHint")}
                        </span>
                        <button
                            type="submit"
                            disabled={runningTest}
                            className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0060AA] text-white px-6 py-2.5 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                        >
                            {runningTest ? (
                                <IconLoader2 size={16} className="animate-spin text-white" />
                            ) : (
                                <IconPlayerPlay size={16} stroke={1.5} className="text-white" />
                            )}
                            <span>{runningTest ? t("runningLabel") || "Ejecutando..." : t("runButtonLabel") || "Ejecutar Prueba de Carga"}</span>
                        </button>
                    </div>
                </form>

                {/* Resumen del último resultado ejecutado */}
                {lastTestResult && (
                    <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-5 rounded-xl space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between text-xs font-bold text-[#0078D4] dark:text-blue-300">
                            <span>Resultado de la Prueba: {lastTestResult.result.target}</span>
                            <span>Throughput: {lastTestResult.result.throughputRps.toFixed(2)} req/s</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold">Requests</span>
                                <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                                    {lastTestResult.result.totalRequests}
                                </div>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold">Errores</span>
                                <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                                    {lastTestResult.result.errorCount}
                                </div>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold">P50 Latency</span>
                                <div className="text-base font-bold text-[#0078D4] font-mono">
                                    {lastTestResult.result.p50Ms} ms
                                </div>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold">P95 Latency</span>
                                <div className="text-base font-bold text-[#2563EB] font-mono">
                                    {lastTestResult.result.p95Ms} ms
                                </div>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold">P99 Latency</span>
                                <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                                    {lastTestResult.result.p99Ms} ms
                                </div>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50">
                                <span className="text-[10px] text-slate-400 uppercase font-semibold">Máx</span>
                                <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                                    {lastTestResult.result.maxMs} ms
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ─── SECCIÓN 2: Tabla "Historial de Pruebas" (Estándar CMP) ──────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                        <IconTrendingUp size={20} className="text-[#0078D4]" />
                        <span>{t("historyTitle") || "Historial"}</span>
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
                            {loadingData ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-12 text-center text-slate-500">
                                        <div className="inline-flex items-center gap-2">
                                            <IconLoader2 size={18} className="animate-spin text-[#0078D4]" />
                                            <span>Cargando historial de pruebas...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedHistory.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500">
                                        {t("noRunsYet") || "Todavía no se ejecutó ninguna prueba."}
                                    </td>
                                </tr>
                            ) : (
                                paginatedHistory.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {/* Fecha */}
                                        {columns.find((c) => c.id === "date")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                {item.formattedDate}
                                            </td>
                                        )}

                                        {/* Target */}
                                        {columns.find((c) => c.id === "target")?.visible && (
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded font-mono text-[10.5px] font-semibold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:border-blue-800">
                                                    {item.targetLabel}
                                                </span>
                                            </td>
                                        )}

                                        {/* Concurrency */}
                                        {columns.find((c) => c.id === "concurrency")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] text-slate-800 dark:text-slate-200">
                                                {item.concurrencyLevel}
                                            </td>
                                        )}

                                        {/* Requests */}
                                        {columns.find((c) => c.id === "requests")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] text-slate-800 dark:text-slate-200">
                                                {item.totalRequestsSent}
                                            </td>
                                        )}

                                        {/* Errores */}
                                        {columns.find((c) => c.id === "errors")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] text-slate-800 dark:text-slate-200">
                                                {item.totalErrorsCount}
                                            </td>
                                        )}

                                        {/* P95 Latency */}
                                        {columns.find((c) => c.id === "p95")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] font-bold text-[#0078D4] dark:text-blue-400 whitespace-nowrap">
                                                {item.p95LatencyMs} ms
                                            </td>
                                        )}

                                        {/* Throughput */}
                                        {columns.find((c) => c.id === "throughput")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                                {item.throughputReqPerSec.toFixed(2)} req/s
                                            </td>
                                        )}

                                        {/* Triggered By */}
                                        {columns.find((c) => c.id === "triggeredBy")?.visible && (
                                            <td className="px-3 py-3 text-[11px] text-slate-600 dark:text-slate-400">
                                                <span className="truncate max-w-[200px] block" title={item.executedByEmail}>
                                                    {item.executedByEmail}
                                                </span>
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Paginador CMP */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                        <span>Mostrar:</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value={15}>15 registros</option>
                            <option value={30}>30 registros</option>
                            <option value={45}>45 registros</option>
                            <option value={60}>60 registros</option>
                        </select>
                        <span>de {totalHistoryItems} pruebas totales</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40"
                        >
                            <IconChevronLeft size={16} />
                        </button>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {t("pageOf", { current: currentPage, total: totalPages })}
                        </span>
                        <button
                            type="button"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40"
                        >
                            <IconChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── SECCIÓN 3: Panel "Alertas del Sistema" (Ancho 100%) ─────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                            <IconShieldExclamation size={20} className="text-[#0078D4]" />
                            <span>{tAlerts("pageTitle") || "Alertas del Sistema"}</span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {tAlerts("pageSubtitle") ||
                                "Alertas de latencia/errores por alta concurrencia, generadas automáticamente por Pruebas de Carga. Solo visible para Super Administradores."}
                        </p>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={onlyPendingAlerts}
                            onChange={(e) => setOnlyPendingAlerts(e.target.checked)}
                            className="rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4]"
                        />
                        <span>{tAlerts("onlyPendingLabel") || "Solo pendientes"}</span>
                    </label>
                </div>

                {alerts.length === 0 ? (
                    <div className="bg-slate-50/50 dark:bg-slate-800/40 p-8 rounded-xl text-center text-xs text-slate-500">
                        {tAlerts("noPendingAlerts") || "No hay alertas pendientes."}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {tAlerts("colDate") || "Fecha"}
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {tAlerts("colType") || "Tipo"}
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {tAlerts("colSeverity") || "Severidad"}
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {tAlerts("colMessage") || "Mensaje"}
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                                        {tAlerts("colActions") || "Acciones"}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {alerts.map((alert) => (
                                    <tr key={alert.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                            {alert.formattedDate}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                            {alert.alertType}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            <span
                                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                                    alert.severity === "CRITICAL"
                                                        ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800"
                                                        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                                }`}
                                            >
                                                {alert.severity}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-[11px] text-slate-700 dark:text-slate-300">
                                            {alert.message}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                {alert.status === "PENDING" ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAcknowledgeAlert(alert.id)}
                                                        disabled={actingAlertId === alert.id}
                                                        className="px-2.5 py-1 rounded bg-[#0078D4] hover:bg-[#0060AA] text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
                                                    >
                                                        {actingAlertId === alert.id ? "..." : tAlerts("acknowledgeButton") || "Reconocer"}
                                                    </button>
                                                ) : (
                                                    <span className="text-[10.5px] text-emerald-600 font-semibold">
                                                        Reconocida
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleResolveAlert(alert.id)}
                                                    disabled={actingAlertId === alert.id}
                                                    className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors disabled:opacity-50"
                                                >
                                                    {tAlerts("resolveButton") || "Resolver"}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

export { LoadTestingPanel };
