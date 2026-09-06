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
  IconWorld,
  IconShieldX,
  IconChecklist,
  IconRotateClockwise,
  IconSearch,
  IconDatabaseExport,
  IconTerminal2,
  IconX,
  IconCheck,
  IconCopy,
  IconAlertTriangle,
  IconShieldLock,
  IconRouter,
  IconInfoCircle,
  IconMapPin,
  IconSparkles,
} from "@tabler/icons-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildWafRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  WAF_COUNTRY_SCALE,
  type WafPayload,
  type WafPolicyResourceItem,
  type WafRemediationAction,
} from "@/types/azureWaf.types";

/** Scrollbar horizontal siempre visible: en macOS los overlay desaparecen. */
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

const formatCount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("es-AR").format(n);
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

// ─── Modal de Remediación (z-[100]) ───
function WafRemediationModal({
  action,
  onClose,
}: {
  action: WafRemediationAction | null;
  onClose: () => void;
}) {
  const t = useTranslations("WafSecurity");
  const [copied, setCopied] = useState<"cli" | "ps" | null>(null);
  if (!action) return null;

  const cmd = buildWafRemediationCommand(action);
  const isRisk = action.category === "ENABLE_PREVENTION";
  const copy = (text: string, which: "cli" | "ps") => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl p-6 relative z-[100] max-h-[85vh] overflow-y-auto"
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
            <IconShieldX className="w-6 h-6 text-amber-500" stroke={1.5} />
          ) : (
            <IconTerminal2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          )}
          <div className="pr-8">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{action.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{action.description}</p>
          </div>
        </div>

        <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          {action.estimatedSavingsUSD > 0 ? (
            <>
              <span className="text-xs text-slate-600 dark:text-slate-400">{t("estimatedMonthlySavings")} </span>
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(action.estimatedSavingsUSD)}
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t("noDirectSavings")}{" "}
              <span className="font-bold">{isRisk ? t("riskWord") : t("postureWord")}</span>.
            </span>
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
          {t("noExecNote1")}
          {t("noExecNote2")}
        </p>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function WafSecurityPanel() {
  const t = useTranslations("WafSecurity");
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

  const apiUrl = `/api/intelligence/waf?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<WafPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("ALL");
  const [selectedMode, setSelectedMode] = useState("ALL");
  const [activeRemediation, setActiveRemediation] = useState<WafRemediationAction | null>(null);

  const policiesList = useMemo(() => data?.policies || [], [data?.policies]);

  const filteredPolicies = useMemo(() => {
    return policiesList
      .filter((p) => {
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const hit =
            p.name.toLowerCase().includes(term) ||
            p.resourceGroup.toLowerCase().includes(term) ||
            p.associatedEndpoints.some((e) => e.toLowerCase().includes(term));
          if (!hit) return false;
        }
        if (selectedPlatform !== "ALL" && p.hostPlatform !== selectedPlatform) return false;
        if (selectedMode === "DETECTION" && p.mode !== "Detection") return false;
        if (selectedMode === "PREVENTION" && p.mode !== "Prevention") return false;
        if (selectedMode === "ORPHAN" && !p.isOrphan) return false;
        return true;
      })
      .sort((a, b) => {
        // El riesgo primero: una política en Detection sobre producción arriba.
        if (a.needsPreventionMode !== b.needsPreventionMode) return a.needsPreventionMode ? -1 : 1;
        return b.monthlyCostUSD - a.monthlyCostUSD;
      });
  }, [policiesList, searchTerm, selectedPlatform, selectedMode]);

  const {
    paged: paginatedPolicies,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredPolicies, 15);

  const handleExportCSV = () => {
    if (filteredPolicies.length === 0) return;
    const headers = [
      "Policy",
      "Platform",
      "Mode",
      "State",
      "Region",
      "Resource Group",
      "Subscription",
      "Managed Rule Set",
      "Custom Rules",
      "Geo Filter",
      "Rate Limit",
      "Associated Endpoints",
      "Requests MTD",
      "Blocked",
      "Detected",
      "Throughput GB",
      "Monthly Cost USD",
      "Orphan",
    ];
    const rows = filteredPolicies.map((p) => [
      `"${p.name}"`,
      `"${p.hostPlatform}"`,
      `"${p.mode}"`,
      `"${p.state}"`,
      `"${p.location}"`,
      `"${p.resourceGroup}"`,
      `"${p.subscriptionName}"`,
      `"${p.managedRuleSet}"`,
      p.customRulesCount,
      p.hasGeoFilterRule,
      p.hasRateLimitRule,
      `"${p.associatedEndpoints.join(" | ")}"`,
      p.totalRequestsMTD,
      p.blockedRequestsCount,
      p.detectedRequestsCount,
      p.throughputGB,
      p.monthlyCostUSD.toFixed(2),
      p.isOrphan,
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `azure-waf-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    totalMonthlyCostUSD: 0,
    totalProtectedApps: 0,
    totalRequestsMTD: 0,
    totalBlockedRequests: 0,
    totalDetectedRequests: 0,
    blockRatePercentage: 0,
    falsePositiveRatePercentage: 0,
    costPerAppUSD: 0,
    costPerMillionRequestsUSD: 0,
    costPerGbUSD: 0,
    totalThroughputGB: 0,
    policiesInDetectionCount: 0,
    orphanPoliciesCount: 0,
    threatsBreakdown: [],
    topIps: [],
    topCountries: [],
    potentialSavingsUSD: 0,
  };

  const maxCountryBlocked = Math.max(1, ...summary.topCountries.map((c) => c.blockedCount));

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconShieldLock className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("pageTitle")}</span>
              <InfoTooltip
                content="Las dos plataformas tienen economías distintas y eso cambia las recomendaciones. Application Gateway WAF_v2 cobra instancia fija más Capacity Units, así que procesar menos tráfico sí reduce la factura. Front Door Premium cobra una base plana más un cargo por millón de solicitudes que se paga igual se bloquee o se permita, así que filtrar antes ahorra mucho menos."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Azure Resource Graph" : "Demo Sandbox"}
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

      {/* Sin telemetría no se inventan amenazas: en un panel de seguridad eso
          sería mucho peor que en uno de costos. */}
      {data?.telemetryUnavailable && (
        <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconInfoCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {t.rich("noTelemetryNotice", { b: (c) => <span className="font-semibold">{c}</span>, code: (c) => <code>{c}</code> })}
          </p>
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
              {t("protectedApps", { count: summary.totalProtectedApps })}
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Solicitudes Inspeccionadas</span>
              <InfoTooltip content={t("kpiRequestsTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCount(summary.totalRequestsMTD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.totalThroughputGB} GB procesados
            </div>
          </div>
          <IconWorld className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Ataques Bloqueados</span>
              <InfoTooltip content={t("kpiBlockedTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCount(summary.totalBlockedRequests)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.blockRatePercentage}% del tráfico
              {summary.totalDetectedRequests > 0 && (
                <span className="block text-amber-600 dark:text-amber-400 font-semibold">
                  {t("onlyDetected", { count: formatCount(summary.totalDetectedRequests) })}
                </span>
              )}
            </div>
          </div>
          <IconShieldX className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Falsos Positivos (est.)</span>
              <InfoTooltip content={t("kpiFalsePositivesTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.falsePositiveRatePercentage}%
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.falsePositiveRatePercentage < 1 ? "Estado óptimo" : "Revisar exclusiones"}
            </div>
          </div>
          <IconChecklist className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Fila 1: Economía unitaria ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
          {t("unitEconomics")}
          <InfoTooltip content={t("unitEconomicsTooltip")} />
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ["Costo por Aplicación", formatCurrency(summary.costPerAppUSD), "/ app"],
            ["Costo por 1M Requests", formatCurrency(summary.costPerMillionRequestsUSD), "/ millón"],
            ["Costo por GB Procesado", formatCurrency(summary.costPerGbUSD), "/ GB"],
            ["Throughput Inspeccionado", `${summary.totalThroughputGB}`, "GB MTD"],
          ].map(([label, value, unit]) => (
            <div
              key={label}
              className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
            >
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
              <div className="text-xl font-extrabold text-[#1B2A41] dark:text-slate-100">{value}</div>
              <div className="text-[10px] text-slate-400">{unit}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Filtros ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("platformAll")}</option>
            <option value="FrontDoor">Front Door Premium</option>
            <option value="ApplicationGateway">Application Gateway</option>
          </select>
          <select
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("modeAll")}</option>
            <option value="PREVENTION">Prevention</option>
            <option value="DETECTION">Detection</option>
            <option value="ORPHAN">{t("modeOrphan")}</option>
          </select>
        </div>
      </div>

      {/* ─── Fila 2: Tabla de políticas ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            {t("tableTitle")}
          </h3>
          <InfoTooltip content={t("tableTooltip")} />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{total} políticas</span>
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-semibold min-w-[220px]">{t("colPolicy")}</th>
                <th className="px-3 py-2 font-semibold min-w-[150px]">{t("colPlatform")}</th>
                <th className="px-3 py-2 font-semibold min-w-[140px]">{t("colMode")}</th>
                <th className="px-3 py-2 font-semibold min-w-[170px]">{t("colRuleset")}</th>
                <th className="px-3 py-2 font-semibold min-w-[130px]">{t("colRequests")}</th>
                <th className="px-3 py-2 font-semibold min-w-[120px]">{t("colBlocks")}</th>
                <th className="px-3 py-2 font-semibold min-w-[120px]">{t("colMonthlyCost")}</th>
                <th className="px-3 py-2 font-semibold min-w-[210px]">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedPolicies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    <IconShieldLock className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
                    <p className="text-xs font-medium">
                      {policiesList.length === 0
                        ? "Azure no reporta políticas WAF en las suscripciones visibles."
                        : "Ninguna política coincide con los filtros aplicados."}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedPolicies.map((p: WafPolicyResourceItem) => (
                  <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <IconRouter className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                        <span className="min-w-[120px] max-w-[240px]">
                          <span className="block font-semibold text-[#1B2A41] dark:text-slate-100 truncate" title={p.name}>
                            {p.name}
                          </span>
                          <span
                            className="block text-[10px] text-slate-500 dark:text-slate-400 truncate"
                            title={p.associatedEndpoints.join(", ")}
                          >
                            {p.associatedEndpoints.length > 0
                              ? p.associatedEndpoints.join(", ")
                              : t("noEndpoints")}
                          </span>
                          {p.isOrphan && (
                            <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900">
                              {t("badgeOrphan")}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${
                          p.hostPlatform === "FrontDoor"
                            ? "border-blue-400 dark:border-blue-600 text-[#2563EB] dark:text-blue-400"
                            : "border-sky-300 dark:border-sky-700 text-[#0284C7] dark:text-sky-400"
                        }`}
                      >
                        {p.hostPlatform === "FrontDoor" ? "Front Door Premium" : "Application Gateway"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${
                          p.mode === "Prevention"
                            ? "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
                            : p.needsPreventionMode
                              ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                              : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {p.mode}
                      </span>
                      {p.needsPreventionMode && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                          {t("unmitigatedProduction")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-slate-700 dark:text-slate-300 text-[11px] block truncate max-w-[170px]" title={p.managedRuleSet}>
                        {p.managedRuleSet}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {p.customRulesCount} personalizada(s)
                        {p.hasGeoFilterRule && " · geo"}
                        {p.hasRateLimitRule && " · rate-limit"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-[#1B2A41] dark:text-slate-100">
                      {formatCount(p.totalRequestsMTD)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-[#0054A6] dark:text-blue-300">
                        {formatCount(p.blockedRequestsCount)}
                      </span>
                      {p.detectedRequestsCount > 0 && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                          {t("detectedSuffix", { count: formatCount(p.detectedRequestsCount) })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                      {formatCurrency(p.monthlyCostUSD)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.needsPreventionMode && (
                          <button
                            onClick={() =>
                              setActiveRemediation({
                                id: `manual-prevention-${p.id}`,
                                policyId: p.id,
                                policyName: p.name,
                                title: `Cambiar ${p.name} a Prevention`,
                                description: `Protege ${p.associatedEndpoints.join(", ")} pero solo registra los ataques.`,
                                category: "ENABLE_PREVENTION",
                                estimatedSavingsUSD: 0,
                                confidence: "HIGH",
                                actionType: "SET_PREVENTION_MODE",
                              })
                            }
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                          >
                            <IconSparkles size={13} stroke={1.5} className="text-[#0054A6]" />
                            Cambiar a Prevention
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setActiveRemediation({
                              id: `manual-rules-${p.id}`,
                              policyId: p.id,
                              policyName: p.name,
                              title: `Editar reglas de ${p.name}`,
                              description: `${p.customRulesCount} regla(s) personalizada(s) sobre ${p.managedRuleSet}.`,
                              category: p.hasGeoFilterRule ? "RATE_LIMITING" : "GEO_FILTER_RULE",
                              estimatedSavingsUSD: 0,
                              confidence: "MEDIUM",
                              actionType: "EDIT_RULES",
                            })
                          }
                          className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                        >
                          <IconSparkles size={13} stroke={1.5} className="text-[#00AEEF]" />
                          {t("editRules")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
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

      {/* ─── Fila 3: Vectores de ataque ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
          Principales Vectores de Ataque Mitigados
          <InfoTooltip content={t("threatsTooltip")} />
        </h3>
        {summary.threatsBreakdown.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
            {t("noThreatEvents")}
            mostrar datos fabricados.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {summary.threatsBreakdown.map((t) => (
              <div
                key={t.categoryName}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
              >
                <div className="flex justify-between items-start gap-2">
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">{t.categoryName}</h4>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${
                      t.severity === "High"
                        ? "border-blue-400 dark:border-blue-600 text-[#0054A6] dark:text-blue-300"
                        : t.severity === "Medium"
                          ? "border-sky-300 dark:border-sky-700 text-[#0284C7] dark:text-sky-400"
                          : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {t.severity === "High" ? "Alta" : t.severity === "Medium" ? "Media" : "Baja"}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                    {formatCount(t.attemptsCount)}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    intentos{t.crsRulePrefix ? ` · CRS ${t.crsRulePrefix}xxx` : ""}
                  </span>
                </div>
                <div className="space-y-1">
                  {t.payloadExamples.slice(0, 3).map((payload, i) => (
                    <code
                      key={i}
                      className="block px-2 py-1 rounded bg-slate-950 text-slate-300 font-mono text-[10px] overflow-x-auto whitespace-nowrap"
                    >
                      {payload}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Fila 4: Inteligencia de orígenes ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            Top IPs Bloqueadas
            <InfoTooltip content={t("sourcesTooltip")} />
          </h3>
          {summary.topIps.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">{t("noBlockedSources")}</p>
          ) : (
            <div className="space-y-2">
              {summary.topIps.map((ip) => (
                <div
                  key={ip.identifier}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <span className="block font-mono text-[11px] font-semibold text-[#1B2A41] dark:text-slate-100">
                      {ip.identifier}
                    </span>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {ip.countryName || ip.countryCode || "Origen desconocido"} · {formatCount(ip.blockedCount)}{" "}
                      bloqueos
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setActiveRemediation({
                        id: `blockip-${ip.identifier}`,
                        policyId: policiesList[0]?.id || "",
                        policyName: policiesList[0]?.name || "wafPolicy",
                        title: `Bloquear ${ip.identifier} en el perímetro`,
                        description: `${formatCount(ip.blockedCount)} bloqueos desde ${
                          ip.countryName || ip.countryCode || "origen desconocido"
                        }. Una regla de IPMatch la descarta antes de la matriz CRS. Verificar que no sea un NAT compartido antes de bloquear.`,
                        category: "GEO_FILTER_RULE",
                        estimatedSavingsUSD: 0,
                        confidence: "MEDIUM",
                        actionType: "ADD_IP_BLOCK_RULE",
                      })
                    }
                    className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer shrink-0 whitespace-nowrap flex items-center gap-1"
                  >
                    <IconSparkles size={12} stroke={1.5} className="text-[#0054A6]" />
                    Bloquear
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            <IconMapPin className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            {t("topCountries")}
            <InfoTooltip content={t("topCountriesTooltip")} />
          </h3>
          {summary.topCountries.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">{t("noBlockedSources")}</p>
          ) : (
            <div className="space-y-3">
              {summary.topCountries.map((c, i) => (
                <div key={c.identifier}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {c.countryName || c.identifier}
                      {c.countryCode && c.countryName ? ` (${c.countryCode})` : ""}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {formatCount(c.blockedCount)} · {c.percentage}%
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(c.blockedCount / maxCountryBlocked) * 100}%`,
                        backgroundColor: WAF_COUNTRY_SCALE[i % WAF_COUNTRY_SCALE.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Recomendaciones ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            Recomendaciones Priorizadas de WAF
            <InfoTooltip content={t("geoFilterTooltip")} />
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {t("totalPotentialSavings")}{" "}
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(summary.potentialSavingsUSD)}/mes
            </span>
            {summary.policiesInDetectionCount > 0 && (
              <>
                {" · "}
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  {t("policiesInDetection", { count: summary.policiesInDetectionCount })}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {data?.remediations && data.remediations.length > 0 ? (
            data.remediations.map((action) => {
              const isRisk = action.category === "ENABLE_PREVENTION";
              return (
                <div
                  key={action.id}
                  className={`p-4 rounded-xl border bg-white dark:bg-slate-900 flex flex-col justify-between space-y-3 transition ${
                    isRisk
                      ? "border-amber-200 dark:border-amber-800 hover:border-amber-300"
                      : "border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700"
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-start gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 uppercase ${
                          isRisk
                            ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
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
                          ? "border-amber-500 text-amber-700 dark:text-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/30"
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
              {t("allHealthy")}
            </div>
          )}
        </div>
      </div>

      {/* ─── Capas superpuestas (z-[100]) ─── */}
      <WafRemediationModal action={activeRemediation} onClose={() => setActiveRemediation(null)} />
    </div>
  );
}
