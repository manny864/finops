"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
    IconChartBar,
    IconDownload,
    IconX,
    IconCalendar,
    IconTrendingUp,
    IconTrendingDown,
    IconCurrencyDollar,
    IconChevronLeft,
    IconChevronRight,
    IconRefresh,
    IconAlertCircle,
    IconDatabase,
} from "@tabler/icons-react";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { MonthlyStorageHistoryItem } from "@/app/api/intelligence/storage-efficiency/history/route";
import InfoTooltip from "@/components/InfoTooltip";

function formatStorageSize(gb: number | null | undefined): string {
    if (gb === null || gb === undefined || gb <= 0.00001) return "0 MB";
    if (gb >= 1000) return `${(gb / 1024).toFixed(2)} TB`;
    if (gb < 1) {
        const mb = gb * 1024;
        return mb < 1 ? "< 1 MB" : `${Math.round(mb)} MB`;
    }
    return `${gb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

interface StorageHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenantId: string;
}

export default function StorageHistoryModal({ isOpen, onClose, tenantId }: StorageHistoryModalProps) {
    const t = useTranslations("StorageEfficiency");
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const [timeRangeMonths, setTimeRangeMonths] = useState<number | "custom">(13);
    const [customStartDate, setCustomStartDate] = useState<string>("");
    const [customEndDate, setCustomEndDate] = useState<string>("");
    const [tablePage, setTablePage] = useState<number>(1);
    const tablePageSize = 5;

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]).catch(() => "");
        const res = await fetch(url, {
            headers: {
                ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                "x-tenant-id": tenantId,
            },
        });
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.details || json.error || "Error al cargar histórico");
        }
        return res.json();
    };

    const swrUrl = useMemo(() => {
        if (!isOpen || !tenantId) return null;
        let url = `/api/intelligence/storage-efficiency/history?tenantId=${tenantId}`;
        if (timeRangeMonths === "custom" && customStartDate && customEndDate) {
            url += `&startDate=${customStartDate}&endDate=${customEndDate}`;
        }
        return url;
    }, [isOpen, tenantId, timeRangeMonths, customStartDate, customEndDate]);

    const { data, error, isLoading } = useSWR<{
        success: boolean;
        history: MonthlyStorageHistoryItem[];
    }>(swrUrl, fetcher, {
        revalidateOnMount: true,
        revalidateOnFocus: true,
        dedupingInterval: 1000,
    });

    const rawHistory = data?.history || [];

    // Filter history based on selected month range
    const filteredHistory = useMemo(() => {
        if (!rawHistory.length) return [];
        if (timeRangeMonths === "custom") return rawHistory;
        return rawHistory.slice(-timeRangeMonths);
    }, [rawHistory, timeRangeMonths]);

    // Paginated history for table view
    const totalTablePages = Math.max(1, Math.ceil(filteredHistory.length / tablePageSize));
    const paginatedTableHistory = useMemo(() => {
        const reversed = [...filteredHistory].reverse();
        const start = (tablePage - 1) * tablePageSize;
        return reversed.slice(start, start + tablePageSize);
    }, [filteredHistory, tablePage, tablePageSize]);

    // Summary statistics
    const stats = useMemo(() => {
        if (!filteredHistory.length) {
            return { totalCost: 0, avgCost: 0, peakMonth: "-", peakCost: 0, latestMoM: 0 };
        }

        const totalCost = filteredHistory.reduce((s, h) => s + h.totalCost, 0);
        const avgCost = totalCost / filteredHistory.length;

        let peakMonth = filteredHistory[0].month;
        let peakCost = filteredHistory[0].totalCost;

        for (const h of filteredHistory) {
            if (h.totalCost > peakCost) {
                peakCost = h.totalCost;
                peakMonth = h.month;
            }
        }

        const latestMoM = filteredHistory[filteredHistory.length - 1]?.momChangePercent || 0;

        return {
            totalCost,
            avgCost,
            peakMonth,
            peakCost,
            latestMoM,
        };
    }, [filteredHistory]);

    // Max cost for visual scaling of bars
    const maxCost = useMemo(() => {
        const max = Math.max(...filteredHistory.map((h) => h.totalCost), 0.0001);
        return max;
    }, [filteredHistory]);

    // Export history to CSV
    const exportCSV = () => {
        if (!filteredHistory.length) return;
        const headers = ["Mes", "Almacenamiento (GB)", "Costo Mensual (USD)", "Costo por GB", "Variacion MoM %"];
        const rows = filteredHistory.map((h) => [
            h.month,
            h.totalGb.toFixed(4),
            h.totalCost.toFixed(4),
            h.costPerGb.toFixed(5),
            `${h.momChangePercent}%`,
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `historico_storage_${tenantId}_${timeRangeMonths}m.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#0054A6]">
                            <IconChartBar className="w-5 h-5" stroke={1.5} />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                                Histórico de Almacenamiento
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100/80 text-[#0054A6] dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                    Hasta 13 Meses
                                </span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Evolución mensual de costo y capacidad ocupada en Storage Accounts
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={exportCSV}
                            disabled={!filteredHistory.length}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0054A6] bg-white dark:bg-slate-800 border border-[#0054A6] rounded-lg hover:bg-blue-50/50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                        >
                            <IconDownload className="w-3.5 h-3.5" stroke={1.5} />
                            Exportar CSV
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <IconX className="w-5 h-5" stroke={1.5} />
                        </button>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">

                    {/* Time Range Filter Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-center gap-2 px-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                            <IconCalendar className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                            <span>Período de consulta:</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {[
                                { label: "3 Meses", value: 3 },
                                { label: "6 Meses", value: 6 },
                                { label: "12 Meses", value: 12 },
                                { label: "13 Meses", value: 13 },
                                { label: "Personalizado", value: "custom" },
                            ].map((r) => (
                                <button
                                    key={String(r.value)}
                                    onClick={() => setTimeRangeMonths(r.value as any)}
                                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                                        timeRangeMonths === r.value
                                            ? "bg-[#0054A6] text-white shadow-sm"
                                            : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700"
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>

                        {timeRangeMonths === "custom" && (
                            <div className="w-full flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
                                <span className="text-slate-500 dark:text-slate-400">Desde:</span>
                                <input
                                    type="date"
                                    value={customStartDate}
                                    onChange={(e) => setCustomStartDate(e.target.value)}
                                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs focus:ring-2 focus:ring-[#0054A6] focus:outline-none"
                                />
                                <span className="text-slate-500 dark:text-slate-400">Hasta:</span>
                                <input
                                    type="date"
                                    value={customEndDate}
                                    onChange={(e) => setCustomEndDate(e.target.value)}
                                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs focus:ring-2 focus:ring-[#0054A6] focus:outline-none"
                                />
                            </div>
                        )}
                    </div>

                    {isLoading ? (
                        <div className="py-16 flex flex-col items-center justify-center text-slate-400">
                            <IconRefresh className="w-8 h-8 animate-spin mb-2 text-[#0054A6]" stroke={1.5} />
                            <p className="text-sm">Cargando histórico de almacenamiento...</p>
                        </div>
                    ) : error ? (
                        <div className="py-12 flex flex-col items-center justify-center text-red-500">
                            <IconAlertCircle className="w-8 h-8 mb-2" stroke={1.5} />
                            <p className="text-sm font-medium">Error al cargar datos históricos</p>
                        </div>
                    ) : (
                        <>
                            {/* Summary KPI Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Gasto Acumulado ({timeRangeMonths}M)</p>
                                    <p className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {format(stats.totalCost)}
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Promedio Mensual</p>
                                    <p className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {format(stats.avgCost)}
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Pico de Gasto ({stats.peakMonth})</p>
                                    <p className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {format(stats.peakCost)}
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Variación Último Mes (MoM)</p>
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                            {stats.latestMoM > 0 ? `+${stats.latestMoM}%` : `${stats.latestMoM}%`}
                                        </p>
                                        {stats.latestMoM > 0 ? (
                                            <IconTrendingUp className="w-4 h-4 text-blue-600" stroke={2} />
                                        ) : stats.latestMoM < 0 ? (
                                            <IconTrendingDown className="w-4 h-4 text-emerald-500" stroke={2} />
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            {/* Monthly Interactive Visual Chart */}
                            <div className="p-5 rounded-2xl bg-slate-900 text-white shadow-inner">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 font-['Montserrat']">
                                        <IconCurrencyDollar className="w-4 h-4 text-emerald-400" stroke={1.5} />
                                        Tendencia Mensual de Costos y Almacenamiento
                                    </h3>
                                    <div className="flex items-center gap-4 text-xs text-slate-400">
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Costo ($)
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded bg-emerald-400 inline-block" /> Ocupación
                                        </span>
                                    </div>
                                </div>

                                <div className="h-52 flex items-end justify-between gap-1.5 pt-8 pb-2 px-2 border-b border-slate-800 relative">
                                    {filteredHistory.map((h) => {
                                        const maxGb = Math.max(...filteredHistory.map((item) => item.totalGb), 0.0001);
                                        const costHeightPct = maxCost > 0 ? (h.totalCost / maxCost) * 100 : 0;
                                        const gbHeightPct = maxGb > 0 ? (h.totalGb / maxGb) * 100 : 0;

                                        const costHeight = h.totalCost > 0 ? `${Math.max(12, costHeightPct)}%` : "6px";
                                        const gbHeight = h.totalGb > 0 ? `${Math.max(12, gbHeightPct)}%` : "6px";

                                        return (
                                            <div key={h.month} className="flex-1 h-full flex flex-col justify-end items-center group relative">
                                                {/* Tooltip */}
                                                <div className="absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] py-1.5 px-2.5 rounded-lg shadow-xl pointer-events-none z-30 whitespace-nowrap border border-slate-700">
                                                    <div className="font-bold border-b border-slate-700 pb-1 mb-1">{h.month}</div>
                                                    <div>Costo: <span className="font-semibold text-blue-400">{format(h.totalCost)}</span></div>
                                                    <div>Capacidad: <span className="font-semibold text-emerald-400">{formatStorageSize(h.totalGb)}</span></div>
                                                </div>

                                                <div className="w-full flex items-end justify-center gap-1 h-full">
                                                    <div 
                                                        className="w-1/2 max-w-[16px] bg-blue-500 hover:bg-blue-400 rounded-t-sm transition-all shadow-sm"
                                                        style={{ height: costHeight }}
                                                        title={`Costo: ${format(h.totalCost)}`}
                                                    />
                                                    <div 
                                                        className="w-1/2 max-w-[16px] bg-emerald-400 hover:bg-emerald-300 rounded-t-sm transition-all shadow-sm"
                                                        style={{ height: gbHeight }}
                                                        title={`Capacidad: ${formatStorageSize(h.totalGb)}`}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="flex justify-between gap-2 text-[10px] text-slate-400 pt-2 px-2">
                                    {filteredHistory.map((h) => (
                                        <span key={h.month} className="flex-1 text-center truncate font-mono">
                                            {h.month.substring(2)}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Monthly Breakdown Table */}
                            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                    <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider font-['Montserrat'] flex items-center gap-2">
                                        <IconDatabase className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                                        Desglose Mes a Mes ({filteredHistory.length} Meses)
                                    </h4>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-50/80 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                                            <tr>
                                                <th className="py-2.5 px-4">Mes</th>
                                                <th className="py-2.5 px-4">Almacenamiento Ocupado</th>
                                                <th className="py-2.5 px-4 text-right">Costo Mensual</th>
                                                <th className="py-2.5 px-4 text-right">Costo / GB</th>
                                                <th className="py-2.5 px-4 text-right">Variación MoM</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {paginatedTableHistory.map((h) => (
                                                <tr key={h.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                        {h.month}
                                                    </td>
                                                    <td className="py-2.5 px-4 font-semibold text-[#1B2A41] dark:text-slate-100">
                                                        {formatStorageSize(h.totalGb)}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-right font-bold text-[#1B2A41] dark:text-slate-100">
                                                        {format(h.totalCost)}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-right text-slate-500 font-mono">
                                                        {h.totalGb > 0.005 ? format(h.costPerGb, { fractionDigits: 5 }) : "-"}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-right font-semibold">
                                                        <span className={`inline-flex items-center gap-1 ${
                                                            h.momChangePercent > 0 
                                                                ? "text-blue-600 dark:text-blue-400" 
                                                                : h.momChangePercent < 0 
                                                                ? "text-emerald-500 dark:text-emerald-400" 
                                                                : "text-slate-400"
                                                        }`}>
                                                            {h.momChangePercent > 0 ? `+${h.momChangePercent}%` : `${h.momChangePercent}%`}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Table Pagination Footer */}
                                <div className="px-4 py-2.5 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                                    <span>Página {tablePage} de {totalTablePages} ({filteredHistory.length} meses)</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                                            disabled={tablePage === 1}
                                            className="p-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                                        >
                                            <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                                        </button>
                                        <button
                                            onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
                                            disabled={tablePage >= totalTablePages}
                                            className="p-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                                        >
                                            <IconChevronRight className="w-4 h-4" stroke={1.5} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                </div>

                {/* Modal Footer */}
                <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        Cerrar
                    </button>
                </div>

            </div>
        </div>
    );
}
