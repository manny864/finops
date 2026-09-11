"use client";

/**
 * AzureAISearch — "AI Search" sub-tab within the Azure AI module.
 *
 * Architecture:
 *   1. Header with sync banner
 *   2. 4 KPI cards (Monthly Cost, Search Units, Indexes & Docs, Potential Savings)
 *   3. SKU breakdown donut chart (blue scale)
 *   4. Per-service detail table (CMP standard: filters, sort, pagination, resize)
 *   5. Prioritized remediation actions
 *
 * Design system:
 *   - Tabler Icons only, blue corporate (#0078D4), no background on icons
 *   - White cards with border-slate-200
 *   - Blue-scale palette for charts
 *   - z-50 modals, z-40 widgets
 *   - Mock-first: isMockTenant -> no OAuth required
 *   - Real tenant: zero tolerance for mock fallbacks
 */

import React, { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { useTextoPorCategoria } from "@/lib/recommendationText";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import MockBanner from "@/components/MockBanner";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import {
  IconSearch,
  IconCpu,
  IconDatabase,
  IconSparkles,
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
  IconArrowsSort,
  IconCash,
  IconTrendingDown,
  IconX,
  IconFilter,
  IconChartBar,
  IconBulb,
  IconExclamationCircle,
  IconTrash,
  IconAdjustmentsHorizontal,
} from "@tabler/icons-react";
import type {
  AiSearchPayload,
  AiSearchServiceItem,
  AiSearchSummary,
  AiSearchRemediationAction,
} from "@/types/azureAiSearch.types";

// ── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZES = [15, 30, 45, 60] as const;

const SKU_DISPLAY: Record<string, string> = {
  Free: "Free",
  Basic: "Basic",
  Standard: "Standard S1",
  Standard2: "Standard S2",
  Standard3: "Standard S3",
  StorageOptimizedL1: "Storage Optimized L1",
  StorageOptimizedL2: "Storage Optimized L2",
};

const SEMANTIC_BADGE_CLASSES: Record<string, string> = {
  standard: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  free: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  disabled: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const SEMANTIC_LABELS: Record<string, string> = {
  standard: "Standard",
  free: "Free",
  disabled: "Desactivado",
};

// ── Sub-components ──────────────────────────────────────────────────────────

/** Skeleton loader while data is fetching. */
function SearchSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-xl" />
      <div className="h-96 bg-slate-100 dark:bg-slate-800 rounded-xl" />
    </div>
  );
}

/** Error state with retry button. */
function SearchError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations("AzureAI");
  const textoRem = useTextoPorCategoria("AzureAI", "SEARCH");
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <IconExclamationCircle className="w-12 h-12 text-red-400" />
      <p className="text-slate-600 dark:text-slate-400 text-sm">{message}</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
      >
        {t("retry")}
      </button>
    </div>
  );
}

