"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconMicrophone,
  IconVolume,
  IconLanguage,
  IconRotateClockwise,
  IconExternalLink,
  IconSparkles,
  IconCheck,
  IconAlertTriangle,
  IconLoader2,
  IconInfoCircle,
  IconChevronDown,
  IconChevronUp,
  IconFilter,
} from "@tabler/icons-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import type {
  SpeechLanguagePayload,
  SpeechLanguageResource,
} from "@/types/azureSpeechLanguage.types";

// ─── Paleta azul corporativa ───
const CATEGORY_COLORS: Record<string, string> = {
  CUSTOM_VOICE_UNPUBLISH: "#0078D4",
  DEV_F0_DOWNGRADE: "#2563EB",
  WHISPER_ARBITRAGE: "#0284C7",
  NLP_BATCHING: "#38BDF8",
};

const CATEGORY_LABELS: Record<string, string> = {
  CUSTOM_VOICE_UNPUBLISH: "Custom Voice Unpublish",
  DEV_F0_DOWNGRADE: "Dev F0 Downgrade",
  WHISPER_ARBITRAGE: "Whisper Arbitrage",
  NLP_BATCHING: "NLP Batching",
};

// ─── Fetcher ───
function buildFetcher(instance: any, accounts: any[], isDemo: boolean) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isDemo && accounts[0]) {
      headers.Authorization = `Bearer ${await getFreshIdToken(instance, accounts[0])}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return res.json();
  };
}

// ─── KPI Card ───
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string; stroke?: number }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex items-center gap-3">
      <Icon className="w-6 h-6 text-[#0078D4] shrink-0" stroke={1.5} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 truncate">
          {label}
        </p>
        <p className="text-xl font-extrabold text-[#1B2A41] dark:text-slate-100 truncate">
          {value}
        </p>
        <p className="text-[11px] text-slate-400 truncate">{sub}</p>
      </div>
    </div>
  );
}

// ─── Empty State ───
function EmptyState({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
  const t = useTranslations("AzureAI");
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-heading">
              Azure AI Speech & Language
            </h3>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900/50 px-2 py-0.5 rounded-full">
              <IconCheck className="w-3 h-3" />
              {t("status_ready")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Transcripción de voz a texto, traducción en tiempo real y procesamiento de lenguaje natural.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            <IconRotateClockwise className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} stroke={2} />
            {t("btn_sync")}
          </button>
          <a
            href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0054A6] hover:bg-[#004080] rounded-lg transition-colors shadow-xs"
          >
            <IconExternalLink className="w-3.5 h-3.5" />
            Azure Portal
          </a>
        </div>
      </div>

      <div className="bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-900/80 dark:to-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-8 text-center shadow-xs">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#0054A6] mb-4">
          <IconSparkles className="w-7 h-7" />
        </div>
        <h4 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 mb-1.5">
          {t("empty_title")}
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
          {t("empty_description")}
        </p>
        <div className="mt-6 pt-6 border-t border-slate-200/70 dark:border-slate-800 text-left">
          <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-4 text-center">
            {t("quick_guide_title")}
          </h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((step) => (
              <div key={step} className="bg-white dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/50 text-[#0054A6] flex items-center justify-center text-xs font-bold">
                    {step}
                  </span>
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                    {t(`step${step}_title`)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t(`step${step}_desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───
export default function SpeechLanguageDashboard() {
  const t = useTranslations("AzureAI");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const { format } = useCurrency();

  const tenantId = selectedTenant?.id;
  const isDemo = Boolean(tenantId && isMockTenant(tenantId));
  const canFetch = !!tenantId && tenantId !== "default" && (accounts.length > 0 || isDemo);

  const [timeRange, setTimeRange] = useState<"MTD" | "30D" | "90D">("MTD");
  const [filterService, setFilterService] = useState("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState("ALL");
  const [filterSubscription, setFilterSubscription] = useState("ALL");
  const [sortKey, setSortKey] = useState<keyof SpeechLanguageResource>("totalCostUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, isDemo),
    [instance, accounts, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/azure-ai/speech-language?tenantId=${encodeURIComponent(tenantId!)}&timeRange=${timeRange}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<SpeechLanguagePayload>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false }
  );

  const isRefreshing = isLoading;

  // ─── Loading ───
  if (!selectedTenant || selectedTenant.id === "default") return null;
  if (isLoading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] mb-4" stroke={1.5} />
        <p className="text-slate-500">Cargando Speech & Language...</p>
      </div>
    );
  }

  // ─── Empty state (real tenant, no data) ───
  if (!isDemo && (!data || data.resources.length === 0) && !isLoading) {
    return <EmptyState onRefresh={() => mutate()} isRefreshing={isRefreshing} />;
  }

  // ─── Error ───
  if (error && !data) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
        <h3 className="font-bold flex items-center gap-2">
          <IconAlertTriangle className="w-4 h-4" /> Error
        </h3>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  const { summary, resources, dailyTrend, remediationActions } = data;

  // ─── Filters ───
  const serviceOptions = ["ALL", ...new Set(resources.map((r) => r.kind))];
  const rgOptions = ["ALL", ...new Set(resources.map((r) => r.resourceGroup))];
  const subOptions = ["ALL", ...new Set(resources.map((r) => r.subscriptionName))];

  const filteredResources = resources
    .filter((r) => filterService === "ALL" || r.kind === filterService)
    .filter((r) => filterResourceGroup === "ALL" || r.resourceGroup === filterResourceGroup)
    .filter((r) => filterSubscription === "ALL" || r.subscriptionName === filterSubscription);

  // ─── Sort ───
  const sortedResources = [...filteredResources].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    }
    const aStr = String(aVal ?? "");
    const bStr = String(bVal ?? "");
    return sortDir === "desc" ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
  });

  // ─── Pagination ───
  const totalPages = Math.max(1, Math.ceil(sortedResources.length / pageSize));
  const paginatedResources = sortedResources.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (key: keyof SpeechLanguageResource) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortIcon = ({ column }: { column: keyof SpeechLanguageResource }) => {
    if (sortKey !== column) return null;
    return sortDir === "desc" ? (
      <IconChevronDown className="w-3 h-3 inline ml-1" />
    ) : (
      <IconChevronUp className="w-3 h-3 inline ml-1" />
    );
  };

  // ─── Donut data ───
  const donutData = summary.breakdownByService.map((s) => ({
    name: s.serviceName,
    value: s.costUSD,
    color: s.color,
  }));

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900/50 px-2.5 py-1 rounded-full">
            <IconCheck className="w-3 h-3" />
            {t("status_monitoring_active")}
          </span>
          {data.source === "mock" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/80 px-2 py-0.5 rounded-full">
              <IconInfoCircle className="w-3 h-3" />
              Demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as "MTD" | "30D" | "90D")}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            <option value="MTD">MTD</option>
            <option value="30D">30 Días</option>
            <option value="90D">90 Días</option>
          </select>
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            <IconRotateClockwise className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} stroke={2} />
            {t("btn_sync")}
          </button>
          <a
            href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0054A6] hover:bg-[#004080] rounded-lg transition-colors shadow-xs"
          >
            <IconExternalLink className="w-3.5 h-3.5" />
            Azure Portal
          </a>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={IconCash}
          label={t("kpi_monthly_cost_mtd")}
          value={format(summary.totalCostUSD)}
          sub={t("kpi_monthly_cost_sub")}
        />
        <KpiCard
          icon={IconMicrophone}
          label={t("kpi_audio_hours_stt")}
          value={`${summary.totalAudioHours.toFixed(1)} h`}
          sub={t("kpi_audio_hours_sub")}
        />
        <KpiCard
          icon={IconVolume}
          label={t("kpi_chars_synthesized_tts")}
          value={`${(summary.totalCharactersTTS / 1_000_000).toFixed(1)}M chars`}
          sub={t("kpi_chars_synthesized_sub")}
        />
        <KpiCard
          icon={IconLanguage}
          label={t("kpi_text_records_nlp")}
          value={`${(summary.totalTextRecordsNLP / 1000).toFixed(0)}K Records`}
          sub={t("kpi_text_records_sub")}
        />
      </div>

      {/* ─── Fila 1: Gráficas ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut: Distribución de Gasto por Servicio */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">
            {t("chart_spend_by_service")}
          </h3>
          <div className="flex items-center gap-4">
            <div className="w-48 h-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => format(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              {donutData.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-xs text-slate-600 dark:text-slate-400 truncate flex-1">
                    {s.name}
                  </span>
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                    {format(s.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Área: Evolución Diaria */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">
            {t("chart_daily_evolution")}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyTrend}>
              <defs>
                <linearGradient id="audioGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0078D4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#0078D4" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="ttsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="audioHours"
                stroke="#0078D4"
                strokeWidth={2}
                fill="url(#audioGrad)"
                name="Audio (h)"
              />
              <Area
                type="monotone"
                dataKey="charsTTSMillions"
                stroke="#2563EB"
                strokeWidth={2}
                fill="url(#ttsGrad)"
                name="TTS (M chars)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── Fila 2: Tabla de Recursos ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t("table_resource_breakdown")}
          </h3>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
          <IconFilter className="w-4 h-4 text-slate-400" stroke={1.5} />
          <select
            value={filterService}
            onChange={(e) => { setFilterService(e.target.value); setPage(1); }}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            {serviceOptions.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? t("filter_all_services") : s}
              </option>
            ))}
          </select>
          <select
            value={filterResourceGroup}
            onChange={(e) => { setFilterResourceGroup(e.target.value); setPage(1); }}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            {rgOptions.map((rg) => (
              <option key={rg} value={rg}>
                {rg === "ALL" ? t("filter_all_rg") : rg}
              </option>
            ))}
          </select>
          <select
            value={filterSubscription}
            onChange={(e) => { setFilterSubscription(e.target.value); setPage(1); }}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            {subOptions.map((sub) => (
              <option key={sub} value={sub}>
                {sub === "ALL" ? t("filter_all_subscriptions") : sub}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400 ml-auto">
            {filteredResources.length} {t("resources_count_label")}
          </span>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
              <tr>
                {([
                  ["name", t("col_resource")],
                  ["kind", t("col_capability")],
                  ["audioHoursProcessed", t("col_volume")],
                  ["customVoiceEndpointsCount", t("col_custom_endpoints")],
                  ["resourceGroup", t("col_resource_group")],
                  ["subscriptionName", t("col_subscription")],
                  ["totalCostUSD", t("col_monthly_cost")],
                ] as [keyof SpeechLanguageResource, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    className="px-4 py-3 text-left font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-[#0078D4] transition-colors"
                    onClick={() => handleSort(key)}
                  >
                    {label}
                    <SortIcon column={key} />
                  </th>
                ))}
                <th className="px-4 py-3 text-left font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t("col_actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedResources.map((resource) => {
                const isSpeech =
                  resource.kind === "SpeechServices" || resource.kind === "AIServices";
                const Icon = isSpeech ? IconMicrophone : IconLanguage;
                const volumeLabel = isSpeech
                  ? `${resource.audioHoursProcessed.toFixed(1)} h`
                  : resource.kind === "TextTranslation"
                    ? `${(resource.charactersTranslated / 1_000_000).toFixed(1)}M`
                    : `${(resource.textRecordsProcessed / 1000).toFixed(0)}K`;

                return (
                  <tr
                    key={resource.id}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-950/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                        <div>
                          <p className="font-semibold text-[#1B2A41] dark:text-slate-200 truncate max-w-[180px]">
                            {resource.name}
                          </p>
                          <span className="text-[10px] text-slate-400">{resource.location}</span>
                        </div>
                        <span
                          className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            resource.skuName === "F0"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-blue-50 text-[#0078D4] dark:bg-blue-950/40"
                          }`}
                        >
                          {resource.skuName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {resource.kind}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {volumeLabel}
                    </td>
                    <td className="px-4 py-3">
                      {resource.customVoiceEndpointsCount > 0 ? (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            resource.isOrphan
                              ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                              : "bg-blue-50 text-[#0078D4] dark:bg-blue-950/40"
                          }`}
                        >
                          {resource.customVoiceEndpointsCount}
                          {resource.isOrphan && (
                            <IconAlertTriangle className="w-3 h-3" />
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {resource.resourceGroup}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-[140px] truncate">
                      {resource.subscriptionName}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200">
                      {format(resource.totalCostUSD)}
                    </td>
                    <td className="px-4 py-3">
                      <button className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer">
                        <IconSparkles className="w-3 h-3" stroke={2} />
                        {t("btn_optimize")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div className="px-5 py-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{t("pagination_rows")}:</span>
            {[15, 30, 45, 60].map((size) => (
              <button
                key={size}
                onClick={() => { setPageSize(size); setPage(1); }}
                className={`px-2 py-0.5 text-[11px] rounded ${
                  pageSize === size
                    ? "bg-[#0078D4] text-white font-bold"
                    : "text-slate-500 hover:text-[#0078D4]"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-0.5 text-[11px] text-slate-500 hover:text-[#0078D4] disabled:opacity-30"
            >
              ←
            </button>
            <span className="text-[11px] text-slate-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-0.5 text-[11px] text-slate-500 hover:text-[#0078D4] disabled:opacity-30"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {/* ─── Fila 3: Recomendaciones ─── */}
      {remediationActions.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">
            {t("section_remediation_actions")}
          </h3>
          <div className="space-y-3">
            {remediationActions.map((action) => (
              <div
                key={action.id}
                className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 hover:border-[#0078D4]/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[action.category] || "#0078D4"}15`,
                      }}
                    >
                      <IconSparkles
                        className="w-4 h-4"
                        style={{ color: CATEGORY_COLORS[action.category] || "#0078D4" }}
                        stroke={1.5}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-200">
                          {action.title}
                        </p>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            action.confidence === "HIGH"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          {action.confidence === "HIGH" ? "Alta confianza" : "Media confianza"}
                        </span>
                        <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          {CATEGORY_LABELS[action.category] || action.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {expandedAction === action.id
                          ? action.description
                          : action.description.slice(0, 120) + "…"}
                      </p>
                      {action.description.length > 120 && (
                        <button
                          onClick={() =>
                            setExpandedAction(
                              expandedAction === action.id ? null : action.id
                            )
                          }
                          className="text-[10px] text-[#0078D4] hover:underline mt-1 cursor-pointer"
                        >
                          {expandedAction === action.id ? "Mostrar menos" : "Leer más"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-extrabold text-[#0078D4]">
                      {format(action.estimatedSavingsUSD)}
                    </p>
                    <p className="text-[10px] text-slate-400">/mes ahorro</p>
                    <button className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer">
                      <IconSparkles className="w-3 h-3" stroke={2} />
                      {t("btn_optimize")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}