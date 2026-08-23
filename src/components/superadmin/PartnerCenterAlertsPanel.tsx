"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from "@/lib/apiErrors";
import InfoTooltip from "@/components/InfoTooltip";
import {
    PartnerCenterMetrics,
    TenantPartnerAssociationItem,
    PartnerCenterStatusResponse,
} from "@/types/partnerCenterAlerts.types";
import {
    IconBellRinging,
    IconCircleCheck,
    IconClock,
    IconAlertCircle,
    IconCalendarStats,
    IconRefresh,
    IconSettings,
    IconColumns,
    IconLoader2,
    IconCheck,
    IconSparkles,
    IconX,
    IconAlertTriangle,
    IconChevronLeft,
    IconChevronRight,
    IconBuildingBank,
} from "@tabler/icons-react";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "tenant", label: "Tenant", visible: true, width: 260 },
    { id: "status", label: "Estado", visible: true, width: 140 },
    { id: "approvedAt", label: "Fecha", visible: true, width: 170 },
    { id: "approvedBy", label: "Aprobado Por", visible: true, width: 210 },
    { id: "detail", label: "Detalle", visible: true, width: 340 },
    { id: "actions", label: "Acciones", visible: true, width: 140 },
];

export default function PartnerCenterAlertsPanel() {
    const t = useTranslations("SuperAdminPartnerAlerts");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [statusData, setStatusData] = useState<PartnerCenterStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Re-vincular
    const [relinkingTenantId, setRelinkingTenantId] = useState<string | null>(null);

    // Modal Configurar Partner MPN ID
    const [isMpnModalOpen, setIsMpnModalOpen] = useState(false);
    const [partnerMpnInput, setPartnerMpnInput] = useState("");
    const [savingMpn, setSavingMpn] = useState(false);

    // Paginación
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Columnas y Redimensionamiento
    const storageKey = `table_columns_config_partner_center_${tenantId}`;
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
    const loadStatus = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? "/api/superadmin/partner-center/status?mock=true"
                : "/api/superadmin/partner-center/status";

            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("loadError"));
            }

            setStatusData(json);
            if (json.currentPartnerMpnId) {
                setPartnerMpnInput(json.currentPartnerMpnId);
            }
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [isMock, getAuthHeaders, t]);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    // Re-vincular PAL
    const handleRelink = async (tenantToRelink: string) => {
        setRelinkingTenantId(tenantToRelink);
        setError(null);
        setSuccessMessage(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/partner-center/relink?mock=true"
                : "/api/superadmin/partner-center/relink";

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({ tenantId: tenantToRelink }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al re-vincular");
            }

            // Actualización optimista
            if (statusData) {
                setStatusData({
                    ...statusData,
                    items: statusData.items.map((item) =>
                        item.tenantId === tenantToRelink
                            ? {
                                  ...item,
                                  status: "APPROVED_PENDING",
                                  formattedStatus: "Aprobado",
                                  errorDetailsText: "Re-vinculación en proceso...",
                              }
                            : item
                    ),
                });
            }

            setSuccessMessage(t("relinkSuccess") || "Solicitud de re-vinculación PAL enviada.");
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setRelinkingTenantId(null);
        }
    };

    // Guardar Partner MPN ID
    const handleSaveMpn = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingMpn(true);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/partner-center/configure-mpn?mock=true"
                : "/api/superadmin/partner-center/configure-mpn";

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({ partnerMpnId: partnerMpnInput }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al guardar Partner MPN ID");
            }

            if (statusData) {
                setStatusData({
                    ...statusData,
                    partnerMpnConfigured: true,
                    currentPartnerMpnId: partnerMpnInput.trim(),
                });
            }

            setIsMpnModalOpen(false);
            setSuccessMessage(t("configMpnSuccess") || "Partner MPN ID guardado correctamente.");
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setSavingMpn(false);
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

    const allItems = statusData?.items || [];
    const totalItems = allItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const paginatedItems = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return allItems.slice(start, start + pageSize);
    }, [allItems, currentPage, pageSize]);

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header y Acciones Globales */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconBellRinging size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("title") || "Alertas de Suscripción Partner Center"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Monitoreo y gestión de atribución de incentivos PAL (Partner Admin Link) y CPOR en suscripciones Azure de tenants."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("subtitle") ||
                            "Monitoreo de tenants que aprobaron o vincularon PAL/CPOR para seguimiento y atribución de incentivos SuperAdmin."}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {isMock && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <IconSparkles size={14} />
                            <span>Modo Demostración</span>
                        </div>
                    )}

                    {/* Botón: Configurar MPN */}
                    <button
                        type="button"
                        onClick={() => setIsMpnModalOpen(true)}
                        className="inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm"
                    >
                        <IconSettings size={14} className="text-[#0078D4]" />
                        <span>{t("btnConfigMpn") || "Configurar MPN"}</span>
                    </button>

                    {/* Botón: Actualizar Estado */}
                    <button
                        type="button"
                        onClick={loadStatus}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                        <IconRefresh size={14} className={loading ? "animate-spin text-white" : "text-white"} />
                        <span>{t("refresh") || "Actualizar Estado"}</span>
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

            {/* Banner Informativo si falta Configuración de Partner MPN ID */}
            {statusData && !statusData.partnerMpnConfigured && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 rounded-2xl text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <IconAlertTriangle size={20} className="shrink-0 text-amber-600 dark:text-amber-400" />
                        <div>
                            <span className="font-bold block">Partner MPN ID no configurado</span>
                            <span>
                                La plataforma no tiene asignado un MPN ID para asociar los vínculos Partner Admin Link (PAL).
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsMpnModalOpen(true)}
                        className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors"
                    >
                        Configurar Ahora
                    </button>
                </div>
            )}

            {/* ─── FILA DE 4 KPI CARDS DE ATRIBUCIÓN PARTNER (Tonos de azul y neutros) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: VINCULADOS (PAL OK) */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("linked") || "Vinculados (PAL OK)"}
                        </span>
                        <div className="text-2xl font-bold text-[#0078D4] mt-1 font-['Montserrat',sans-serif]">
                            {statusData?.metrics.linkedPalCount ?? 0}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Atribución confirmada
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0078D4]">
                        <IconCircleCheck size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 2: APROBADOS PENDIENTES */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("approvedPending") || "Aprobados Pendientes"}
                        </span>
                        <div className="text-2xl font-bold text-[#2563EB] mt-1 font-['Montserrat',sans-serif]">
                            {statusData?.metrics.approvedPendingCount ?? 0}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            En espera de enlace ARM
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#2563EB]">
                        <IconClock size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 3: CON ERROR DE VÍNCULO (Número en slate neutro oscuro, NUNCA naranja) */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("failed") || "Con Error de Vínculo"}
                        </span>
                        <div className="text-2xl font-bold text-[#0F172A] dark:text-slate-100 mt-1 font-['Montserrat',sans-serif]">
                            {statusData?.metrics.linkErrorCount ?? 0}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Requiere atención o MPN ID
                        </div>
                    </div>
                    <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-700 dark:text-slate-300">
                        <IconAlertCircle size={22} stroke={1.5} />
                    </div>
                </div>

                {/* Card 4: EVENTOS ÚLTIMOS 7D */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("recent7d") || "Eventos Últimos 7D"}
                        </span>
                        <div className="text-2xl font-bold text-[#0054A6] mt-1 font-['Montserrat',sans-serif]">
                            {statusData?.metrics.eventsLast7DaysCount ?? 0}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Alertas en 7 días
                        </div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-[#0054A6]">
                        <IconCalendarStats size={22} stroke={1.5} />
                    </div>
                </div>
            </div>

            {/* ─── SECCIÓN 1: Tabla "Historial de Estados PAL/CPOR por Tenant" ─────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                        <IconBuildingBank size={18} className="text-[#0078D4]" />
                        {t("tableTitle") || "Historial de estados PAL/CPOR por tenant"}
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
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-12 text-center text-slate-500">
                                        <div className="inline-flex items-center gap-2">
                                            <IconLoader2 size={18} className="animate-spin text-[#0078D4]" />
                                            <span>{t("loading") || "Cargando alertas de Partner Center..."}</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedItems.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500">
                                        {t("empty") || "No hay eventos PAL/CPOR registrados."}
                                    </td>
                                </tr>
                            ) : (
                                paginatedItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {/* Tenant Info */}
                                        {columns.find((c) => c.id === "tenant")?.visible && (
                                            <td className="px-3 py-3">
                                                <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                                    <span>{item.organizationName}</span>
                                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-[#0078D4] border border-blue-200 dark:bg-blue-950/40 dark:border-blue-800">
                                                        {item.planTier}
                                                    </span>
                                                </div>
                                                <div className="font-mono text-[10px] text-slate-400 mt-0.5 truncate max-w-[220px]" title={item.entraTenantGuid}>
                                                    {item.entraTenantGuid}
                                                </div>
                                            </td>
                                        )}

                                        {/* Estado Badge */}
                                        {columns.find((c) => c.id === "status")?.visible && (
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${
                                                        item.status === "LINKED"
                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                                            : item.status === "APPROVED_PENDING"
                                                            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                                            : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800"
                                                    }`}
                                                >
                                                    {item.status === "LINKED" && <IconCircleCheck size={12} />}
                                                    {item.status === "APPROVED_PENDING" && <IconClock size={12} />}
                                                    {item.status === "LINK_ERROR" && <IconX size={12} />}
                                                    <span>{item.formattedStatus}</span>
                                                </span>
                                            </td>
                                        )}

                                        {/* Fecha */}
                                        {columns.find((c) => c.id === "approvedAt")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                                {item.formattedDate}
                                            </td>
                                        )}

                                        {/* Aprobado Por */}
                                        {columns.find((c) => c.id === "approvedBy")?.visible && (
                                            <td className="px-3 py-3 text-[11px] text-slate-700 dark:text-slate-300">
                                                <span className="truncate max-w-[190px] block" title={item.approvedByEmail}>
                                                    {item.approvedByEmail}
                                                </span>
                                            </td>
                                        )}

                                        {/* Detalle */}
                                        {columns.find((c) => c.id === "detail")?.visible && (
                                            <td className="px-3 py-3 text-[11px] text-slate-600 dark:text-slate-400">
                                                <span className="line-clamp-2" title={item.errorDetailsText || "Sin observaciones"}>
                                                    {item.errorDetailsText || "Asociación normal"}
                                                </span>
                                            </td>
                                        )}

                                        {/* Acciones */}
                                        {columns.find((c) => c.id === "actions")?.visible && (
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRelink(item.tenantId)}
                                                        disabled={relinkingTenantId === item.tenantId}
                                                        className="inline-flex items-center gap-1 text-[#0078D4] hover:text-[#0054A6] dark:text-blue-400 font-semibold hover:underline disabled:opacity-50"
                                                        title="Forzar re-intento de vinculación Partner Admin Link"
                                                    >
                                                        {relinkingTenantId === item.tenantId ? (
                                                            <IconLoader2 size={13} className="animate-spin text-[#0078D4]" />
                                                        ) : (
                                                            <IconRefresh size={13} className="text-[#0078D4]" />
                                                        )}
                                                        <span>{t("btnRelink") || "Re-vincular"}</span>
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
                        <span>de {totalItems} eventos totales</span>
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
                            Página {currentPage} de {totalPages}
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

            {/* ─── MODAL: Configurar Microsoft Partner MPN ID (z-[100]) ──────────────── */}
            {isMpnModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
                        <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                    {t("modalMpnTitle") || "Configurar Microsoft Partner MPN ID"}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {t("modalMpnSubtitle") ||
                                        "Identificador de Partner de Microsoft para atribución de consumo y programas de incentivos."}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMpnModalOpen(false)}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveMpn} className="space-y-4">
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {t("partnerMpnIdLabel") || "Partner MPN ID / Location ID"}
                                </label>
                                <input
                                    type="text"
                                    value={partnerMpnInput}
                                    onChange={(e) => setPartnerMpnInput(e.target.value)}
                                    placeholder="Ej: 6543210"
                                    required
                                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                    {t("partnerMpnHelpText") ||
                                        "Este ID se asocia vía Partner Admin Link (PAL) en Azure Resource Manager para atribuir el consumo gestionado a tu organización partner."}
                                </p>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsMpnModalOpen(false)}
                                    className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    {t("close") || "Cerrar"}
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingMpn || !partnerMpnInput.trim()}
                                    className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                                >
                                    {savingMpn ? (
                                        <IconLoader2 size={14} className="animate-spin text-white" />
                                    ) : (
                                        <IconCheck size={14} className="text-white" />
                                    )}
                                    <span>{t("btnSaveMpn") || "Guardar Configuración"}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export { PartnerCenterAlertsPanel };