/** Empty state when no search services exist. */
function SearchEmptyState() {
  const t = useTranslations("AzureAI");
  const textoRem = useTextoPorCategoria("AzureAI", "SEARCH");
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <IconSearch className="w-16 h-16 text-slate-300 dark:text-slate-600" />
      <h3 className="text-lg font-semibold text-[#1B2A41] dark:text-slate-200">
        {t("search_empty_title")}
      </h3>
      <p className="text-sm text-slate-500 max-w-md">
        {t("search_empty_description")}
      </p>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function AzureAISearch() {
  const t = useTranslations("AzureAI");
  const tc = useTranslations("Common");
  const textoRem = useTextoPorCategoria("AzureAI", "SEARCH");
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const { instance } = useMsal();

  // Data fetching
  const fetcher = useCallback(async () => {
    if (!tenantId) return null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!isMockTenant(tenantId) && instance) {
      try {
        const accounts = instance.getAllAccounts();
        if (accounts.length > 0) {
          const token = await getFreshIdToken(instance, accounts[0]);
          if (token) headers["Authorization"] = `Bearer ${token}`;
        }
      } catch { /* continue without auth header */ }
    }
    const res = await fetch(
      `/api/intelligence/azure-ai/search?tenantId=${encodeURIComponent(tenantId)}`,
      { headers }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<AiSearchPayload>;
  }, [tenantId, instance]);

  const { data, error, isLoading, mutate } = useSWR(
    tenantId ? `ai-search-${tenantId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 120_000 }
  );

  // State
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(15);
  const [sortKey, setSortKey] = useState<keyof AiSearchServiceItem>("monthlyCostUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterSku, setFilterSku] = useState<string>("all");
  const [filterRg, setFilterRg] = useState<string>("all");
  const [filterSub, setFilterSub] = useState<string>("all");
  const [selectedService, setSelectedService] = useState<AiSearchServiceItem | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [chartMounted, setChartMounted] = useState(false);

  React.useEffect(() => { setChartMounted(true); }, []);

  // Derived data
  const summary: AiSearchSummary | null = data?.summary ?? null;
  const allServices = useMemo<AiSearchServiceItem[]>(
    () => data?.services ?? [],
    [data?.services]
  );
  const remediationActions: AiSearchRemediationAction[] = data?.remediationActions ?? [];

  // Filters
  const uniqueSkus = useMemo(() => {
    const set = new Set(allServices.map((s) => s.skuName));
    return Array.from(set).sort();
  }, [allServices]);

  const uniqueRgs = useMemo(() => {
    const set = new Set(allServices.map((s) => s.resourceGroup));
    return Array.from(set).sort();
  }, [allServices]);

  const uniqueSubs = useMemo(() => {
    const set = new Set(allServices.map((s) => s.subscriptionName));
    return Array.from(set).sort();
  }, [allServices]);

  // Filtered & sorted
  const filteredServices = useMemo(() => {
    let list = [...allServices];
    if (filterSku !== "all") list = list.filter((s) => s.skuName === filterSku);
    if (filterRg !== "all") list = list.filter((s) => s.resourceGroup === filterRg);
    if (filterSub !== "all") list = list.filter((s) => s.subscriptionName === filterSub);

    list.sort((a, b) => {
      let cmp = 0;
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        // Numeric strings (cost)
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          cmp = aNum - bNum;
        } else {
          cmp = aVal.localeCompare(bVal);
        }
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (typeof aVal === "boolean" && typeof bVal === "boolean") {
        cmp = aVal === bVal ? 0 : aVal ? 1 : -1;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [allServices, filterSku, filterRg, filterSub, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / pageSize));
  const pagedServices = filteredServices.slice(page * pageSize, (page + 1) * pageSize);

  // Handlers
  const handleSort = (key: keyof AiSearchServiceItem) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  const openDetail = (service: AiSearchServiceItem) => {
    setSelectedService(service);
    setShowDetailModal(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return <SearchSkeleton />;
  if (error) return <SearchError message={error.message || "Error loading data"} onRetry={() => mutate()} />;
  if (!data || allServices.length === 0) return <SearchEmptyState />;

  return (
    <div className="space-y-6">
      <MockBanner />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconSearch className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          <h2 className="text-lg font-semibold text-[#1B2A41] dark:text-slate-200">
            {t("tab_search")}
          </h2>
          <InfoTooltip
            content={t("tooltip_tab_search")}
            position="bottom"
            align="left"
          />
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
        >
          <IconRefresh className="w-3.5 h-3.5" stroke={1.5} />
          {t("btn_sync")}
        </button>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Monthly Cost */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <IconCash className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t("current_cost_mtd")}
            </span>
            <InfoTooltip content={t("search_kpi_cost_tooltip")} />
          </div>
          <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
            ${Number(summary?.currentCostMtdUSD || summary?.totalMonthlyCostUSD || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {t("search_activeResources", { count: summary?.totalServicesCount ?? 0 })}
          </div>
        </div>

        {/* Card 2: Search Units */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <IconCpu className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t("search_units")}
            </span>
            <InfoTooltip content={t("search_kpi_su_tooltip")} />
          </div>
          <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
            {summary?.totalSearchUnits ?? 0}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            QPS promedio: {summary?.avgQps?.toFixed(1) ?? "0.0"} | Latencia: {summary?.avgLatencyMs?.toFixed(0) ?? "0"} ms
          </div>
        </div>

        {/* Card 3: Indexes & Documents */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <IconDatabase className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t("search_kpi_indexes_docs")}
            </span>
            <InfoTooltip content={t("search_kpi_index_tooltip")} />
          </div>
          <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
            {summary?.totalIndexesCount ?? 0}
            <span className="text-lg font-normal text-slate-400"> {t("search_indexes")}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {(summary?.totalDocumentsCount ?? 0).toLocaleString()} documentos
          </div>
        </div>

        {/* Card 4: Potential Savings */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t("search_potential_savings")}
            </span>
            <InfoTooltip content={t("search_savings_tooltip")} />
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            ${Number(summary?.potentialSavingsUSD || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {t("search_recommendedActions", { count: remediationActions.length })}
          </div>
        </div>
      </div>

      {/* ── SKU Breakdown Chart ─────────────────────────────────────────── */}
      {chartMounted && summary && summary.breakdownBySku.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <IconChartBar className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
              {t("search_spend_by_sku")}
            </h3>
            <InfoTooltip content={t("search_spend_by_sku_tooltip")} />
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={summary.breakdownBySku}
                dataKey="percentage"
                nameKey="sku"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                paddingAngle={2}
              >
                {summary.breakdownBySku.map((entry, i) => (
                  <Cell key={i} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <RechartsTooltip
                {...TOOLTIP_TEMA}
                formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name ?? "")]}
              />
              <Legend
                formatter={(value: string) => (
                  <span className="text-xs text-slate-600 dark:text-slate-400">{SKU_DISPLAY[value] || value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <IconFilter className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{t("srch_filters")}</span>
        </div>
        <select
          value={filterSku}
          onChange={(e) => { setFilterSku(e.target.value); setPage(0); }}
          className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300"
        >
          <option value="all">{t("search_all_skus")}</option>
          {uniqueSkus.map((sku) => (
            <option key={sku} value={sku}>{SKU_DISPLAY[sku] || sku}</option>
          ))}
        </select>
        <select
          value={filterRg}
          onChange={(e) => { setFilterRg(e.target.value); setPage(0); }}
          className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300"
        >
          <option value="all">{t("search_all_groups")}</option>
          {uniqueRgs.map((rg) => (
            <option key={rg} value={rg}>{rg}</option>
          ))}
        </select>
        <select
          value={filterSub}
          onChange={(e) => { setFilterSub(e.target.value); setPage(0); }}
          className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300"
        >
          <option value="all">{t("search_all_subscriptions")}</option>
          {uniqueSubs.map((sub) => (
            <option key={sub} value={sub}>{sub}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-slate-400">{filteredServices.length} resultados</span>
        </div>
      </div>

      {/* ── Services Table ──────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                <ResizableTh className="px-3 py-2.5 text-left font-semibold text-[#1B2A41] dark:text-slate-200 cursor-pointer" onClick={() => handleSort("name")}>
                  <div className="flex items-center gap-1">
                    {t("resource_name")}
                    {sortKey === "name" && <IconArrowsSort className="w-3 h-3" />}
                  </div>
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-left font-semibold text-[#1B2A41] dark:text-slate-200 cursor-pointer" onClick={() => handleSort("skuName")}>
                  <div className="flex items-center gap-1">
                    SKU / Tier
                    {sortKey === "skuName" && <IconArrowsSort className="w-3 h-3" />}
                  </div>
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-center font-semibold text-[#1B2A41] dark:text-slate-200 cursor-pointer" onClick={() => handleSort("searchUnits")}>
                  <div className="flex items-center justify-center gap-1">
                    Search Units
                    {sortKey === "searchUnits" && <IconArrowsSort className="w-3 h-3" />}
                  </div>
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-center font-semibold text-[#1B2A41] dark:text-slate-200">
                  Semantic Ranker
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-center font-semibold text-[#1B2A41] dark:text-slate-200 cursor-pointer" onClick={() => handleSort("qpsAvg")}>
                  <div className="flex items-center justify-center gap-1">
                    QPS / Latencia
                    {sortKey === "qpsAvg" && <IconArrowsSort className="w-3 h-3" />}
                  </div>
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-center font-semibold text-[#1B2A41] dark:text-slate-200 cursor-pointer" onClick={() => handleSort("storageUsedGB")}>
                  <div className="flex items-center justify-center gap-1">
                    {t("srch_storage")}
                    {sortKey === "storageUsedGB" && <IconArrowsSort className="w-3 h-3" />}
                  </div>
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-left font-semibold text-[#1B2A41] dark:text-slate-200">
                  {t("resource_group")}
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-left font-semibold text-[#1B2A41] dark:text-slate-200">
                  {t("col_subscription")}
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-right font-semibold text-[#1B2A41] dark:text-slate-200 cursor-pointer" onClick={() => handleSort("monthlyCostUSD")}>
                  <div className="flex items-center justify-end gap-1">
                    {t("resource_cost")}
                    {sortKey === "monthlyCostUSD" && <IconArrowsSort className="w-3 h-3" />}
                  </div>
                </ResizableTh>
                <ResizableTh className="px-3 py-2.5 text-center font-semibold text-[#1B2A41] dark:text-slate-200" minWidth={80}>
                  {tc("actions")}
                </ResizableTh>
              </tr>
            </thead>
            <tbody>
              {pagedServices.map((svc) => (
                <tr
                  key={svc.id}
                  className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                  onClick={() => openDetail(svc)}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <IconSearch className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" stroke={1.5} />
                      <span className="font-medium text-[#1B2A41] dark:text-slate-200 truncate">{svc.name}</span>
                      {svc.isDevOrTest && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 rounded">
                          DEV
                        </span>
                      )}
                      {svc.isOrphan && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded">
                          {t("search_badge_orphan_upper")}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{svc.location}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[#1B2A41] dark:text-slate-200">{SKU_DISPLAY[svc.skuName] || svc.skuName}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded text-[11px] font-medium">
                      {svc.searchUnits} SU
                      <span className="text-[10px] text-blue-400">[{svc.partitionCount}P × {svc.replicaCount}R]</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${SEMANTIC_BADGE_CLASSES[svc.semanticSearchTier] || SEMANTIC_BADGE_CLASSES.disabled}`}>
                      {SEMANTIC_LABELS[svc.semanticSearchTier] || svc.semanticSearchTier}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-[#1B2A41] dark:text-slate-200">
                    {(Number(svc.qpsAvg) || 0).toFixed(1)} QPS
                    <div className="text-[10px] text-slate-400">{(Number(svc.latencyMsAvg) || 0).toFixed(0)} ms</div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-[#1B2A41] dark:text-slate-200">
                    {(Number(svc.storageUsedGB) || 0).toFixed(1)} GB
                    <div className="text-[10px] text-slate-400">{(Number(svc.documentsCount) || 0).toLocaleString()} docs</div>
                  </td>
                  <td className="px-3 py-2.5 text-[#1B2A41] dark:text-slate-200 truncate">{svc.resourceGroup}</td>
                  <td className="px-3 py-2.5 text-[#1B2A41] dark:text-slate-200 truncate">{svc.subscriptionName}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#1B2A41] dark:text-slate-200 font-medium">
                    ${(Number(svc.currentCostMtdUSD ?? svc.monthlyCostUSD) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); openDetail(svc); }}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 rounded-lg text-[11px] font-medium hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                    >
                      <IconSparkles className="w-3 h-3" stroke={1.5} />
                      Optimizar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filteredServices.length > 15 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t("srch_show")}</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs text-slate-700 dark:text-slate-300"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span className="text-xs text-slate-500">{t("search_per_page")}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <IconChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              </button>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {page + 1} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <IconChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Remediation Actions ─────────────────────────────────────────── */}
      {remediationActions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <IconBulb className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
              {t("search_recommendations")}
            </h3>
            <InfoTooltip content={t("search_recommendations_tooltip")} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {remediationActions.map((action) => (
              <div
                key={action.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 hover:border-[#0078D4]/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {action.category === "DOWNGRADE_TIER" && (
                      <IconTrendingDown className="w-5 h-5 text-amber-500" stroke={1.5} />
                    )}
                    {action.category === "ORPHAN_SERVICE" && (
                      <IconTrash className="w-5 h-5 text-red-500" stroke={1.5} />
                    )}
                    {action.category === "REDUCE_REPLICAS" && (
                      <IconAdjustmentsHorizontal className="w-5 h-5 text-blue-500" stroke={1.5} />
                    )}
                    {action.category === "SEMANTIC_RANKER_AUDIT" && (
                      <IconSearch className="w-5 h-5 text-sky-500" stroke={1.5} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200 truncate">
                        {textoRem(action, "title")}
                      </h4>
                      <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        action.confidence === "HIGH"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      }`}>
                        {action.confidence === "HIGH" ? t("highConfidence") : t("mediumConfidence")}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">
                      {textoRem(action, "desc")}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        {t("search_savings_month", { amount: Number(action.estimatedSavingsUSD).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                      </span>
                      <span className="text-[10px] text-slate-400">{action.serviceName}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Detail Modal ────────────────────────────────────────────────── */}
      {showDetailModal && selectedService && (
        <ServiceDetailModal
          service={selectedService}
          onClose={() => setShowDetailModal(false)}
        />
      )}
    </div>
  );
}

// ── Service Detail Modal ────────────────────────────────────────────────────

function ServiceDetailModal({
  service,
  onClose,
}: {
  service: AiSearchServiceItem;
  onClose: () => void;
}) {
  const t = useTranslations("AzureAI");
  const textoRem = useTextoPorCategoria("AzureAI", "SEARCH");
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      {/* Modal */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl z-[100] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSearch className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-base font-semibold text-[#1B2A41] dark:text-slate-200 truncate">
              {service.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <IconX className="w-5 h-5 text-slate-500" stroke={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
              <div className="text-[10px] text-slate-400 uppercase mb-1">SKU</div>
              <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
                {SKU_DISPLAY[service.skuName] || service.skuName}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
              <div className="text-[10px] text-slate-400 uppercase mb-1">Search Units</div>
              <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
                {service.searchUnits} SU [{service.partitionCount}P × {service.replicaCount}R]
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
              <div className="text-[10px] text-slate-400 uppercase mb-1">{t("col_monthly_cost_label")}</div>
              <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
                ${Number(service.monthlyCostUSD).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
              <div className="text-[10px] text-slate-400 uppercase mb-1">Semantic Ranker</div>
              <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
                {SEMANTIC_LABELS[service.semanticSearchTier] || service.semanticSearchTier}
              </div>
            </div>
          </div>

          {/* Performance */}
          <div>
            <h4 className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 mb-3 uppercase tracking-wide">
              {t("srch_perf")}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("srch_avgQps")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">{(Number(service.qpsAvg) || 0).toFixed(2)}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("srch_peakQps")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">{(Number(service.qpsPeak) || 0).toFixed(2)}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("srch_latency")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">{(Number(service.latencyMsAvg) || 0).toFixed(0)} ms</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("srch_throttling")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">{(Number(service.throttleRatePct) || 0).toFixed(1)}%</div>
              </div>
            </div>
          </div>

          {/* Storage */}
          <div>
            <h4 className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 mb-3 uppercase tracking-wide">
              {t("srch_storage")}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("srch_storage")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">{(Number(service.storageUsedGB) || 0).toFixed(1)} GB</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("srch_documents")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">{(Number(service.documentsCount) || 0).toLocaleString()}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("search_indexes")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">{service.indexCount}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase mb-1">{t("search_public_network")}</div>
                <div className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
                  {service.publicNetworkAccess ? "Habilitada" : "Privada"}
                </div>
              </div>
            </div>
          </div>

          {/* Location */}
          <div>
            <h4 className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 mb-3 uppercase tracking-wide">
              {t("search_location")}
            </h4>
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">{t("search_region")}</span>
                <span className="text-[#1B2A41] dark:text-slate-200 font-medium">{service.location}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">{t("col_resource_group")}</span>
                <span className="text-[#1B2A41] dark:text-slate-200 font-medium">{service.resourceGroup}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">{t("col_subscription")}</span>
                <span className="text-[#1B2A41] dark:text-slate-200 font-medium">{service.subscriptionName}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}