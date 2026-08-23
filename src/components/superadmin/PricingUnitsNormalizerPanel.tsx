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
    PricingUnitCatalogItem,
    TestNormalizationResponse,
    UomCategory,
} from "@/types/pricingUnitsNormalizer.types";
import {
    IconScale,
    IconDatabaseImport,
    IconPlayerPlay,
    IconColumns,
    IconLoader2,
    IconCheck,
    IconSparkles,
    IconX,
    IconEdit,
    IconSearch,
    IconChevronLeft,
    IconChevronRight,
    IconArrowsExchange,
} from "@tabler/icons-react";

interface ColumnConfig {
    id: string;
    label: string;
    visible: boolean;
    width: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
    { id: "rawUom", label: "UoM Crudo", visible: true, width: 220 },
    { id: "blockSize", label: "Block Size", visible: true, width: 140 },
    { id: "baseUnit", label: "Base Unit", visible: true, width: 140 },
    { id: "display", label: "Display", visible: true, width: 160 },
    { id: "category", label: "Categoría", visible: true, width: 130 },
    { id: "actions", label: "Acciones", visible: true, width: 110 },
];

export default function PricingUnitsNormalizerPanel() {
    const t = useTranslations("AdminPricingUnits");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const tenantId = selectedTenant?.id || "default";
    const isMock = isMockTenant(tenantId);

    const [items, setItems] = useState<PricingUnitCatalogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Sandbox de Prueba
    const [testUom, setTestUom] = useState("100 Hours");
    const [testQty, setTestQty] = useState("7.3");
    const [testResult, setTestResult] = useState<TestNormalizationResponse | null>({
        success: true,
        originalUom: "100 Hours",
        originalQuantity: 7.3,
        normalizedQuantity: 730,
        baseUnit: "Hour",
        displayUnit: "Hours",
        formattedResult: "730.00 Hours (Base: Hour · Multiplicador: 100.00)",
        category: "COMPUTE",
        inferred: false,
    });
    const [runningTest, setRunningTest] = useState(false);

    // Reseed
    const [reseeding, setReseeding] = useState(false);

    // Búsqueda y Paginación
    const [searchQuery, setSearchQuery] = useState("");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Modal Editar Regla
    const [editingItem, setEditingItem] = useState<PricingUnitCatalogItem | null>(null);
    const [editBlockSize, setEditBlockSize] = useState<number>(1);
    const [editDisplayUnit, setEditDisplayUnit] = useState("");

    // Columnas y Redimensionamiento
    const storageKey = `table_columns_config_pricing_units_${tenantId}`;
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

    // Cargar Catálogo
    const loadCatalog = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const url = isMock
                ? "/api/superadmin/pricing-units?mock=true"
                : "/api/superadmin/pricing-units";

            const res = await fetch(url, { headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("errorGeneric"));
            }

            setItems(json.items || []);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [isMock, getAuthHeaders, t]);

    useEffect(() => {
        loadCatalog();
    }, [loadCatalog]);

    // Ejecutar Prueba de Normalización
    const handleRunTest = async (e: React.FormEvent) => {
        e.preventDefault();
        setRunningTest(true);
        setError(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/pricing-units/test?mock=true"
                : "/api/superadmin/pricing-units/test";

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    unitOfMeasure: testUom.trim(),
                    quantity: parseFloat(testQty) || 1,
                }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al ejecutar la normalización");
            }

            setTestResult(json);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setRunningTest(false);
        }
    };

    // Reseed Catálogo
    const handleReseed = async () => {
        setReseeding(true);
        setError(null);
        setSuccessMessage(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await getAuthHeaders()) };
            const url = isMock
                ? "/api/superadmin/pricing-units/reseed?mock=true"
                : "/api/superadmin/pricing-units/reseed";

            const res = await fetch(url, { method: "POST", headers });
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || t("errorReseed"));
            }

            await loadCatalog();
            setSuccessMessage(t("reseedResult", { inserted: json.inserted || 45 }) || `Reseed completado (${json.inserted || 45} unidades actualizadas).`);
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (e: any) {
            setError(errorMessage(e));
        } finally {
            setReseeding(false);
        }
    };

    // Guardar edición local de regla
    const handleSaveEditRule = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingItem) return;

        setItems((prev) =>
            prev.map((i) =>
                i.id === editingItem.id
                    ? {
                          ...i,
                          blockSizeMultiplier: editBlockSize,
                          displayUnitName: editDisplayUnit.trim() || i.displayUnitName,
                      }
                    : i
            )
        );

        setEditingItem(null);
        setSuccessMessage(`Regla para '${editingItem.rawUomName}' actualizada.`);
        setTimeout(() => setSuccessMessage(null), 3000);
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

    // Filtrado y paginación
    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return items;
        const q = searchQuery.toLowerCase().trim();
        return items.filter(
            (i) =>
                i.rawUomName.toLowerCase().includes(q) ||
                i.baseUnitKey.toLowerCase().includes(q) ||
                i.displayUnitName.toLowerCase().includes(q) ||
                i.category.toLowerCase().includes(q)
        );
    }, [items, searchQuery]);

    const totalItems = filteredItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const paginatedItems = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredItems.slice(start, start + pageSize);
    }, [filteredItems, currentPage, pageSize]);

    return (
        <div className="w-full max-w-full space-y-6 animate-in fade-in duration-200">
            {/* Header y Acciones Globales */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center font-['Montserrat',sans-serif]">
                        <IconScale size={26} stroke={1.5} className="text-[#0078D4] inline mr-2.5" />
                        {t("title") || "Normalizador de Unidades de Precio"}
                        <InfoTooltip
                            content={
                                t("tooltipTitle") ||
                                "Tabla curada de Units of Measure de Azure Billing para normalizar agregados (Hours, GB, Transactions, Tokens, etc.) bajo la especificación FOCUS 1.1."
                            }
                        />
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-4xl leading-relaxed">
                        {t("subtitle") ||
                            "Tabla curada de Units of Measure de Azure Billing para normalizar agregados (Hours, GB, Transactions, Tokens, etc.) bajo la especificación FOCUS 1.1."}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {isMock && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <IconSparkles size={14} />
                            <span>Modo Demostración</span>
                        </div>
                    )}

                    {/* Botón: Reseed Catálogo */}
                    <button
                        type="button"
                        onClick={handleReseed}
                        disabled={reseeding}
                        className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                        <IconDatabaseImport size={15} className={reseeding ? "animate-spin" : ""} />
                        <span>{t("reseed") || "Reseed Catálogo"}</span>
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

            {/* ─── SECCIÓN 1: Tarjeta "Probar normalización en vivo" (Ancho 100%) ──────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                        <IconPlayerPlay size={18} stroke={1.5} className="text-[#0078D4]" />
                        {t("testBoxTitle") || "Probar normalización en vivo"}
                    </h2>
                    <span className="text-[11px] text-slate-500 font-mono">FOCUS 1.1 Engine</span>
                </div>

                <form onSubmit={handleRunTest} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-6 space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {t("unitOfMeasure") || "Unit of Measure"}
                        </label>
                        <input
                            type="text"
                            value={testUom}
                            onChange={(e) => setTestUom(e.target.value)}
                            placeholder={t("testUomPlaceholder") || "Ej: 100 Hours o 1M Tokens"}
                            required
                            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        />
                    </div>

                    <div className="sm:col-span-3 space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {t("quantity") || "Cantidad"}
                        </label>
                        <input
                            type="number"
                            step="any"
                            value={testQty}
                            onChange={(e) => setTestQty(e.target.value)}
                            placeholder={t("testQtyPlaceholder") || "Ej: 7.3"}
                            required
                            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                        />
                    </div>

                    <div className="sm:col-span-3">
                        <button
                            type="submit"
                            disabled={runningTest || !testUom.trim()}
                            className="w-full inline-flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                        >
                            {runningTest ? (
                                <IconLoader2 size={14} className="animate-spin text-white" />
                            ) : (
                                <IconPlayerPlay size={14} stroke={1.5} className="text-white" />
                            )}
                            <span>{t("test") || "Probar"}</span>
                        </button>
                    </div>
                </form>

                {/* Caja de Resultado Dinámico */}
                {testResult && (
                    <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3.5 rounded-xl text-xs text-[#0078D4] dark:text-blue-300 font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-2 animate-in fade-in">
                        <div className="flex items-center gap-2">
                            <IconArrowsExchange size={16} className="shrink-0 text-[#0078D4]" />
                            <span>
                                <strong>Resultado FOCUS 1.1:</strong> {testResult.formattedResult}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-normal text-slate-600 dark:text-slate-400">
                            <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 text-[#0078D4]">
                                Categoría: {testResult.category}
                            </span>
                            {testResult.inferred && (
                                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                                    Inferido
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ─── SECCIÓN 2: Tabla "Catálogo (45 UoMs)" (Estándar CMP) ────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <h2 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif] flex items-center gap-2">
                        <IconScale size={18} className="text-[#0078D4]" />
                        {t("catalog", { count: items.length }) || `Catálogo (${items.length} UoMs)`}
                    </h2>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Buscador de Texto en Tiempo Real */}
                        <div className="relative">
                            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder={t("filterPlaceholder") || "Buscar por UoM, base unit o categoría..."}
                                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0078D4] w-56 sm:w-64"
                            />
                        </div>

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
                                            <span>{t("loading") || "Cargando catálogo..."}</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : paginatedItems.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.filter((c) => c.visible).length} className="px-4 py-8 text-center text-slate-500">
                                        {t("noResults") || "Sin resultados para la búsqueda actual."}
                                    </td>
                                </tr>
                            ) : (
                                paginatedItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        {/* UoM Crudo */}
                                        {columns.find((c) => c.id === "rawUom")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                                                {item.rawUomName}
                                            </td>
                                        )}

                                        {/* Block Size */}
                                        {columns.find((c) => c.id === "blockSize")?.visible && (
                                            <td className="px-3 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                                {item.blockSizeMultiplier}
                                            </td>
                                        )}

                                        {/* Base Unit */}
                                        {columns.find((c) => c.id === "baseUnit")?.visible && (
                                            <td className="px-3 py-3 text-slate-800 dark:text-slate-200">
                                                {item.baseUnitKey}
                                            </td>
                                        )}

                                        {/* Display */}
                                        {columns.find((c) => c.id === "display")?.visible && (
                                            <td className="px-3 py-3 text-slate-600 dark:text-slate-400">
                                                {item.displayUnitName}
                                            </td>
                                        )}

                                        {/* Categoría Badge */}
                                        {columns.find((c) => c.id === "category")?.visible && (
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <span
                                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                                        item.category === "AI"
                                                            ? "bg-blue-50 text-[#0078D4] border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
                                                            : item.category === "COMPUTE"
                                                            ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-200"
                                                            : item.category === "STORAGE"
                                                            ? "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300"
                                                            : item.category === "NETWORK"
                                                            ? "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800"
                                                            : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400"
                                                    }`}
                                                >
                                                    {item.category}
                                                </span>
                                            </td>
                                        )}

                                        {/* Acciones */}
                                        {columns.find((c) => c.id === "actions")?.visible && (
                                            <td className="px-3 py-3 whitespace-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingItem(item);
                                                        setEditBlockSize(item.blockSizeMultiplier);
                                                        setEditDisplayUnit(item.displayUnitName);
                                                    }}
                                                    className="inline-flex items-center gap-1 text-slate-500 hover:text-[#0078D4] dark:hover:text-blue-400 text-xs font-semibold transition-colors"
                                                    title="Editar regla de normalización"
                                                >
                                                    <IconEdit size={14} className="text-[#0078D4]" />
                                                    <span>{t("btnEditRule") || "Editar regla"}</span>
                                                </button>
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
                        <span>de {totalItems} UoMs totales</span>
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

            {/* ─── MODAL: Editar Regla de Normalización FOCUS 1.1 (z-[100]) ────────────── */}
            {editingItem && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl">
                        <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat',sans-serif]">
                                    {t("modalEditTitle") || "Editar Regla de Normalización FOCUS 1.1"}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {editingItem.rawUomName} ({editingItem.category})
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditingItem(null)}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveEditRule} className="space-y-4">
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Multiplicador Block Size
                                </label>
                                <input
                                    type="number"
                                    step="any"
                                    value={editBlockSize}
                                    onChange={(e) => setEditBlockSize(parseFloat(e.target.value) || 1)}
                                    required
                                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Nombre de Unidad para Visualización (Display Unit)
                                </label>
                                <input
                                    type="text"
                                    value={editDisplayUnit}
                                    onChange={(e) => setEditDisplayUnit(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setEditingItem(null)}
                                    className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    {t("close") || "Cerrar"}
                                </button>
                                <button
                                    type="submit"
                                    className="inline-flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#0060AA] text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm"
                                >
                                    <IconCheck size={14} className="text-white" />
                                    <span>Guardar Regla</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export { PricingUnitsNormalizerPanel };
