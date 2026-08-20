"use client";

import React, { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
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
  IconCalendar,
  IconSearch,
  IconArrowUpRight,
  IconSparkles,
  IconX,
  IconInfoCircle,
  IconRefresh,
  IconAlertTriangle,
  IconLeaf,
  IconClock,
  IconFlame,
  IconHistory,
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
import { isMockTenant } from "@/lib/mockData";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import InfoTooltip from "@/components/InfoTooltip";
import Pagination, { usePagination } from "@/components/Pagination";
import type {
  HistoryTimeRange,
  HistoricalProgressPayload,
  BeforeAfterVerificationItem,
  WaiverLedgerItem,
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

export default function HistoricalProgressBoard() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const t = useTranslations("OverviewProgress");

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
    `/api/intelligence/history?tenantId=${tenantId}&timeRange=${timeRange}`,
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
      "Fecha",
      "Madurez FinOps",
      "Gasto Real USD",
      "Gasto Contrafactual USD",
      "Ahorro Neto USD",
      "Cobertura Tags %",
      "Gasto Huerfano USD",
      "Cobertura Compromisos %",
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
    <div className="space-y-6 text-[#1B2A41] dark:text-foreground">
      {/* ─── Encabezado Principal ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white flex items-center gap-2">
              <IconTrendingUp className="w-7 h-7 text-[#0078D4] bg-transparent" stroke={1.8} />
              {t("pageTitle")}
            </h1>
            <PageHeaderTierBadge tier="Enterprise" />
            <InfoTooltip content="Análisis temporal de madurez FinOps, ahorro contrafactual acumulado y evolución de gobernanza de nube." />
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
                { key: "30d", label: "30 Días" },
                { key: "90d", label: "3 Meses" },
                { key: "180d", label: "6 Meses" },
                { key: "365d", label: "1 Año" },
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
            <IconDownload className="w-4 h-4 text-[#0078D4] bg-transparent" stroke={1.8} />
            Exportar CSV
          </button>

          <button
            onClick={() => mutate()}
            disabled={isLoading}
            className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 text-xs font-bold rounded-lg transition shadow-sm cursor-pointer"
            title="Actualizar datos"
          >
            <IconRefresh className={`w-4 h-4 text-[#0078D4] bg-transparent ${isLoading ? "animate-spin" : ""}`} stroke={1.8} />
          </button>
        </div>
      </div>

      {/* ─── 5 KPI Cards Superiores (Iconos Tabler en Azul sin Fondo) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Maturity Score */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Maturity Score
            </span>
            <IconAward className="w-5 h-5 text-[#0078D4] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              {summary ? summary.currentMaturityScore.toFixed(1) : "78.0"}
            </span>
            <span className="text-xs text-slate-500">/ 100</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="px-2 py-0.5 rounded-md font-bold bg-blue-50 dark:bg-blue-950/40 text-[#0078D4]">
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
              Gasto Evitado Total
            </span>
            <IconShieldDollar className="w-5 h-5 text-[#0078D4] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              ${summary ? summary.totalAvoidedCostUSD.toLocaleString() : "57"}
            </span>
            <span className="text-xs text-slate-500">USD</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            Ahorro contrafactual calculado
          </p>
        </div>

        {/* Card 3: Higiene de Tags */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Higiene de Tags
            </span>
            <IconTag className="w-5 h-5 text-[#0078D4] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              {summary ? summary.tagHygienePercentage.toFixed(1) : "85.0"}%
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            Cumplimiento tags obligatorias
          </p>
        </div>

        {/* Card 4: Cobertura RIs / SPs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Cobertura RIs / SPs
            </span>
            <IconBolt className="w-5 h-5 text-[#0078D4] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              {summary ? summary.commitmentCoveragePercentage.toFixed(1) : "78.0"}%
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            Utilización: {summary ? summary.commitmentUtilizationPercentage.toFixed(0) : "92"}%
          </p>
        </div>

        {/* Card 5: Ahorro Realizado */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Ahorro Realizado
            </span>
            <IconCircleCheck className="w-5 h-5 text-[#0078D4] bg-transparent" stroke={1.8} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-heading text-[#1B2A41] dark:text-white">
              ${summary ? summary.realizedSavingsUSD.toLocaleString() : "48"}
            </span>
            <span className="text-xs text-slate-500">USD</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 truncate">
            Implementaciones verificadas
          </p>
        </div>
      </div>

      {/* ─── 4 Sub-Pestañas de Navegación ─── */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto">
        {(
          [
            { id: "maturity", label: "1. Madurez & Gobernanza", icon: IconAward },
            { id: "commitments", label: "2. Compromisos & Zombis", icon: IconBolt },
            { id: "roi", label: "3. ROI & Ahorro Contrafactual", icon: IconShieldDollar },
            { id: "audit", label: "4. Before/After & Hitos", icon: IconHistory },
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
              <Icon className="w-4 h-4 text-[#0078D4] bg-transparent" stroke={1.8} />
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
                    Evolución del Índice de Madurez FinOps (0 - 100)
                    <InfoTooltip content="Puntaje ponderado de 0 a 100 evaluando Visibilidad, Optimización de Tasa, Optimización de Uso y Gobernanza con benchmarks Crawl (<40), Walk (40-75) y Run (>75)." />
                  </h3>
                  <p className="text-xs text-slate-500">Benchmark Walk (40) y Run (75)</p>
                </div>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.6} />
                    <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                    <YAxis domain={[0, 100]} stroke="#64748B" fontSize={11} />
                    <Tooltip
                      formatter={(val: any) => [`${Number(val).toFixed(1)} pts`, "Índice de Madurez"]}
                      contentStyle={{ backgroundColor: "#1B2A41", borderRadius: 8, color: "#fff", fontSize: 11 }}
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
                    Higiene de Tags & Reducción de Gasto Huérfano
                    <InfoTooltip content="Evolución del porcentaje de cumplimiento de etiquetas obligatorias frente al costo de recursos no asignados a centros de costo." />
                  </h3>
                  <p className="text-xs text-slate-500">% Cobertura vs Gasto No Asignado</p>
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.6} />
                    <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                    <YAxis yAxisId="left" domain={[0, 100]} stroke="#64748B" fontSize={11} unit="%" />
                    <YAxis yAxisId="right" orientation="right" stroke="#64748B" fontSize={11} tickFormatter={(v) => formatCurrencyAxis(v, maxSeriesSpend)} />
                    <Tooltip contentStyle={{ backgroundColor: "#1B2A41", borderRadius: 8, color: "#fff", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Area yAxisId="left" type="monotone" dataKey="tagCoveragePercentage" name="% Cobertura Tags" stroke={BLUE_PALETTE.cyan} fill="url(#colorTag)" strokeWidth={2} />
                    <Area yAxisId="right" type="monotone" dataKey="unallocatedSpendUSD" name="Gasto Huérfano ($)" stroke={BLUE_PALETTE.ice} fill="url(#colorUnallocated)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Pill Bar Inferior: Desglose en 4 Bloques */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Desglose de Pilares de Madurez (Estado Actual)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500">1. Asignación</span>
                <div className="text-lg font-bold text-[#1B2A41] dark:text-white mt-1">
                  {series[series.length - 1]?.pillars?.allocation ?? 74}%
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2">
                  <div className="bg-[#0078D4] h-1.5 rounded-full" style={{ width: `${series[series.length - 1]?.pillars?.allocation ?? 74}%` }} />
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500">2. Tarifas</span>
                <div className="text-lg font-bold text-[#1B2A41] dark:text-white mt-1">
                  {series[series.length - 1]?.pillars?.rates ?? 70}%
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2">
                  <div className="bg-[#2563EB] h-1.5 rounded-full" style={{ width: `${series[series.length - 1]?.pillars?.rates ?? 70}%` }} />
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500">3. Uso</span>
                <div className="text-lg font-bold text-[#1B2A41] dark:text-white mt-1">
                  {series[series.length - 1]?.pillars?.usage ?? 82}%
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2">
                  <div className="bg-[#0284C7] h-1.5 rounded-full" style={{ width: `${series[series.length - 1]?.pillars?.usage ?? 82}%` }} />
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                <span className="text-[11px] text-slate-500">4. Gobernanza</span>
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
                Salud de Compromisos (Reservas & Savings Plans)
                <InfoTooltip content="Porcentaje de cobertura de compromisos frente al índice de utilización real de los mismos." />
              </h3>
              <p className="text-xs text-slate-500 mb-4">Cobertura objetivo &gt;75%, Utilización objetivo &gt;90%</p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.6} />
                    <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                    <YAxis domain={[0, 100]} stroke="#64748B" fontSize={11} unit="%" />
                    <Tooltip contentStyle={{ backgroundColor: "#1B2A41", borderRadius: 8, color: "#fff", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Line type="monotone" dataKey="commitmentCoveragePercentage" name="% Cobertura" stroke={BLUE_PALETTE.deep} strokeWidth={2.5} />
                    <Line type="monotone" dataKey="commitmentUtilizationPercentage" name="% Utilización" stroke={BLUE_PALETTE.cyan} strokeWidth={2.5} strokeDasharray="3 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Caza de Recursos Zombi & Ahorro Recurrente */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-bold font-heading text-[#1B2A41] dark:text-white mb-1 flex items-center gap-2">
                Caza de Recursos Zombi & Ahorro Recurrente
                <InfoTooltip content="Recursos huérfanos purgados (discos, IPs públicas, snapshots) y costo evitado mensual acumulado." />
              </h3>
              <p className="text-xs text-slate-500 mb-4">Discos, IPs y snapshots eliminados</p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.6} />
                    <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                    <YAxis yAxisId="left" stroke="#64748B" fontSize={11} />
                    <YAxis yAxisId="right" orientation="right" stroke="#64748B" fontSize={11} tickFormatter={(v) => formatCurrencyAxis(v, maxSeriesSpend)} />
                    <Tooltip contentStyle={{ backgroundColor: "#1B2A41", borderRadius: 8, color: "#fff", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Bar yAxisId="left" dataKey="zombiesPurgedCount" name="Recursos Purgados" fill={BLUE_PALETTE.deep} radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="recurringSavingsAvoidedUSD" name="Ahorro Mensual Evitado ($)" fill={BLUE_PALETTE.sky} radius={[4, 4, 0, 0]} />
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
                  Gasto Real vs Línea Base Contrafactual ("Lo que habrías gastado")
                  <InfoTooltip content="Comparativa entre la facturación real observada y la trayectoria contrafactual proyectada sin las optimizaciones FinOps aplicadas." />
                </h3>
                <p className="text-xs text-slate-500">
                  Gasto Contrafactual = Gasto Real + Ahorro Mensual Realizado Acumulado
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                  Ahorro Neto: ${summary?.totalAvoidedCostUSD.toLocaleString()} USD
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.6} />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} tickFormatter={(v) => formatCurrencyAxis(v, maxSeriesSpend)} />
                  <Tooltip
                    formatter={(val: any) => [`$${Number(val).toFixed(2)} USD`, ""]}
                    contentStyle={{ backgroundColor: "#1B2A41", borderRadius: 8, color: "#fff", fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                  <Area
                    type="monotone"
                    dataKey="counterfactualSpendUSD"
                    name="Línea Base Contrafactual"
                    stroke={BLUE_PALETTE.cobalt}
                    strokeDasharray="4 4"
                    fill="url(#colorCounterfactual)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="actualSpendUSD"
                    name="Gasto Real Facturado"
                    stroke={BLUE_PALETTE.deep}
                    fill="url(#colorActual)"
                    strokeWidth={2.5}
                  />
                  <Line
                    type="monotone"
                    dataKey="budgetUSD"
                    name="Presupuesto"
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
                  Auditoría Before vs After (30d antes vs 30d después)
                  <InfoTooltip content="Verificación de impacto real sobre recursos optimizados para confirmar la persistencia de ahorros y prevenir efecto rebote." />
                </h3>
                <p className="text-xs text-slate-500">
                  Monitoreo de efecto rebote y verificación post-remediación
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
                    placeholder="Buscar recurso o grupo..."
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none text-[#1B2A41] dark:text-white placeholder-slate-400 w-48 sm:w-60"
                  />
                </div>
              </div>
            </div>

            {/* Tabla Responsive de Auditoría */}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="py-2.5 px-3">Recurso</th>
                    <th className="py-2.5 px-3">Acción Ejecutada</th>
                    <th className="py-2.5 px-3">Fecha</th>
                    <th className="py-2.5 px-3 text-right">Costo Pre (30d)</th>
                    <th className="py-2.5 px-3 text-right">Costo Post (30d)</th>
                    <th className="py-2.5 px-3 text-right">Ahorro Mensual</th>
                    <th className="py-2.5 px-3 text-center">Estado Rebote</th>
                    <th className="py-2.5 px-3 text-center">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {pagedVerifications.length > 0 ? (
                    pagedVerifications.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-[#1B2A41] dark:text-white truncate max-w-[200px]" title={item.resourceName}>
                            {item.resourceName}
                          </div>
                          <div className="text-[10px] text-slate-400">{item.resourceGroup}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                          {item.actionType}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                          {item.executedDate}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-slate-600 dark:text-slate-400">
                          ${item.costPre30d.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-slate-600 dark:text-slate-400">
                          ${item.costPost30d.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-[#10B981]">
                          +${item.realizedMonthlySavings.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.reboundStatus === "verified_optimal"
                                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40"
                                : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40"
                            }`}
                          >
                            {item.reboundStatus === "verified_optimal" ? "Óptimo" : "Revisar"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => setSelectedAuditItem(item)}
                            className="px-2 py-1 text-[11px] font-bold text-[#0078D4] hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md transition cursor-pointer"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        No se encontraron registros de auditoría para este período.
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
                <IconHistory className="w-5 h-5 text-[#0078D4] bg-transparent" stroke={1.8} />
                Detalle de Auditoría Before / After
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
                <div className="text-slate-500">Grupo: {selectedAuditItem.resourceGroup}</div>
                <div className="text-slate-500">Ejecutado por: {selectedAuditItem.executedBy}</div>
                <div className="text-slate-500">Fecha: {selectedAuditItem.executedDate}</div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase">Costo Pre</span>
                  <div className="font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                    ${selectedAuditItem.costPre30d.toFixed(2)}
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase">Costo Post</span>
                  <div className="font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                    ${selectedAuditItem.costPost30d.toFixed(2)}
                  </div>
                </div>
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg">
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase">Ahorro</span>
                  <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    +${selectedAuditItem.realizedMonthlySavings.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                <span className="font-bold text-[#0078D4] block mb-1">Diagnóstico de Rebote:</span>
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
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
