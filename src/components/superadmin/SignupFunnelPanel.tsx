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
    SignupFunnelMetrics,
    RecentSignupItem,
    FunnelFilters,
    SaaSPlanTier,
    SignupStatus,
} from "@/types/signupFunnel.types";
import {
    IconChartInfographic,
    IconUserPlus,
    IconClock,
    IconCash,
    IconTrendingUp,
    IconUserX,
    IconFilter,
    IconEraser,
    IconColumns,
    IconSearch,
    IconRefresh,
    IconLoader2,
    IconEye,
    IconChevronLeft,
    IconChevronRight,
    IconSparkles,
    IconX,
    IconCheck,
    IconCircleCheck,
    IconCircleDashed,
} from "@tabler/icons-react";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "email", label: "Correo Electrónico", visible: true, width: 260 },
    { id: "plan", label: "Plan Asignado", visible: true, width: 160 },
    { id: "status", label: "Estado", visible: true, width: 140 },
    { id: "trialDays", label: "Días Restantes", visible: true, width: 140 },
    { id: "date", label: "Fecha de Inscripción", visible: true, width: 160 },
    { id: "actions", label: "Acciones", visible: true, width: 140 },
];

export default function SignupFunnelPanel() {
    const t = useTranslations("SuperAdminFunnel");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [metrics, setMetrics] = useState<SignupFunnelMetrics | null>(null);
    const [recentSignups, setRecentSignups] = useState<RecentSignupItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filtros
    const [emailFilter, setEmailFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [planFilter, setPlanFilter] = useState("ALL");
    const [activeFilters, setActiveFilters] = useState<FunnelFilters>({});

    // Modal de Onboarding
    const [selectedSignupDetail, setSelectedSignupDetail] = useState<RecentSignupItem | null>(null);

    // Tabla: Paginación
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Configuración y Redimensionamiento de Columnas
    const storageKey = `table_columns_config_signup_funnel_${tenantId}`;
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

    // Cargar datos
    const loadFunnelData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const params = new URLSearchParams();
            if (isMock) params.set("mock", "true");
            if (activeFilters.status && activeFilters.status !== "ALL") params.set("status", activeFilters.status);
            if (activeFilters.plan && activeFilters.plan !== "ALL") params.set("plan", activeFilters.plan);
            if (activeFilters.searchEmail && activeFilters.searchEmail.trim()) {
                params.set("q", activeFilters.searchEmail.trim());
            }

            const res = await fetch(`/api/superadmin/signup-funnel?${params.toString()}`, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al obtener datos del embudo");
            }

            setMetrics(json.metrics);
            setRecentSignups(json.recentSignups || []);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [isMock, activeFilters, getAuthHeaders]);

    useEffect(() => {
        loadFunnelData();
    }, [loadFunnelData]);

    const handleApplyFilters = (e: React.FormEvent) => {
        e.preventDefault();
        setCurrentPage(1);
        setActiveFilters({
            searchEmail: emailFilter,
            status: statusFilter,
            plan: planFilter,
        });
    };

    const handleClearFilters = () => {
        setEmailFilter("");
        setStatusFilter("ALL");
        setPlanFilter("ALL");
        setCurrentPage(1);
        setActiveFilters({});
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
        setColumns(DEFAULT_COLUMNS);
    };

    // Paginación
    const totalPages = Math.max(1, Math.ceil(recentSignups.length / pageSize));
    const paginatedSignups = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return recentSignups.slice(start, start + pageSize);
    }, [recentSignups, currentPage, pageSize]);

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header y Subtítulo */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconChartInfographic size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("title") || "Análisis de Embudo de Inscripción"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Métricas globales del embudo de conversión, retención, activación y listado de nuevos tenants en trial o convertidos."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("subtitle") ||
                            "Rastrear la conversión de inscripciones, progresión del onboarding de nuevos tenants y métricas de prueba activa."}
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

            {/* ─── FILA DE 5 KPI CARDS SUPERIORES (Tonos de azul corporativo) ────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Card 1: Inscripciones (30d) */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiSignups30d") || "Inscripciones (30d)"}
                        </span>
                        <div className="text-2xl font-bold text-[#0078D4] mt-1 font-['Montserrat',sans-serif]">
                            {metrics?.totalSignups30d ?? 0}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0078D4]">
                        <IconUserPlus size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 2: Pruebas Activas */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiActiveTrials") || "Pruebas Activas"}
                        </span>
                        <div className="text-2xl font-bold text-[#2563EB] mt-1 font-['Montserrat',sans-serif]">
                            {metrics?.activeTrials ?? 0}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#2563EB]">
                        <IconClock size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 3: Convertido */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiConverted") || "Convertido"}
                        </span>
                        <div className="text-2xl font-bold text-[#0284C7] mt-1 font-['Montserrat',sans-serif]">
                            {metrics?.convertedCount ?? 0}
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0284C7]">
                        <IconCash size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 4: Tasa de Conversión */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiConversionRate") || "Tasa de Conversión"}
                        </span>
                        <div className="text-2xl font-bold text-[#0078D4] mt-1 font-['Montserrat',sans-serif]">
                            {(metrics?.conversionRatePercent ?? 0).toFixed(2)}%
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0078D4]">
                        <IconTrendingUp size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 5: Tasa de Rotación (Churn - En Neutro Slate Oscuro, Prohibido Rojo/Naranja) */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiChurnRate") || "Tasa de Rotación (Churn)"}
                        </span>
                        <div className="text-2xl font-bold text-[#0F172A] dark:text-slate-100 mt-1 font-['Montserrat',sans-serif]">
                            {(metrics?.churnRatePercent ?? 0).toFixed(2)}%
                        </div>
                    </div>
                    <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-700 dark:text-slate-300">
                        <IconUserX size={22} stroke={1.5} />
                    </div>
                </div>
            </div>

            {/* ─── SECCIÓN 1: Tarjeta "Embudo de Conversión" (Ancho 100%) ────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <IconFilter size={18} stroke={1.5} className="text-[#0078D4]" />
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("funnelTitle") || "Embudo de Conversión"}
                        </h2>
                    </div>
                    <span className="text-xs text-slate-500 font-medium">Últimos 90 días</span>
                </div>

                <div className="space-y-4">
                    {metrics?.funnelSteps && metrics.funnelSteps.length > 0 ? (
                        metrics.funnelSteps.map((step, idx) => (
                            <div key={step.stepKey} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-[#0078D4] flex items-center justify-center font-bold text-[11px] border border-blue-200 dark:border-blue-800">
                                            {idx + 1}
                                        </span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                            {step.stepDisplayName}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-slate-600 dark:text-slate-400 font-medium">
                                            {step.count} {step.count === 1 ? "tenant" : "tenants"}
                                        </span>
                                        <span className="font-bold text-[#0078D4] min-w-[50px] text-right">
                                            {step.percentage.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                                <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-[#0078D4] rounded-full transition-all duration-500"
                                        style={{ width: `${Math.max(4, Math.min(100, step.percentage))}%` }}
                                    />
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="py-6 text-center text-xs text-slate-500 italic">
                            {t("loadingStages")}
                        </div>
                    )}
                </div>
            </div>

            {/* ─── SECCIÓN 2: Tabla "Inscripciones Recientes" (Estándar CMP) ─────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4 p-6">
                {/* Barra de Filtros */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                            {t("recentSignupsTitle") || "Inscripciones Recientes"} ({recentSignups.length})
                        </h2>
                        <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[#0078D4] text-[11px] font-semibold rounded-md">
                            {t("badgeLast90Days") || "Últimos 90 días"}
                        </span>
                        <button
                            onClick={loadFunnelData}
                            className="p-1 text-slate-400 hover:text-[#0078D4] rounded transition-colors"
                            title="Refrescar datos"
                        >
                            <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        <form onSubmit={handleApplyFilters} className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                            {/* Buscador de Email */}
                            <div className="relative">
                                <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={emailFilter}
                                    onChange={(e) => setEmailFilter(e.target.value)}
                                    placeholder={t("filterEmailPlaceholder") || "Buscar por email..."}
                                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0078D4] w-44"
                                />
                            </div>

                            {/* Dropdown Estado */}
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            >
                                <option value="ALL">{t("filterAll") || "Todos los Estados"}</option>
                                <option value="ACTIVE">{t("filterActive") || "Activo"}</option>
                                <option value="EXPIRED">{t("filterExpired") || "Expirado"}</option>
                                <option value="CONVERTED">{t("filterConverted") || "Convertido"}</option>
                            </select>

                            {/* Dropdown Plan (3 Tiers Oficiales) */}
                            <select
                                value={planFilter}
                                onChange={(e) => setPlanFilter(e.target.value)}
                                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                            >
                                <option value="ALL">{t("filterAll") || "Todos los Planes"}</option>
                                <option value="Professional">Professional</option>
                                <option value="Business">Business</option>
                                <option value="Enterprise">Enterprise</option>
                            </select>

                            <button
                                type="submit"
                                className="inline-flex items-center gap-1 bg-[#0078D4] hover:bg-[#0060AA] text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all"
                            >
                                <IconFilter size={14} stroke={1.5} className="text-white" />
                                <span>{t("btnFilter") || "Filtrar"}</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleClearFilters}
                                className="inline-flex items-center gap-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                            >
                                <IconEraser size={14} stroke={1.5} className="text-slate-500" />
                                <span>{t("btnClear") || "Limpiar"}</span>
                            </button>
                        </form>

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
                                            <span>Cargando inscripciones...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedSignups.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500 italic">
                                        {t("emptyFiltered")}
                                    </td>
                                </tr>
                            ) : (
                                paginatedSignups.map((signup) => (
                                    <tr key={signup.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {/* Correo Electrónico (Avatar + Email + TenantId) */}
                                        {columns.find((c) => c.id === "email")?.visible && (
                                            <td className="px-4 py-3 text-slate-900 dark:text-slate-100 font-semibold">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-950/50 text-[#0078D4] flex items-center justify-center font-bold text-xs shrink-0 border border-blue-200 dark:border-blue-800">
                                                        {signup.userEmail.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px]" title={signup.userEmail}>
                                                            {signup.userEmail}
                                                        </div>
                                                        <div className="text-[10.5px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[180px]">
                                                            {signup.tenantId}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        )}

                                        {/* Plan Asignado */}
                                        {columns.find((c) => c.id === "plan")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span
                                                    className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${
                                                        signup.planTier === "Enterprise"
                                                            ? "bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] border-blue-200 dark:border-blue-800"
                                                            : signup.planTier === "Business"
                                                            ? "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800"
                                                            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                                                    }`}
                                                >
                                                    {signup.planTier}
                                                </span>
                                            </td>
                                        )}

                                        {/* Estado */}
                                        {columns.find((c) => c.id === "status")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span
                                                    className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                                                        signup.status === "ACTIVE"
                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                                            : signup.status === "CONVERTED"
                                                            ? "bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
                                                            : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                                    }`}
                                                >
                                                    {signup.status}
                                                </span>
                                            </td>
                                        )}

                                        {/* Días Restantes */}
                                        {columns.find((c) => c.id === "trialDays")?.visible && (
                                            <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                                {signup.trialDaysRemaining} {signup.trialDaysRemaining === 1 ? "día" : "días"}
                                            </td>
                                        )}

                                        {/* Fecha de Inscripción */}
                                        {columns.find((c) => c.id === "date")?.visible && (
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap">
                                                {signup.formattedDate}
                                            </td>
                                        )}

                                        {/* Acciones (Ver Onboarding) */}
                                        {columns.find((c) => c.id === "actions")?.visible && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedSignupDetail(signup)}
                                                    className="inline-flex items-center gap-1 text-[#0078D4] hover:text-[#0054A6] dark:text-blue-400 font-medium hover:underline"
                                                >
                                                    <IconEye size={14} stroke={1.5} />
                                                    <span>{t("btnViewOnboarding") || "Ver Onboarding"}</span>
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
                        <span>Mostrar:</span>
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
                        <span>de {recentSignups.length} registros</span>
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

            {/* ─── MODAL: Detalle de Onboarding (z-[100]) ───────────────────────────── */}
            {selectedSignupDetail && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
                        <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                    {t("modalOnboardingTitle") || "Detalle de Progresión de Onboarding"}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {t.rich("userLine", { email: selectedSignupDetail.userEmail, b: (c) => <strong>{c}</strong> })}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedSignupDetail(null)}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Tenant ID:</span>
                                    <span className="font-mono text-slate-800 dark:text-slate-200">{selectedSignupDetail.tenantId}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Plan:</span>
                                    <span className="font-semibold text-[#0078D4]">{selectedSignupDetail.planTier}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Estado:</span>
                                    <span className="font-semibold">{selectedSignupDetail.status}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Fecha de Registro:</span>
                                    <span className="font-mono">{selectedSignupDetail.formattedDate}</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                    {t("cloudActivationMilestones")}
                                </h4>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                                        <IconCircleCheck size={16} className="text-emerald-600 shrink-0" />
                                        <span>Prueba Iniciada y Cuenta Creada</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                                        <IconCircleCheck size={16} className="text-emerald-600 shrink-0" />
                                        <span>Registro de Aplicación en Microsoft Entra ID</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                                        <IconCircleCheck size={16} className="text-emerald-600 shrink-0" />
                                        <span>Permisos de Lector / Reader en Suscripciones Azure</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                                        {selectedSignupDetail.status === "ACTIVE" || selectedSignupDetail.status === "CONVERTED" ? (
                                            <IconCircleCheck size={16} className="text-emerald-600 shrink-0" />
                                        ) : (
                                            <IconCircleDashed size={16} className="text-slate-400 shrink-0" />
                                        )}
                                        <span>Primer Reporte FinOps y Telemetría de Costos Generada</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setSelectedSignupDetail(null)}
                                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                {t("close") || "Cerrar"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export { SignupFunnelPanel };
