"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconCash,
  IconShieldCheck,
  IconAward,
  IconShieldX,
  IconRotateClockwise,
  IconSearch,
  IconDatabaseExport,
  IconTerminal2,
  IconX,
  IconCheck,
  IconCopy,
  IconAlertTriangle,
  IconServer,
  IconDatabase,
  IconBox,
  IconWorldWww,
  IconKey,
  IconCloudLock,
  IconShield,
  IconSparkles,
} from "@tabler/icons-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend } from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildDefenderRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import type {
  DefenderPayload,
  DefenderPlanCategory,
  DefenderPlanItem,
  DefenderRemediationAction,
} from "@/types/azureDefender.types";

/**
 * Scrollbar horizontal siempre visible. En macOS los scrollbars son overlay y
 * desaparecen al no scrollear, de modo que el usuario no descubre que la tabla
 * continua a la derecha. Estas utilidades la fuerzan a mostrarse.
 */
const VISIBLE_SCROLLBAR =
  "overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.300)_theme(colors.slate.100)] " +
  "dark:[scrollbar-color:theme(colors.slate.600)_theme(colors.slate.800)] " +
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full " +
  "[&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 " +
  "[&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

const CATEGORY_ICONS: Record<DefenderPlanCategory, React.ComponentType<{ className?: string; stroke?: number }>> = {
  Servers: IconServer,
  Databases: IconDatabase,
  Storage: IconBox,
  Containers: IconBox,
  AppServices: IconWorldWww,
  KeyVault: IconKey,
  ResourceManager: IconCloudLock,
  CSPM: IconShield,
  Other: IconShield,
};

// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(instance: IPublicClientApplication, accounts: AccountInfo[], isMock: boolean, t: (k: string) => string) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Se deja propagar el 401 del servidor; no hay mock de rescate.
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("loadError"));
    }
    return res.json();
  };
}

