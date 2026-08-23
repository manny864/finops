"use client";
import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import {
    IconPigMoney,
    IconTrash,
    IconHistory,
    IconTrendingUp,
    IconTrendingDown,
    IconRefresh,
    IconSearch,
    IconSparkles,
    IconAlertCircle,
    IconLoader2,
    IconArrowsSort,
    IconSortAscending,
    IconSortDescending,
    IconX,
    IconListCheck,
    IconShieldCheck,
} from "@tabler/icons-react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    Legend,
} from "recharts";
import type {
    CapturedSavingsApiResponse,
    CapturedSavingsSummary,
    RemediationAuditItem,
} from "@/types/capturedSavings.types";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n || 0);

function formatCurrencyAxis(value: number, maxDatasetValue: number): string {
    if (maxDatasetValue < 1000) {
        return `$${Math.round(value)}`;
    }
    return `$${(value / 1000).toFixed(1)}k`;
}

export default function CapturedSavingsBoard() {
    const t = useProviderTranslations("OverviewCapturedSavings");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const account = accounts[0];

    // Table state
    const [searchTerm, setSearchTerm] = useState("");
    const [sortField, setSortField] = useState<keyof RemediationAuditItem>("timestamp");
    const [sortAsc, setSortAsc] = useState(false);
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Modal drawer for remediation audit details
    const [selectedAudit, setSelectedAudit] = useState<RemediationAuditItem | null>(null);

    const isMock = selectedTenant?.id ? isMockTenant(selectedTenant.id) : false;
    const shouldFetch =
        selectedTenant &&
        selectedTenant.id !== "default" &&
        (accounts.length > 0 || isMock);

    const fetcher = async (url: string): Promise<CapturedSavingsApiResponse> => {
        const headers: Record<string, string> = {
            "x-tenant-id": selectedTenant?.id ?? "",
        };

        if (!isMock && account) {
            try {
                const token = await getFreshIdToken(instance, account, ["User.Read"]);
                headers["Authorization"] = `Bearer ${token}`;
            } catch (err) {
                console.warn("[CapturedSavings] Failed to get MSAL token:", err);
            }
        }

        const res = await fetch(url, { headers });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error || t("errorLoading"));
        }
        return res.json();
    };

    const { data: response, error, isLoading, mutate } = useSWR<CapturedSavingsApiResponse>(
        shouldFetch ? `/api/intelligence/captured-savings?tenantId=${selectedTenant?.id}` : null,
        fetcher,
        { revalidateOnFocus: false, revalidateOnReconnect: false }
    );

    const summary: CapturedSavingsSummary | null = useMemo(() => {
        if (!response) return null;
        if (response.data) return response.data;

        // Fallback for legacy format
        const hist = response.history || [];
        const latest = response.current;
        return {
            currentPotentialSavingsUSD: latest?.potentialSavings ?? 0,
            currentDetectedWasteUSD: latest?.totalWasted ?? 0,
            totalHistoricalSnapshots: hist.length,
            changePercentageVsLast: response.changePct ?? 0,
            lastScanDate: latest?.date,
            trend: hist.map((h) => ({
                date: h.date,
                detectedWasteUSD: h.totalWasted,
                potentialSavingsUSD: h.potentialSavings,
                // Sin dato de ahorro realizado va 0: antes se derivaba como el 60%
                // del desperdicio, un porcentaje inventado (de ahi $18 sobre $30).
                realizedSavingsUSD: h.realizedSavings ?? 0,
            })),
            auditLog: (response.topResources || []).map((r, idx) => ({
                id: `legacy-${idx}`,
                timestamp: new Date().toISOString(),
                executedBy: "Sistema Automático",
                resourceName: r.resourceId,
                resourceType: "Microsoft.Resources/resource",
                actionCategory: r.category,
                monthlySavingsUSD: r.estimatedSavings,
                status: "SUCCESS" as const,
                details: `Optimización aplicada sobre ${r.resourceId}`,
            })),
        };
    }, [response]);

    // Max value for adaptive YAxis
    const maxChartValue = useMemo(() => {
        if (!summary?.trend || summary.trend.length === 0) return 1000;
        return Math.max(
            ...summary.trend.map((d) =>
                Math.max(d.detectedWasteUSD, d.potentialSavingsUSD, d.realizedSavingsUSD)
            ),
            100
        );
    }, [summary?.trend]);

    // Filter & sort audit logs
    const filteredAuditLogs = useMemo(() => {
        if (!summary?.auditLog) return [];
        let list = [...summary.auditLog];

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            list = list.filter(
                (item) =>
                    item.resourceName.toLowerCase().includes(q) ||
                    item.executedBy.toLowerCase().includes(q) ||
                    item.actionCategory.toLowerCase().includes(q)
            );
        }

        list.sort((a, b) => {
            const valA = a[sortField];
            const valB = b[sortField];
            if (typeof valA === "string" && typeof valB === "string") {
                return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
        });

        return list;
    }, [summary?.auditLog, searchTerm, sortField, sortAsc]);

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filteredAuditLogs.length / pageSize));
    const paginatedAuditLogs = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredAuditLogs.slice(start, start + pageSize);
    }, [filteredAuditLogs, currentPage, pageSize]);

    const handleSort = (field: keyof RemediationAuditItem) => {
        if (sortField === field) {
            setSortAsc(!sortAsc);
        } else {
            setSortField(field);
            setSortAsc(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="space-y-6">
            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                        <IconPigMoney className="w-7 h-7" stroke={1.5} />
                    </span>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-white font-heading">
                                {t("title")}
                            </h1>
                            <InfoTooltip content={t("subtitle")} />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("subtitle")}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => mutate()}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6] rounded-xl hover:bg-blue-50/50 dark:hover:bg-slate-800 shadow-sm transition-all disabled:opacity-50"
                    >
                        <IconRefresh
                            className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
                            stroke={1.5}
                        />
                        <span>{t("refresh")}</span>
                    </button>
                </div>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="flex items-center gap-2.5 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm text-slate-600 dark:text-slate-400 text-xs">
                    <IconLoader2 className="w-4 h-4 animate-spin text-[#0078D4]" stroke={1.5} />
                    <span>{t("loadingHistory")}</span>
                </div>
            )}

            {/* Error */}
            {error &&
                (parseTierRequiredError(error.message) ? (
                    <TierLockedNotice
                        requiredTier={parseTierRequiredError(error.message)!}
                        currentTier={(selectedTenant as any)?.tier}
                        featureName={t("featureName")}
                    />
                ) : (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-5 rounded-2xl border border-red-200 dark:border-red-900/50">
                        <div className="flex items-center gap-2 font-bold mb-1">
                            <IconAlertCircle className="w-5 h-5" stroke={1.5} />
                            <span>{t("error")}</span>
                        </div>
                        <p className="text-sm">{error.message}</p>
                    </div>
                ))}

            {/* 3 Top Primary KPI Cards */}
            {summary && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {/* Card 1: Ahorro Potencial Actual */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-all">
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                                        {t("currentPotentialSavings")}
                                    </span>
                                    <InfoTooltip content="Ahorro mensual proyectado eliminando desperdicios y aplicando optimizaciones activas." />
                                </div>
                                <h3 className="text-2xl font-bold font-heading text-[#0054A6] dark:text-blue-400">
                                    {fmtUsd(summary.currentPotentialSavingsUSD)}
                                </h3>
                            </div>
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconPigMoney className="w-6 h-6" stroke={1.5} />
                            </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                            {summary.changePercentageVsLast >= 0 ? (
                                <IconTrendingUp className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                            ) : (
                                <IconTrendingDown className="w-3.5 h-3.5 text-blue-400" stroke={1.5} />
                            )}
                            <span>{t("vsLastRecord", { pct: Math.abs(summary.changePercentageVsLast) })}</span>
                        </div>
                    </div>

                    {/* Card 2: Desperdicio Detectado Actual */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-all">
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                                        {t("currentWastedDetected")}
                                    </span>
                                    <InfoTooltip content="Gasto total mensual identificado en recursos ociosos, sobredimensionados o huérfanos." />
                                </div>
                                <h3 className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
                                    {fmtUsd(summary.currentDetectedWasteUSD)}
                                </h3>
                            </div>
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconTrash className="w-6 h-6" stroke={1.5} />
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                            {t("lastScan", { date: summary.lastScanDate || "—" })}
                            {summary.latestScanEmpty && (
                                <span
                                    className="block text-[11px] text-amber-600 dark:text-amber-400 mt-0.5"
                                    title="El escaneo más reciente no devolvió datos de costo; las cifras corresponden al último escaneo con datos."
                                >
                                    Último escaneo sin datos — se muestra el anterior
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Card 3: Registros Históricos */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-all">
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                                        {t("historicalRecords")}
                                    </span>
                                    <InfoTooltip content="Cantidad total de snapshots históricos archivados en la base de datos de telemetría FinOps." />
                                </div>
                                <h3 className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
                                    {summary.totalHistoricalSnapshots}
                                </h3>
                            </div>
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconHistory className="w-6 h-6" stroke={1.5} />
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                            {t("last12Months")}
                        </p>
                    </div>
                </div>
            )}

            {/* Central Chart: Tendencia de Ahorro Capturado vs Desperdicio */}
            {summary && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconPigMoney className="w-5 h-5" stroke={1.5} />
                            </span>
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                                {t("chartTitle")}
                            </h3>
                            <InfoTooltip content="Evolución temporal del desperdicio identificado frente a los ahorros potenciales y efectivamente capturados." />
                        </div>
                    </div>

                    {summary.trend.length === 0 ? (
                        <div className="py-16 flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                            {t("noHistoryYet")}
                        </div>
                    ) : (
                        <div className="w-full h-80">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                    data={summary.trend}
                                    margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient id="colorRealized" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#0078D4" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                                        </linearGradient>
                                        <linearGradient id="colorWaste" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#2563EB" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.6} />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 11, fill: "#64748B" }}
                                        axisLine={{ stroke: "#CBD5E1" }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 11, fill: "#64748B" }}
                                        tickFormatter={(val) => formatCurrencyAxis(val, maxChartValue)}
                                        axisLine={{ stroke: "#CBD5E1" }}
                                        tickLine={false}
                                        width={65}
                                    />
                                    <Tooltip
                                        content={({ active, payload, label }) => {
                                            if (active && payload && payload.length) {
                                                return (
                                                    <div className="bg-[#1B2A41] text-white p-3 rounded-xl shadow-2xl border border-slate-700 text-xs z-[99999] max-w-xs">
                                                        <p className="font-bold text-white mb-2">{label}</p>
                                                        {payload.map((entry, index) => (
                                                            <div
                                                                key={`item-${index}`}
                                                                className="flex items-center justify-between gap-4 py-1 border-t border-slate-700/60 font-mono text-[11px]"
                                                            >
                                                                <span style={{ color: entry.color }}>{entry.name}:</span>
                                                                <span className="font-bold text-white">
                                                                    {fmtUsd(Number(entry.value))}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Legend
                                        wrapperStyle={{ fontSize: 11.5, paddingTop: 10 }}
                                        iconType="circle"
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="realizedSavingsUSD"
                                        name={t("realizedSavings")}
                                        stroke="#0078D4"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill="url(#colorRealized)"
                                        isAnimationActive={false}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="detectedWasteUSD"
                                        name={t("wastedDetected")}
                                        stroke="#2563EB"
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill="url(#colorWaste)"
                                        isAnimationActive={false}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="potentialSavingsUSD"
                                        name={t("potentialSavings")}
                                        stroke="#38BDF8"
                                        strokeWidth={1.5}
                                        strokeDasharray="4 4"
                                        fill="none"
                                        isAnimationActive={false}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            )}

            {/* Remediation Actions History Table (Estándar CMP) */}
            {summary && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                <IconListCheck className="w-5 h-5" stroke={1.5} />
                            </span>
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                                {t("remediationAuditTitle")}
                            </h3>
                            <InfoTooltip content={t("remediationAuditDesc")} />
                        </div>

                        {/* Search Input */}
                        <div className="relative min-w-[260px]">
                            <IconSearch
                                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                                stroke={1.5}
                            />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder={t("searchPlaceholder")}
                                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[#1B2A41] dark:text-white focus:outline-none focus:border-[#0054A6]"
                            />
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto w-full border border-slate-200 dark:border-slate-800 rounded-xl">
                        <table className="w-full text-left border-collapse table-fixed">
                            <thead>
                                <tr className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
                                    <ResizableTh
                                        minWidth={160}
                                        onClick={() => handleSort("timestamp")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colTimestamp")}</span>
                                            {sortField === "timestamp" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>

                                    <ResizableTh
                                        minWidth={180}
                                        onClick={() => handleSort("executedBy")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colExecutedBy")}</span>
                                            {sortField === "executedBy" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>

                                    <ResizableTh
                                        minWidth={180}
                                        onClick={() => handleSort("resourceName")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colResourceName")}</span>
                                            {sortField === "resourceName" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>

                                    <ResizableTh
                                        minWidth={200}
                                        onClick={() => handleSort("actionCategory")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colActionCategory")}</span>
                                            {sortField === "actionCategory" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>

                                    <ResizableTh
                                        minWidth={160}
                                        onClick={() => handleSort("monthlySavingsUSD")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colMonthlySavings")}</span>
                                            {sortField === "monthlySavingsUSD" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>

                                    <ResizableTh
                                        minWidth={120}
                                        onClick={() => handleSort("status")}
                                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span>{t("colStatus")}</span>
                                            {sortField === "status" ? (
                                                sortAsc ? <IconSortAscending className="w-3.5 h-3.5 text-[#0054A6]" /> : <IconSortDescending className="w-3.5 h-3.5 text-[#0054A6]" />
                                            ) : (
                                                <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" />
                                            )}
                                        </div>
                                    </ResizableTh>

                                    <ResizableTh minWidth={130} className="py-3 px-4 text-right">
                                        <span>{t("colActions")}</span>
                                    </ResizableTh>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {paginatedAuditLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-8 text-center text-slate-400 dark:text-slate-500">
                                            {t("emptyAudit")}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedAuditLogs.map((item) => (
                                        <tr
                                            key={item.id}
                                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                                        >
                                            <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                                                {item.timestamp ? item.timestamp.slice(0, 10) : "—"}
                                            </td>
                                            <td className="py-3 px-4 text-slate-700 dark:text-slate-200 truncate font-medium">
                                                <span className="flex items-center gap-1.5">
                                                    <span
                                                        className={`inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                                                            item.origin === "azure"
                                                                ? "bg-sky-50 text-[#0078D4] dark:bg-sky-950/50 dark:text-[#38BDF8] border border-sky-200 dark:border-sky-800"
                                                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                                                        }`}
                                                        title={
                                                            item.origin === "azure"
                                                                ? "Ahorro detectado en Azure: el recurso dejó de facturar sin que la acción pasara por la plataforma."
                                                                : "Acción ejecutada desde la plataforma FinOps."
                                                        }
                                                    >
                                                        {item.origin === "azure" ? "Azure" : "Portal"}
                                                    </span>
                                                    <span className="truncate">{item.executedBy}</span>
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 font-semibold text-[#1B2A41] dark:text-slate-200 truncate">
                                                {item.resourceName}
                                            </td>
                                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] bg-slate-100 dark:bg-slate-800 font-medium">
                                                    {item.actionCategory}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 font-mono font-bold text-[#0054A6] dark:text-blue-400">
                                                {item.monthlySavingsUSD > 0 ? (
                                                    fmtUsd(item.monthlySavingsUSD)
                                                ) : (
                                                    <span
                                                        className="text-slate-400 dark:text-slate-500 font-normal"
                                                        title="Sin ahorro medible contra el costo facturado del recurso para esta acción."
                                                    >
                                                        —
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span
                                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                                        item.status === "SUCCESS"
                                                            ? "bg-blue-50 text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                                            : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800"
                                                    }`}
                                                >
                                                    {item.status === "SUCCESS" ? t("statusSuccess") : t("statusFailed")}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedAudit(item)}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-900 text-[#0054A6] border border-[#0054A6] rounded-lg hover:bg-blue-50/50 shadow-sm transition-all"
                                                >
                                                    <IconSparkles className="w-3 h-3 text-[#0054A6]" />
                                                    <span>{t("viewDetails")}</span>
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span>Mostrar</span>
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs text-[#1B2A41] dark:text-white"
                            >
                                <option value={15}>15</option>
                                <option value={30}>30</option>
                                <option value={45}>45</option>
                                <option value={60}>60</option>
                            </select>
                            <span>de {filteredAuditLogs.length} acciones</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                disabled={currentPage <= 1}
                                onClick={() => setCurrentPage((p) => p - 1)}
                                className="px-3 py-1 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50"
                            >
                                Anterior
                            </button>
                            <span className="text-xs text-slate-500 px-2">
                                {currentPage} / {totalPages}
                            </span>
                            <button
                                type="button"
                                disabled={currentPage >= totalPages}
                                onClick={() => setCurrentPage((p) => p + 1)}
                                className="px-3 py-1 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Drawer for Remediation Action Details (z-[100] Layering) */}
            {selectedAudit && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
                        onClick={() => setSelectedAudit(null)}
                    />

                    {/* Modal Content */}
                    <div className="relative z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                            <div className="flex items-center gap-3">
                                <span className="text-[#0078D4] dark:text-blue-400 bg-transparent p-0">
                                    <IconShieldCheck className="w-6 h-6" stroke={1.5} />
                                </span>
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                                        {t("auditDetailModalTitle")}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t("auditDetailModalSubtitle")}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedAudit(null)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                            >
                                <IconX className="w-5 h-5" stroke={1.5} />
                            </button>
                        </div>

                        {/* Details Grid */}
                        <div className="space-y-3 text-xs">
                            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">{t("colResourceName")}:</span>
                                    <span className="font-bold text-[#1B2A41] dark:text-white">
                                        {selectedAudit.resourceName}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">{t("resourceType")}:</span>
                                    <span className="font-mono text-slate-700 dark:text-slate-300 text-[11px]">
                                        {selectedAudit.resourceType}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">{t("colActionCategory")}:</span>
                                    <span className="font-semibold text-[#0054A6] dark:text-blue-400">
                                        {selectedAudit.actionCategory}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">{t("colExecutedBy")}:</span>
                                    <span className="text-slate-700 dark:text-slate-300">
                                        {selectedAudit.executedBy}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">{t("colTimestamp")}:</span>
                                    <span className="font-mono text-slate-700 dark:text-slate-300">
                                        {selectedAudit.timestamp}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                        {t("colMonthlySavings")}
                                    </span>
                                    <span className="text-lg font-bold font-mono text-[#0054A6] dark:text-blue-400">
                                        {fmtUsd(selectedAudit.monthlySavingsUSD)}
                                    </span>
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                        {t("annualImpact")}
                                    </span>
                                    <span className="text-lg font-bold font-mono text-[#1B2A41] dark:text-white">
                                        {fmtUsd(selectedAudit.monthlySavingsUSD * 12)}
                                    </span>
                                </div>
                            </div>

                            {selectedAudit.details && (
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-bold mb-1">
                                        Detalle de Ejecución:
                                    </span>
                                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                                        {selectedAudit.details}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setSelectedAudit(null)}
                                className="px-4 py-2 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 transition-all"
                            >
                                {t("close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
