"use client";

import React, { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconTrendingUp,
  IconAward,
  IconShieldDollar,
  IconTag,
  IconBolt,
  IconCircleCheck,
  IconDownload,
  IconSearch,
  IconX,
  IconRefresh,
  IconHistory,
  IconServer,
  IconDatabase,
  IconNetwork,
  IconCloud,
  IconBoxMultiple,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { getFreshIdToken } from "@/lib/msalToken";
import { useChartTheme } from "@/lib/chartTheme";
import { safeSavingsPercentage, formatSavingsPercentage } from "@/lib/realizedSavings";
import { isMockTenant } from "@/lib/mockData";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import InfoTooltip from "@/components/InfoTooltip";
import Pagination, { usePagination } from "@/components/Pagination";
import type {
  HistoryTimeRange,
  HistoricalProgressPayload,
  BeforeAfterVerificationItem,
} from "@/types/historicalProgress.types";

// Paleta armónica corporativa en tonos de azul
const BLUE_PALETTE = {
  deep: "#0078D4",       // Serie Principal / Madurez / Gasto Real
  cobalt: "#2563EB",     // Línea Base Contrafactual / Forecast
  cyan: "#0284C7",       // Cobertura de Tags / Presupuestos
  sky: "#38BDF8",        // Categorías / Servicios
  ice: "#93C5FD",        // Gasto Huérfano / Inactivo
  slate: "#94A3B8",      // Neutral
  emerald: "#10B981",    // Ahorro Realizado / Óptimo
  amber: "#F59E0B",      // Alerta sutil
  rose: "#EF4444",       // Advertencia
};

const formatCurrencyAxis = (value: number, maxVal: number = 1000): string => {
  if (Math.abs(maxVal) < 1000) {
    return `$${Math.round(value)}`;
  }
  return `$${(value / 1000).toFixed(1)}k`;
};

/**
 * Porcentaje de ahorro cuando el payload no lo trae resuelto (cachés previas o
 * fuentes que no pasan por el servicio). Usa la misma guarda de división por
 * cero que el backend, así la celda nunca queda vacía ni con NaN%.
 */
function savingsPercentLabel(item: BeforeAfterVerificationItem): string {
  const wasDeleted = /delete|purga|zombie|elimina/i.test(item.actionType || "");
  const pct = safeSavingsPercentage(item.costPre30d, item.costPost30d, wasDeleted);
  return formatSavingsPercentage(pct, Number(item.costPre30d) > 0);
}

/** Icono Tabler segun el tipo ARM real del recurso afectado (BUG 5). */
function resourceTypeIcon(resourceType?: string) {
  const t = (resourceType || "").toLowerCase();
  const cls = "w-3.5 h-3.5 shrink-0 text-[#0078D4] dark:text-[#38BDF8]";
  if (t.includes("virtualmachine") || t.includes("scalesets")) return <IconServer className={cls} stroke={1.5} />;
  if (t.includes("managedcluster") || t.includes("containerservice")) return <IconBoxMultiple className={cls} stroke={1.5} />;
  if (t.includes("disk") || t.includes("snapshot") || t.includes("sql") || t.includes("database") || t.includes("redis") || t.includes("cosmos")) return <IconDatabase className={cls} stroke={1.5} />;
  if (t.includes("network") || t.includes("bastion") || t.includes("firewall") || t.includes("gateway") || t.includes("publicip")) return <IconNetwork className={cls} stroke={1.5} />;
  return <IconCloud className={cls} stroke={1.5} />;
}

export default function HistoricalProgressBoard() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const t = useTranslations("OverviewProgress");
  const locale = useLocale();
  const chart = useChartTheme();

  const [timeRange, setTimeRange] = useState<HistoryTimeRange>("90d");
  const [activeTab, setActiveTab] = useState<"maturity" | "commitments" | "roi" | "audit">("maturity");

  // Filtros y paginación para auditoría Before/After
  const [auditSearch, setAuditSearch] = useState("");
  const [auditSort, setAuditSort] = useState<"savings_desc" | "savings_asc" | "alpha_asc">("savings_desc");
  const [selectedAuditItem, setSelectedAuditItem] = useState<BeforeAfterVerificationItem | null>(null);

  const tenantId = selectedTenant?.id || "default";
  const isMock = isMockTenant(tenantId) || tenantId.startsWith("demo-") || tenantId.startsWith("mock-");

  const fetcher = useCallback(
    async (url: string) => {
      let token = "";
      if (!isMock && accounts.length > 0) {
        try {
          token = await getFreshIdToken(instance, accounts[0]);
        } catch {
          // MSAL token fallback
        }
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      return res.json() as Promise<HistoricalProgressPayload>;
    },
    [accounts, instance, isMock]
  );

  const { data: reportData, error, isLoading, mutate } = useSWR(
    `/api/intelligence/history?tenantId=${tenantId}&timeRange=${timeRange}&locale=${locale}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const summary = reportData?.summary;
  const series = useMemo(() => reportData?.series || [], [reportData]);
  const verifications = useMemo(() => reportData?.beforeAfterVerifications || [], [reportData]);
  const waiverLedger = useMemo(() => reportData?.waiverLedger || [], [reportData]);

  // Filtrado de auditoría Before/After
  const filteredVerifications = useMemo(() => {
    return verifications
      .filter((v) => {
        if (!auditSearch.trim()) return true;
        const q = auditSearch.toLowerCase();
        return (
          v.resourceName.toLowerCase().includes(q) ||
          v.resourceGroup.toLowerCase().includes(q) ||
          v.actionType.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (auditSort === "savings_desc") return b.realizedMonthlySavings - a.realizedMonthlySavings;
        if (auditSort === "savings_asc") return a.realizedMonthlySavings - b.realizedMonthlySavings;
        return a.resourceName.localeCompare(b.resourceName);
      });
  }, [verifications, auditSearch, auditSort]);

  const {
    page: auditPage,
    setPage: setAuditPage,
    pageSize: auditPageSize,
    setPageSize: setAuditPageSize,
    total: auditTotal,
    totalPages: auditTotalPages,
    paged: pagedVerifications,
  } = usePagination(filteredVerifications, 15);

  const maxSeriesSpend = useMemo(() => {
    if (!series.length) return 1000;
    return Math.max(...series.map((s) => Math.max(s.actualSpendUSD, s.counterfactualSpendUSD, s.budgetUSD || 0)));
  }, [series]);

  const handleExportCSV = () => {
    if (!series.length) return;
    const headers = [
      t("csvDate"),
      t("csvMaturity"),
      t("csvActual"),
      t("csvCounterfactual"),
      t("csvNetSavings"),
      t("csvTagCoverage"),
      t("csvOrphanSpend"),
      t("csvCommitCoverage"),
    ];
    const rows = series.map((s) => [
      s.date,
      s.maturityScore,
      s.actualSpendUSD,
      s.counterfactualSpendUSD,
      s.netSavingsUSD || 0,
      s.tagCoveragePercentage,
      s.unallocatedSpendUSD,
      s.commitmentCoveragePercentage,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `progreso-historico-finops-${timeRange}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 w-full text-[#1B2A41] dark:text-foreground">
      {/* ─── Encabezado Principal ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white flex items-center gap-2">
              <IconTrendingUp className="w-7 h-7 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
              {t("pageTitle")}
            </h1>
            <PageHeaderTierBadge tier="Enterprise" />
            <InfoTooltip content={t("subtitle_tooltip")} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>

        {/* Controles de Rango Temporal y Exportar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-xl shadow-sm">
            {(
              [
                { key: "30d", label: t("range_30d") },
                { key: "90d", label: t("range_90d") },
                { key: "180d", label: t("range_180d") },
                { key: "365d", label: t("range_365d") },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setTimeRange(opt.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  timeRange === opt.key
                    ? "bg-[#0078D4] text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-[#0078D4]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCSV}
            className="px-3.5 py-1.5 bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-blue-50/50 dark:hover:bg-blue-950/20 text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <IconDownload className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
            {t("exportCsv")}
          </button>

          <button
            onClick={() => mutate()}
            disabled={isLoading}
            className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 text-xs font-bold rounded-lg transition shadow-sm cursor-pointer"
            title={t("refresh")}
          >
            <IconRefresh className={`w-4 h-4 text-[#0078D4] dark:text-[#38BDF8] bg-transparent ${isLoading ? "animate-spin" : ""}`} stroke={1.8} />
          </button>
        </div>
      </div>

      {/* ─── 5 KPI Cards Superiores (Iconos Tabler en Azul sin Fondo) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Maturity Score */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {t("kpiMaturity")}
            </span>
            <IconAward className="w-5 h-5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              {summary ? summary.currentMaturityScore.toFixed(1) : "78.0"}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">/ 100</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="px-2 py-0.5 rounded-md font-bold bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] dark:text-[#38BDF8]">
              {summary?.currentMaturityStage || "RUN"}
            </span>
            <span className="text-[#10B981] font-semibold flex items-center">
              +{summary ? summary.scoreDelta.toFixed(1) : "18.0"} pts
            </span>
          </div>
        </div>

        {/* Card 2: Gasto Evitado Total */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {t("kpiNetSavings")}
            </span>
            <IconShieldDollar className="w-5 h-5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              ${summary ? summary.totalAvoidedCostUSD.toLocaleString() : "57"}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">USD</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            {t("kpiNetSavingsSub")}
          </p>
        </div>

        {/* Card 3: Higiene de Tags */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {t("kpiTagging")}
            </span>
            <IconTag className="w-5 h-5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              {summary ? summary.tagHygienePercentage.toFixed(1) : "85.0"}%
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            {t("kpiTaggingSub")}
          </p>
        </div>

        {/* Card 4: Cobertura RIs / SPs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {t("kpiCoverage")}
            </span>
            <IconBolt className="w-5 h-5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              {summary ? summary.commitmentCoveragePercentage.toFixed(1) : "78.0"}%
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            {t("utilizationLabel", { pct: summary ? summary.commitmentUtilizationPercentage.toFixed(0) : "92" })}
          </p>
        </div>

        {/* Card 5: Ahorro Realizado */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {t("kpiRealized")}
            </span>
            <IconCircleCheck className="w-5 h-5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              ${summary ? summary.realizedSavingsUSD.toLocaleString() : "48"}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">USD</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            {t("kpiRealizedSub")}
          </p>
        </div>
      </div>

      {/* ─── 4 Sub-Pestañas de Navegación ─── */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto">
        {(
          [
            { id: "maturity", label: t("tabMaturity"), icon: IconAward },
            { id: "commitments", label: t("tabCommitments"), icon: IconBolt },
            { id: "roi", label: t("tabRoi"), icon: IconShieldDollar },
            { id: "audit", label: t("tabAudit"), icon: IconHistory },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? "border-[#0078D4] text-[#0078D4]"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="w-4 h-4 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── Contenido de las 4 Sub-Pestañas ─── */}

      {/* TAB 1: Madurez & Gobernanza */}
      {activeTab === "maturity" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Gráfico Izquierdo: Evolución del Índice de Madurez FinOps */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold font-heading text-[#1B2A41] dark:text-white flex items-center gap-2">
                    {t("chartMaturityTitle")}
                    <InfoTooltip content={t("chartMaturityTooltip")} />
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t("chartMaturityLegend")}</p>
                </div>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} opacity={0.6} />
                    <XAxis dataKey="label" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                    <YAxis domain={[0, 100]} stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${Number(val).toFixed(1)} pts`, t("maturityIndex")]}
                      contentStyle={{ backgroundColor: chart.tooltip.backgroundColor, border: `1px solid ${chart.tooltip.borderColor}`, borderRadius: 8, color: chart.tooltip.color, fontSize: 11 }}
                    />
                    <ReferenceLine y={40} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: "Walk (40)", fill: "#94A3B8", fontSize: 10 }} />
                    <ReferenceLine y={75} stroke="#0078D4" strokeDasharray="4 4" label={{ value: "Run (75)", fill: "#0078D4", fontSize: 10 }} />
                    <Line type="monotone" dataKey="maturityScore" stroke={BLUE_PALETTE.deep} strokeWidth={3} dot={{ r: 3, fill: BLUE_PALETTE.deep }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gráfico Derecho: Higiene de Tags & Gasto Huérfano */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold font-heading text-[#1B2A41] dark:text-white flex items-center gap-2">
                    {t("chartTaggingTitle")}
                    <InfoTooltip content={t("chartTaggingTooltip")} />
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t("chartTaggingLegend")}</p>
                </div>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTag" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BLUE_PALETTE.cyan} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={BLUE_PALETTE.cyan} stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorUnallocated" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BLUE_PALETTE.ice} stopOpacity={0.5} />
                        <stop offset="95%" stopColor={BLUE_PALETTE.ice} stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} opacity={0.6} />
                    <XAxis dataKey="label" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                    <YAxis yAxisId="left" domain={[0, 100]} stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} unit="%" />
                    <YAxis yAxisId="right" orientation="right" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} tickFormatter={(v) => formatCurrencyAxis(v, maxSeriesSpend)} />
                    <Tooltip contentStyle={{ backgroundColor: chart.tooltip.backgroundColor, border: `1px solid ${chart.tooltip.borderColor}`, borderRadius: 8, color: chart.tooltip.color, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Area yAxisId="left" type="monotone" dataKey="tagCoveragePercentage" name={t("seriesTagCoverage")} stroke={BLUE_PALETTE.cyan} fill="url(#colorTag)" strokeWidth={2} />
                    <Area yAxisId="right" type="monotone" dataKey="unallocatedSpendUSD" name={t("seriesOrphanSpend")} stroke={BLUE_PALETTE.ice} fill="url(#colorUnallocated)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Pill Bar Inferior: Desglose en 4 Bloques */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              {t("pillarsTitle")}
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t("pillar_allocation")}</span>
                <div className="text-lg font-bold text-[#1B2A41] dark:text-white mt-1">
                  {series[series.length - 1]?.pillars?.allocation ?? 74}%
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2">
                  <div className="bg-[#0078D4] h-1.5 rounded-full" style={{ width: `${series[series.length - 1]?.pillars?.allocation ?? 74}%` }} />
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t("pillar_rates")}</span>
                <div className="text-lg font-bold text-[#1B2A41] dark:text-white mt-1">
                  {series[series.length - 1]?.pillars?.rates ?? 70}%
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2">
                  <div className="bg-[#2563EB] h-1.5 rounded-full" style={{ width: `${series[series.length - 1]?.pillars?.rates ?? 70}%` }} />
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t("pillar_usage")}</span>
                <div className="text-lg font-bold text-[#1B2A41] dark:text-white mt-1">
                  {series[series.length - 1]?.pillars?.usage ?? 82}%
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2">
                  <div className="bg-[#0284C7] h-1.5 rounded-full" style={{ width: `${series[series.length - 1]?.pillars?.usage ?? 82}%` }} />
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t("pillar_governance")}</span>
                <div className="text-lg font-bold text-[#1B2A41] dark:text-white mt-1">
                  {series[series.length - 1]?.pillars?.governance ?? 78}%
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2">
                  <div className="bg-[#38BDF8] h-1.5 rounded-full" style={{ width: `${series[series.length - 1]?.pillars?.governance ?? 78}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Compromisos & Zombis */}
      {activeTab === "commitments" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cobertura y Utilización de RIs / SPs */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-bold font-heading text-[#1B2A41] dark:text-white mb-1 flex items-center gap-2">
                {t("commitmentsTitle")}
                <InfoTooltip content={t("commitmentsTooltip")} />
              </h3>
              <p className="text-xs text-slate-500 mb-4">{t("commitmentsLegend")}</p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} opacity={0.6} />
                    <XAxis dataKey="label" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                    <YAxis domain={[0, 100]} stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} unit="%" />
                    <Tooltip contentStyle={{ backgroundColor: chart.tooltip.backgroundColor, border: `1px solid ${chart.tooltip.borderColor}`, borderRadius: 8, color: chart.tooltip.color, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Line type="monotone" dataKey="commitmentCoveragePercentage" name={t("seriesCoverage")} stroke={BLUE_PALETTE.deep} strokeWidth={2.5} />
                    <Line type="monotone" dataKey="commitmentUtilizationPercentage" name={t("seriesUtilization")} stroke={BLUE_PALETTE.cyan} strokeWidth={2.5} strokeDasharray="3 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Caza de Recursos Zombi & Ahorro Recurrente */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-bold font-heading text-[#1B2A41] dark:text-white mb-1 flex items-center gap-2">
                {t("zombieTitle")}
                <InfoTooltip content={t("zombieTooltip")} />
              </h3>
              <p className="text-xs text-slate-500 mb-4">{t("zombieLegend")}</p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} opacity={0.6} />
                    <XAxis dataKey="label" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                    <YAxis yAxisId="left" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} tickFormatter={(v) => formatCurrencyAxis(v, maxSeriesSpend)} />
                    <Tooltip contentStyle={{ backgroundColor: chart.tooltip.backgroundColor, border: `1px solid ${chart.tooltip.borderColor}`, borderRadius: 8, color: chart.tooltip.color, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Bar yAxisId="left" dataKey="zombiesPurgedCount" name={t("seriesPurged")} fill={BLUE_PALETTE.deep} radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="recurringSavingsAvoidedUSD" name={t("seriesAvoided")} fill={BLUE_PALETTE.sky} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ROI & Ahorro Contrafactual */}
      {activeTab === "roi" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-bold font-heading text-[#1B2A41] dark:text-white flex items-center gap-2">
                  {t("counterfactualTitle")}
                  <InfoTooltip content={t("counterfactualTooltip")} />
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("counterfactualFormula")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                  {t("netSavingsBadge", { amount: summary?.totalAvoidedCostUSD.toLocaleString() ?? "0" })}
                </span>
              </div>
            </div>

            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCounterfactual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BLUE_PALETTE.cobalt} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={BLUE_PALETTE.cobalt} stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BLUE_PALETTE.deep} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={BLUE_PALETTE.deep} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} opacity={0.6} />
                  <XAxis dataKey="label" stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} />
                  <YAxis stroke={chart.axis} tick={{ fill: chart.tick, fontSize: 11 }} tickFormatter={(v) => formatCurrencyAxis(v, maxSeriesSpend)} />
                  <Tooltip
                    formatter={(val: any) => [`$${Number(val).toFixed(2)} USD`, ""]}
                    contentStyle={{ backgroundColor: chart.tooltip.backgroundColor, border: `1px solid ${chart.tooltip.borderColor}`, borderRadius: 8, color: chart.tooltip.color, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                  <Area
                    type="monotone"
                    dataKey="counterfactualSpendUSD"
                    name={t("seriesCounterfactual")}
                    stroke={BLUE_PALETTE.cobalt}
                    strokeDasharray="4 4"
                    fill="url(#colorCounterfactual)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="actualSpendUSD"
                    name={t("seriesActual")}
                    stroke={BLUE_PALETTE.deep}
                    fill="url(#colorActual)"
                    strokeWidth={2.5}
                  />
                  <Line
                    type="monotone"
                    dataKey="budgetUSD"
                    name={t("seriesBudget")}
                    stroke={BLUE_PALETTE.cyan}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Before/After & Hitos */}
      {activeTab === "audit" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold font-heading text-[#1B2A41] dark:text-white flex items-center gap-2">
                  {t("auditTitle")}
                  <InfoTooltip content={t("auditTooltip")} />
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("auditSubtitle")}
                </p>
              </div>

              {/* Filtros de Búsqueda */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <IconSearch className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" stroke={1.8} />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder={t("auditSearch")}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none text-[#1B2A41] dark:text-white placeholder-slate-400 w-48 sm:w-60"
                  />
                </div>
              </div>
            </div>

            {/* Tabla Responsive de Auditoría */}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-300 uppercase tracking-wider font-semibold">
                    <th className="py-2.5 px-3">{t("colResource")}</th>
                    <th className="py-2.5 px-3">{t("colAction")}</th>
                    <th className="py-2.5 px-3">{t("colDate")}</th>
                    <th className="py-2.5 px-3 text-right">{t("colCostPre")}</th>
                    <th className="py-2.5 px-3 text-right">{t("colCostPost")}</th>
                    <th className="py-2.5 px-3 text-right">{t("colMonthlySavings")}</th>
                    <th className="py-2.5 px-3 text-right">{t("colSavingsPct")}</th>
                    <th className="py-2.5 px-3 text-center">{t("colRebound")}</th>
                    <th className="py-2.5 px-3 text-center">{t("colDetail")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {pagedVerifications.length > 0 ? (
                    pagedVerifications.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            {resourceTypeIcon(item.resourceType)}
                            <span
                              className="font-bold text-[#1B2A41] dark:text-white truncate max-w-[200px]"
                              title={item.resourceId || item.resourceName}
                            >
                              {item.resourceName}
                            </span>
                          </div>
                          {/* Grupo de recursos real extraído del ARM ID, en línea
                              secundaria: antes venía pegado al nombre o con el
                              literal "general-rg". */}
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            rg: {item.resourceGroup || "—"}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                          {item.actionType}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {item.executedDate}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-slate-600 dark:text-slate-400">
                          ${item.costPre30d.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-slate-600 dark:text-slate-400">
                          ${item.costPost30d.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-[#10B981] dark:text-emerald-400">
                          +${item.realizedMonthlySavings.toFixed(2)}
                        </td>
                        {/* "—" cuando no hay linea base de costo previo: antes
                            quedaba vacio o mostraba NaN% por division por cero. */}
                        <td
                          className="py-2.5 px-3 text-right font-bold font-mono tabular-nums text-[#0078D4] dark:text-[#38BDF8]"
                          title={
                            item.baselineSource === "cost_management"
                              ? t("baselineCostManagement")
                              : item.baselineSource === "type_baseline"
                              ? t("baselineTypeEstimate")
                              : t("baselineNone")
                          }
                        >
                          {item.formattedSavingsPercentage ?? savingsPercentLabel(item)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.reboundStatus === "verified_optimal"
                                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40"
                                : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40"
                            }`}
                          >
                            {item.reboundStatus === "verified_optimal" ? t("reboundOptimal") : t("reboundReview")}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => setSelectedAuditItem(item)}
                            className="px-2 py-1 text-[11px] font-bold text-[#0078D4] hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md transition cursor-pointer"
                          >
                            {t("view")}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        {t("auditEmpty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginador */}
            {filteredVerifications.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <Pagination
                  page={auditPage}
                  setPage={setAuditPage}
                  pageSize={auditPageSize}
                  setPageSize={setAuditPageSize}
                  total={auditTotal}
                  totalPages={auditTotalPages}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Modal de Detalle de Auditoría (z-50) ─── */}
      {selectedAuditItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative z-50 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold font-heading text-[#1B2A41] dark:text-white flex items-center gap-2">
                <IconHistory className="w-5 h-5 text-[#0078D4] dark:text-[#38BDF8] bg-transparent" stroke={1.8} />
                {t("modalTitle")}
              </h3>
              <button
                onClick={() => setSelectedAuditItem(null)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-1">
                <div className="font-bold text-[#1B2A41] dark:text-white text-sm">
                  {selectedAuditItem.resourceName}
                </div>
                <div className="text-slate-500">{t("detailGroup", { rg: selectedAuditItem.resourceGroup })}</div>
                <div className="text-slate-500">{t("detailExecutedBy", { who: selectedAuditItem.executedBy })}</div>
                <div className="text-slate-500">{t("detailDate", { date: selectedAuditItem.executedDate })}</div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase">{t("modalCostPre")}</span>
                  <div className="font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                    ${selectedAuditItem.costPre30d.toFixed(2)}
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase">{t("modalCostPost")}</span>
                  <div className="font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                    ${selectedAuditItem.costPost30d.toFixed(2)}
                  </div>
                </div>
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg">
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase">{t("modalSavings")}</span>
                  <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    +${selectedAuditItem.realizedMonthlySavings.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                <span className="font-bold text-[#0078D4] block mb-1">{t("modalRebound")}</span>
                <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                  {selectedAuditItem.reboundDetails}
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedAuditItem(null)}
                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 text-xs font-bold rounded-lg transition cursor-pointer"
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