function CoverageBadge({ plan }: { plan: DefenderPlanItem }) {
  const t = useTranslations("DefenderForCloud");
  const map = {
    Full: { label: "Completa", cls: "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400" },
    Partial: { label: "Parcial", cls: "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" },
    None: {
      label: "Sin Cobertura",
      cls: plan.hasUnprotectedProduction
        ? "border-red-300 dark:border-red-800 text-red-700 dark:text-red-400"
        : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400",
    },
  } as const;
  const cfg = map[plan.coverageStatus];
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// ─── Drawer de Recursos Protegidos (z-50) ───
function PlanResourcesDrawer({ plan, onClose }: { plan: DefenderPlanItem | null; onClose: () => void }) {
  const t = useTranslations("DefenderForCloud");
  if (!plan) return null;
  const Icon = CATEGORY_ICONS[plan.category];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <Icon className="w-5 h-5 text-[#0078D4] shrink-0" stroke={1.5} />
              <span className="truncate">{plan.planDisplayName}</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
              {plan.subscriptionName} · Tier {plan.pricingTier}
              {plan.subPlan ? ` (${plan.subPlan === "Plan1" ? "Plan 1" : "Plan 2"})` : ""} ·{" "}
              {formatCurrency(plan.monthlyCostUSD)}/mes
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
            aria-label={t("close")}
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Protegidos</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {plan.coveredResourcesCount}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{t("unprotected")}</div>
              <div
                className={`text-lg font-extrabold ${
                  plan.uncoveredResourcesCount > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-[#1B2A41] dark:text-slate-100"
                }`}
              >
                {plan.uncoveredResourcesCount}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Entorno dominante</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {plan.dominantEnvironment === "Production" ? "Prod" : plan.dominantEnvironment}
              </div>
            </div>
          </div>

          {plan.associatedResources.length === 0 ? (
            <div className="py-8 text-center">
              <IconShield className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("noResourcesOfType")}
                {plan.pricingTier === "Standard"
                  ? " Esta activo en Standard sin nada que proteger: revisar la habilitacion automatica."
                  : ""}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {plan.associatedResources.map((r) => (
                <div
                  key={r.resourceId}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <span className="block text-xs font-bold text-[#1B2A41] dark:text-slate-100 truncate">
                      {r.resourceName}
                    </span>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {r.resourceGroup} · {r.location} · {r.resourceType.split("/").pop()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border bg-white dark:bg-slate-900 ${
                        r.environment === "Production"
                          ? "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
                          : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {r.environment === "Production" ? "Prod" : r.environment === "Staging" ? "Stg" : "Dev"}
                    </span>
                    {plan.subPlan && r.isProtected && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900">
                        {plan.subPlan === "Plan1" ? "Plan 1" : "Plan 2"}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border bg-white dark:bg-slate-900 ${
                        r.isProtected
                          ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                          : r.environment === "Production"
                            ? "border-red-300 dark:border-red-800 text-red-700 dark:text-red-400"
                            : "border-slate-300 dark:border-slate-700 text-slate-500"
                      }`}
                    >
                      {r.isProtected ? t("statusProtected") : t("unprotected")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-400 leading-relaxed">
            {t("tierNote1")}
            {t("tierNote2")}
            {t("tierNote3")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediacion (z-50) ───
function DefenderRemediationModal({
  action,
  onClose,
}: {
  action: DefenderRemediationAction | null;
  onClose: () => void;
}) {
  const t = useTranslations("DefenderForCloud");
  const [copied, setCopied] = useState<"cli" | "ps" | null>(null);
  if (!action) return null;

  const cmd = buildDefenderRemediationCommand(action);
  const isRisk = action.category === "ENABLE_DB_PROTECTION";
  const copy = (text: string, which: "cli" | "ps") => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl p-6 relative z-50 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          aria-label={t("close")}
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          {isRisk ? (
            <IconShieldX className="w-6 h-6 text-red-500" stroke={1.5} />
          ) : (
            <IconTerminal2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          )}
          <div className="pr-8">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{action.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{action.description}</p>
          </div>
        </div>

        <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          {isRisk ? (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t.rich("securityRiskFinding", { b: (c) => <span className="font-bold text-red-600 dark:text-red-400">{c}</span> })}
              {t("increasesSpend")}
            </span>
          ) : (
            <>
              <span className="text-xs text-slate-600 dark:text-slate-400">{t("estimatedMonthlySavings")} </span>
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(action.estimatedSavingsUSD)}
              </span>
            </>
          )}
        </div>

        {([
          ["Azure CLI", cmd.cli, "cli"],
          ["PowerShell", cmd.powershell, "ps"],
        ] as const).map(([label, text, key]) => (
          <div key={key} className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{label}</span>
              <button
                onClick={() => copy(text, key)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white dark:bg-slate-900 transition flex items-center gap-1 cursor-pointer ${
                  copied === key
                    ? "border-emerald-600 text-emerald-600"
                    : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                {copied === key ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                {copied === key ? "Copiado" : "Copiar"}
              </button>
            </div>
            <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-xl font-mono text-[11px] overflow-x-auto border border-slate-800 leading-relaxed whitespace-pre-wrap">
              {text}
            </pre>
          </div>
        ))}

        <p className="text-[10px] text-slate-400 mt-2">
          {t("roleNote1")}
          {t("roleNote2")}
        </p>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function DefenderForCloudPanel() {
  const t = useTranslations("DefenderForCloud");
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const isMock = useMemo(() => {
    return (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    );
  }, [tenantId, searchParams]);

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock, t), [instance, accounts, isMock, t]);

  const apiUrl = `/api/intelligence/defender/details?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<DefenderPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTier, setSelectedTier] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedSub, setSelectedSub] = useState("ALL");
  const [selectedEnv, setSelectedEnv] = useState("ALL");
  const [sortBy, setSortBy] = useState<"cost_desc" | "covered_desc" | "name_asc">("cost_desc");

  const [drawerPlan, setDrawerPlan] = useState<DefenderPlanItem | null>(null);
  const [activeRemediation, setActiveRemediation] = useState<DefenderRemediationAction | null>(null);

  const plansList = useMemo(() => data?.plans || [], [data?.plans]);

  const subscriptions = useMemo(() => {
    const map = new Map<string, string>();
    plansList.forEach((p) => map.set(p.subscriptionId, p.subscriptionName || p.subscriptionId));
    return Array.from(map.entries());
  }, [plansList]);

  const filteredPlans = useMemo(() => {
    return plansList
      .filter((p) => {
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const hit =
            p.planDisplayName.toLowerCase().includes(term) ||
            p.planKey.toLowerCase().includes(term) ||
            (p.subscriptionName || "").toLowerCase().includes(term) ||
            p.associatedResources.some((r) => r.resourceName.toLowerCase().includes(term));
          if (!hit) return false;
        }
        if (selectedTier !== "ALL" && p.pricingTier !== selectedTier) return false;
        if (selectedCategory !== "ALL" && p.category !== selectedCategory) return false;
        if (selectedSub !== "ALL" && p.subscriptionId !== selectedSub) return false;
        if (selectedEnv === "PROD" && p.dominantEnvironment !== "Production") return false;
        if (selectedEnv === "NONPROD" && p.dominantEnvironment === "Production") return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "cost_desc") return b.monthlyCostUSD - a.monthlyCostUSD;
        if (sortBy === "covered_desc") return b.coveredResourcesCount - a.coveredResourcesCount;
        return a.planDisplayName.localeCompare(b.planDisplayName);
      });
  }, [plansList, searchTerm, selectedTier, selectedCategory, selectedSub, selectedEnv, sortBy]);

  const {
    paged: paginatedPlans,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredPlans, 15);

  const handleExportCSV = () => {
    if (filteredPlans.length === 0) return;
    const headers = [
      "Plan",
      "Plan Key",
      "Category",
      "Subscription",
      "Pricing Tier",
      "Sub Plan",
      "Covered Resources",
      "Uncovered Resources",
      "Coverage Status",
      "Dominant Environment",
      "Monthly Cost USD",
    ];
    const rows = filteredPlans.map((p) => [
      `"${p.planDisplayName}"`,
      `"${p.planKey}"`,
      `"${p.category}"`,
      `"${p.subscriptionName}"`,
      `"${p.pricingTier}"`,
      `"${p.subPlan || ""}"`,
      p.coveredResourcesCount,
      p.uncoveredResourcesCount,
      `"${p.coverageStatus}"`,
      `"${p.dominantEnvironment}"`,
      p.monthlyCostUSD.toFixed(2),
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `defender-for-cloud-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    totalMonthlyCostUSD: 0,
    projectedMonthEndCostUSD: 0,
    totalProtectedResources: 0,
    totalEvaluatedResources: 0,
    coveragePercentage: 0,
    totalUnprotectedCriticalResources: 0,
    standardPlansCount: 0,
    evaluatedPlansCount: 0,
    potentialSavingsUSD: 0,
    breakdownByPlan: [],
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconShieldCheck className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("pageTitle")}</span>
              <InfoTooltip
                content={t("pageTooltip")}
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Microsoft.Security API" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" />
            Exportar CSV
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} />
            {t("refreshTelemetry")}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 Tarjetas KPI ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiMonthlyCost")}</span>
              <InfoTooltip content={t("kpiMonthlyCostTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.totalMonthlyCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Proyeccion fin de mes: {formatCurrency(summary.projectedMonthEndCostUSD)}
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiProtected")}</span>
              <InfoTooltip content={t("kpiProtectedTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalProtectedResources}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.coveragePercentage}% de {summary.totalEvaluatedResources} evaluados
            </div>
          </div>
          <IconShieldCheck className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Planes en Tier Standard</span>
              <InfoTooltip content={t("kpiPlansTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.standardPlansCount}
              <span className="text-sm font-semibold text-slate-400"> / {summary.evaluatedPlansCount}</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.evaluatedPlansCount - summary.standardPlansCount} en Free
            </div>
          </div>
          <IconAward className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiCriticalUncovered")}</span>
              <InfoTooltip content={t("kpiCriticalTooltip")} />
            </div>
            <div
              className={`text-2xl font-extrabold flex items-center gap-2 ${
                summary.totalUnprotectedCriticalResources > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-[#1B2A41] dark:text-slate-100"
              }`}
            >
              {summary.totalUnprotectedCriticalResources}
              {summary.totalUnprotectedCriticalResources > 0 && (
                <IconAlertTriangle className="w-4 h-4 text-red-500" stroke={2} />
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.totalUnprotectedCriticalResources > 0
                ? t("planActivationRequired")
                : t("noExposureDetected")}
            </div>
          </div>
          <IconShieldX
            className={`w-8 h-8 ${
              summary.totalUnprotectedCriticalResources > 0 ? "text-red-500" : "text-[#0078D4]"
            }`}
            stroke={1.5}
          />
        </div>
      </div>

      {/* ─── Distribucion de costo por plan ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            {t("spendByPlan")}
            <InfoTooltip content={t("spendByPlanTooltip")} />
          </h3>
          {summary.breakdownByPlan.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              {t("noStandardPlans")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie
                  data={summary.breakdownByPlan}
                  dataKey="costUSD"
                  nameKey="planName"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {summary.breakdownByPlan.map((entry) => (
                    <Cell key={entry.planName} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            {t("coverageByPlan")}
            <InfoTooltip content={t("coverageByPlanTooltip")} />
          </h3>
          <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
            {plansList.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-xs text-slate-400">
                {t("noPlansReported")}
              </div>
            ) : (
              plansList
                .filter((p) => p.associatedResources.length > 0)
                .sort((a, b) => b.associatedResources.length - a.associatedResources.length)
                .map((p) => {
                  const totalRes = p.associatedResources.length;
                  const pct = totalRes > 0 ? (p.coveredResourcesCount / totalRes) * 100 : 0;
                  return (
                    <div key={p.id}>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-slate-700 dark:text-slate-300 truncate max-w-[60%]">
                          {p.planDisplayName}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 shrink-0">
                          {p.coveredResourcesCount}/{totalRes}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: pct === 100 ? "#0078D4" : pct > 0 ? "#38BDF8" : "#94A3B8",
                          }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>

      {/* ─── Filtros ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>

          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("tierAll")}</option>
            <option value="Standard">{t("tierStandard")}</option>
            <option value="Free">{t("tierFree")}</option>
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("planAll")}</option>
            <option value="Servers">Servers</option>
            <option value="Storage">Storage</option>
            <option value="Databases">Databases</option>
            <option value="Containers">Containers</option>
            <option value="AppServices">App Services</option>
            <option value="KeyVault">Key Vault</option>
            <option value="CSPM">CSPM</option>
            <option value="ResourceManager">Resource Manager</option>
          </select>

          <select
            value={selectedSub}
            onChange={(e) => setSelectedSub(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("allSubscriptions")}</option>
            {subscriptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={selectedEnv}
            onChange={(e) => setSelectedEnv(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("envAll")}</option>
            <option value="PROD">{t("envProduction")}</option>
            <option value="NONPROD">Dev / Staging</option>
          </select>
        </div>

        <div className="mt-3 flex justify-end">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="cost_desc">{t("sortByCost")}</option>
            <option value="covered_desc">{t("sortByProtected")}</option>
            <option value="name_asc">{t("sortByName")}</option>
          </select>
        </div>
      </div>

      {/* ─── Tabla de Cobertura y Costos (scrollbar visible en macOS) ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            {t("tableTitle")}
          </h3>
          <InfoTooltip content={t("tableTooltip")} />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{total} planes</span>
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <ResizableTh minWidth={230}>Plan de Seguridad</ResizableTh>
                <ResizableTh minWidth={170}>Suscripcion</ResizableTh>
                <ResizableTh minWidth={130}>Pricing Tier</ResizableTh>
                <ResizableTh minWidth={170}>{t("colCovered")}</ResizableTh>
                <ResizableTh minWidth={130}>Entorno Dominante</ResizableTh>
                <ResizableTh minWidth={120}>{t("colMonthlyCost")}</ResizableTh>
                <ResizableTh minWidth={140}>Cobertura</ResizableTh>
                <ResizableTh minWidth={200}>Acciones</ResizableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedPlans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    <IconShieldCheck className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
                    <p className="text-xs font-medium">
                      {plansList.length === 0
                        ? "Azure no reporta planes de Defender for Cloud en las suscripciones visibles."
                        : "Ningun plan coincide con los filtros aplicados."}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedPlans.map((p: DefenderPlanItem) => {
                  const Icon = CATEGORY_ICONS[p.category];
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => setDrawerPlan(p)}
                          className="flex items-start gap-2 text-left cursor-pointer group"
                        >
                          <Icon className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                          <span className="min-w-[120px] max-w-[240px]">
                            <span className="block font-semibold text-[#1B2A41] dark:text-slate-100 group-hover:text-[#0054A6] truncate">
                              {p.planDisplayName}
                            </span>
                            {p.subPlan && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900 inline-block mt-0.5">
                                {p.subPlan === "Plan1" ? "Plan 1" : "Plan 2"}
                              </span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td
                        className="px-3 py-2.5 text-slate-600 dark:text-slate-400 min-w-[120px] max-w-[240px] truncate"
                        title={p.subscriptionName}
                      >
                        {p.subscriptionName}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${
                            p.pricingTier === "Standard"
                              ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                              : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {p.pricingTier}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-semibold text-[#1B2A41] dark:text-slate-100">
                          {p.coveredResourcesCount}
                        </span>
                        <span className="text-slate-400"> protegidos</span>
                        {p.uncoveredResourcesCount > 0 && (
                          <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                            {t("uncoveredCount", { n: p.uncoveredResourcesCount })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${
                            p.dominantEnvironment === "Production"
                              ? "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
                              : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {p.dominantEnvironment === "Production" ? "Prod" : p.dominantEnvironment}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                        {formatCurrency(p.monthlyCostUSD)}
                      </td>
                      <td className="px-3 py-2.5">
                        <CoverageBadge plan={p} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => setDrawerPlan(p)}
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                          >
                            <IconSparkles size={13} stroke={1.5} className="text-[#0054A6]" />
                            {t("viewResources")}
                          </button>
                          <button
                            onClick={() =>
                              setActiveRemediation({
                                id: `manual-${p.id}`,
                                planKey: p.planKey,
                                subscriptionId: p.subscriptionId,
                                title: `Ajustar tier de ${p.planDisplayName}`,
                                description: `Actualmente en ${p.pricingTier}${
                                  p.subPlan ? ` (${p.subPlan})` : ""
                                } sobre ${p.coveredResourcesCount} recurso(s) en ${p.subscriptionName}.`,
                                category:
                                  p.pricingTier === "Free" ? "ENABLE_DB_PROTECTION" : "GOVERN_AUTO_PROVISIONING",
                                estimatedSavingsUSD: 0,
                                confidence: "MEDIUM",
                                actionType: "REVIEW_TIER",
                              })
                            }
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                          >
                            <IconSparkles size={13} stroke={1.5} className="text-[#00AEEF]" />
                            Optimizar Tier
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            setPage={setPage}
            setPageSize={setPageSize}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      </div>

      {/* ─── Recomendaciones ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            Recomendaciones Priorizadas de Defender for Cloud
            <InfoTooltip content={t("findingsTooltip")} />
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {t("totalPotentialSavingsIdentified")}{" "}
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(summary.potentialSavingsUSD)}/mes
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {data?.remediations && data.remediations.length > 0 ? (
            data.remediations.map((action) => {
              const isRisk = action.category === "ENABLE_DB_PROTECTION";
              return (
                <div
                  key={action.id}
                  className={`p-4 rounded-xl border bg-white dark:bg-slate-900 flex flex-col justify-between space-y-3 transition ${
                    isRisk
                      ? "border-red-200 dark:border-red-800 hover:border-red-300"
                      : "border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700"
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-start gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 uppercase ${
                          isRisk
                            ? "border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
                            : "border-blue-200 dark:border-blue-800 text-[#0054A6]"
                        }`}
                      >
                        {isRisk ? "RIESGO" : action.category}
                      </span>
                      {action.estimatedSavingsUSD > 0 && (
                        <span className="text-xs font-extrabold text-emerald-600">
                          +{formatCurrency(action.estimatedSavingsUSD)}/mes
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">
                      {action.title}
                    </h4>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-4 leading-relaxed">
                      {action.description}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-medium">Confianza: {action.confidence}</span>
                    <button
                      onClick={() => setActiveRemediation(action)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border bg-white dark:bg-slate-900 transition flex items-center gap-1 cursor-pointer ${
                        isRisk
                          ? "border-red-500 text-red-600 hover:bg-red-50/50 dark:hover:bg-red-950/30"
                          : "border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40"
                      }`}
                    >
                      <IconTerminal2 className="w-3.5 h-3.5" />
                      {isRisk ? "Ver Riesgo" : "Remediar"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              {t("noOverProvisioning")}
            </div>
          )}
        </div>
      </div>

      {/* ─── Capas superpuestas (z-50) ─── */}
      <PlanResourcesDrawer plan={drawerPlan} onClose={() => setDrawerPlan(null)} />
      <DefenderRemediationModal action={activeRemediation} onClose={() => setActiveRemediation(null)} />
    </div>
  );
}
