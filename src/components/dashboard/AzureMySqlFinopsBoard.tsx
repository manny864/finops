"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconCircleCheck,
  IconCoin,
  IconCopy,
  IconCheck,
  IconDatabase,
  IconRefresh,
  IconServer,
  IconShieldExclamation,
  IconTarget,
  IconSparkles,
  IconTerminal2,
  IconWallet,
  IconX,
  IconCpu,
  IconActivity,
  IconCloud,
  IconAlertCircle,
  IconBolt,
  IconGauge,
  IconClockHour4,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import { useTranslations } from "next-intl";
import InfoTooltip from "@/components/InfoTooltip";
import {
  MySqlServerDetail,
  MySqlFinopsSummaryResponse,
} from "@/types/azureMySQL";
import { toast } from "sonner";

const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

// ─── State badge helpers ────────────────────────────────────────────────────
function StateBadge({ state, isLegacy }: { state: string; isLegacy: boolean }) {
  const t = useTranslations("AzureMySQL");
  if (isLegacy) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400">
        <IconAlertCircle size={11} stroke={2} />
        Legacy
      </span>
    );
  }
  if (state === "healthy" || state === "online" || state === "Ready" || state === "Succeeded") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400">
        <IconCircleCheck size={11} stroke={2} />
        Saludable
      </span>
    );
  }
  if (state === "warning") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400">
        <IconAlertTriangle size={11} stroke={2} />
        Advertencia
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400">
      <IconShieldExclamation size={11} stroke={2} />
      {t("critical")}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    Burstable: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400",
    GeneralPurpose: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400",
    MemoryOptimized: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400",
  };
  const labels: Record<string, string> = {
    Burstable: "Burstable",
    GeneralPurpose: "General Purpose",
    MemoryOptimized: "Mem. Optimized",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${colors[tier] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
      {labels[tier] ?? tier}
    </span>
  );
}

function ServerTypeBadge({ type }: { type: string }) {
  if (type === "SingleServer") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-300 dark:bg-red-900/30 dark:text-red-300">
        <IconAlertCircle size={10} stroke={2} />
        Single Server
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-900/20 dark:text-teal-400">
      <IconServer size={10} stroke={2} />
      Flexible
    </span>
  );
}

function MetricBar({ value, danger = 80, warn = 60 }: { value: number; danger?: number; warn?: number }) {
  const color = value >= danger ? "bg-red-500" : value >= warn ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-600 dark:text-slate-400 w-10 text-right">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── KPI Card (Fondo blanco puro / neutral según estándar de diseño) ─────────
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconColorClass = "text-[#0054A6]",
  tooltip,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  iconColorClass?: string;
  tooltip?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate max-w-[85%]">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <Icon size={18} stroke={1.5} className={iconColorClass} />
          {tooltip && <InfoTooltip content={tooltip} />}
        </div>
      </div>
      <div className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif] leading-tight">
        {value}
      </div>
      {sub && (
        <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate">
          {sub}
        </span>
      )}
    </div>
  );
}

// ─── Modal de Remediación y Optimización Resolutiva ──────────────────────────
function OptimizationModal({
  server,
  onClose,
  format,
}: {
  server: MySqlServerDetail;
  onClose: () => void;
  format: (v: number) => string;
}) {
  const t = useTranslations("AzureMySQL");
  const [activeRecIdx, setActiveRecIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<"cli" | "bicep">("cli");
  const [copied, setCopied] = useState(false);

  const hasRecs = server.recommendations && server.recommendations.length > 0;
  const currentRec = hasRecs ? server.recommendations[activeRecIdx] || server.recommendations[0] : null;

  // Fallback snippets si el servidor no tiene alertas críticas
  const fallbackCli = `# Mantenimiento y optimización de MySQL Flexible Server: ${server.name}
# 1. Habilitar y configurar Slow Query Log para auditoría de queries:
az mysql flexible-server parameter set \\
  --resource-group "${server.resourceGroup}" \\
  --server-name "${server.name}" \\
  --name slow_query_log \\
  --value ON

az mysql flexible-server parameter set \\
  --resource-group "${server.resourceGroup}" \\
  --server-name "${server.name}" \\
  --name long_query_time \\
  --value 2

# 2. Verificar auto-crecimiento de almacenamiento:
az mysql flexible-server update \\
  --name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --auto-grow Enabled`;

  const fallbackBicep = `// Template Bicep para configuración estándar de ${server.name}
resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: '${server.name}'
  location: '${server.region}'
  sku: {
    name: '${server.skuProfile.name}'
    tier: '${server.skuProfile.tier}'
  }
  properties: {
    storage: {
      storageSizeGB: ${server.skuProfile.storageGib}
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: ${server.skuProfile.backupRetentionDays}
      geoRedundantBackup: '${server.skuProfile.geoRedundantBackup ? "Enabled" : "Disabled"}'
    }
    highAvailability: {
      mode: '${server.skuProfile.haMode}'
    }
    version: '${server.skuProfile.version}'
  }
}`;

  const code = currentRec
    ? activeTab === "cli" ? currentRec.cliCommand : currentRec.bicepSnippet
    : activeTab === "cli" ? fallbackCli : fallbackBicep;

  async function handleCopy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("toastCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }

  const riskColor: Record<string, string> = {
    low: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400",
    medium: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
    high: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-400",
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40">
              <IconSparkles size={22} stroke={1.5} className="text-[#0054A6]" />
            </div>
            <div>
              <h3 className="font-bold text-[#1B2A41] dark:text-slate-100 text-base font-[Montserrat,sans-serif]">
                {t("remediationTitle")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Servidor: <span className="font-semibold text-slate-800 dark:text-slate-200">{server.name}</span> ({server.skuProfile.name} • {server.skuProfile.tier})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <IconX size={16} stroke={2} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {hasRecs ? (
            <>
              {/* Recommendation selector tabs if > 1 */}
              {server.recommendations.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1 border-b border-slate-100 dark:border-slate-800">
                  {server.recommendations.map((r, idx) => (
                    <button
                      key={r.id}
                      onClick={() => { setActiveRecIdx(idx); setCopied(false); }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shrink-0 ${
                        activeRecIdx === idx
                          ? "bg-white dark:bg-slate-900 border-2 border-[#0054A6] text-[#0054A6] shadow-sm"
                          : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {r.title}
                    </button>
                  ))}
                </div>
              )}

              {/* Active Recommendation Card */}
              {currentRec && (
                <div className="p-4 bg-blue-50/40 dark:bg-slate-800/40 rounded-xl border border-blue-100 dark:border-slate-700 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                      <IconBolt size={18} stroke={1.5} className="text-[#0054A6]" />
                      {currentRec.title}
                    </h4>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {currentRec.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
                    {currentRec.savingsMonthlyUsd > 0 && (
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-1 rounded-lg">
                        <IconCoin size={14} stroke={1.5} />
                        {t("estSavingsValue", { amount: format(currentRec.savingsMonthlyUsd) })}
                      </span>
                    )}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${riskColor[currentRec.risk] || ""}`}>
                      Riesgo: {currentRec.risk === "low" ? "Bajo" : currentRec.risk === "medium" ? "Medio" : "Alto"}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                      Confianza: {currentRec.confidence === "high" ? "Alta" : currentRec.confidence === "medium" ? "Media" : "Baja"}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Diagnostic & Good Practice View if 0 active anomalies */
            <div className="p-4 bg-emerald-50/40 dark:bg-slate-800/40 rounded-xl border border-emerald-100 dark:border-slate-700 space-y-3">
              <div className="flex items-center gap-2">
                <IconShieldCheck size={20} stroke={1.5} className="text-emerald-600 dark:text-emerald-400" />
                <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white">
                  {t("optimallySizedServer")}
                </h4>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t.rich("optimalServerDetail", { name: server.name, cpu: server.metrics.cpuPercentAvg.toFixed(1), sto: server.metrics.storageUsedPct.toFixed(1), b: (c) => <strong className="text-slate-800 dark:text-slate-100">{c}</strong> })}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 text-[10px] block">SKU & Tier</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{server.skuProfile.name}</span>
                </div>
                <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 text-[10px] block">Capacidad</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{server.skuProfile.vCores} vCores • {server.skuProfile.memoryGib}GB</span>
                </div>
                <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 text-[10px] block">Almacenamiento</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{server.skuProfile.storageGib} GB ({server.skuProfile.storageAutoGrow ? "Auto-Grow" : "Fijo"})</span>
                </div>
                <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 text-[10px] block">HA Mode</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{server.skuProfile.haMode}</span>
                </div>
              </div>
            </div>
          )}

          {/* Script Execution Tabs (CLI / Bicep) */}
          <div>
            <div className="flex border-b border-slate-200 dark:border-slate-700 mb-3">
              <button
                onClick={() => setActiveTab("cli")}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-colors border-b-2 -mb-px ${
                  activeTab === "cli"
                    ? "border-[#0054A6] text-[#0054A6]"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <IconTerminal2 size={14} stroke={2} />
                Azure CLI
              </button>
              <button
                onClick={() => setActiveTab("bicep")}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-colors border-b-2 -mb-px ${
                  activeTab === "bicep"
                    ? "border-[#0054A6] text-[#0054A6]"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <IconCloud size={14} stroke={2} />
                Bicep / IaC
              </button>
            </div>
            {code && (
              <div className="relative">
                <pre className="bg-slate-950 text-slate-200 rounded-xl p-4 text-xs font-mono overflow-x-auto max-h-60 leading-relaxed whitespace-pre-wrap">
                  {code}
                </pre>
                <button
                  onClick={handleCopy}
                  className={`absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
                    copied
                      ? "border-emerald-500 text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                      : "border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-500"
                  }`}
                >
                  {copied ? <IconCheck size={13} stroke={2} /> : <IconCopy size={13} stroke={2} />}
                  {copied ? t("copied") : t("copy")}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition-colors"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Server Detail Panel ─────────────────────────────────────────────────────
function ServerDetailPanel({
  server,
  format,
  onOpenOptimization,
}: {
  server: MySqlServerDetail;
  format: (v: number) => string;
  onOpenOptimization: () => void;
}) {
  const { skuProfile: sku, metrics: m, cost } = server;
  const t = useTranslations("AzureMySQL");

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-5 h-full">
      {/* Identity */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <IconDatabase size={16} stroke={1.5} className="text-[#0054A6]" />
            <span className="text-sm font-bold text-[#1B2A41] dark:text-slate-200 font-[Montserrat,sans-serif]">
              {server.name}
            </span>
          </div>
          {server.isLegacy && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
              EN RETIRO
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <div><span className="font-medium">{t("detailType")}</span> <ServerTypeBadge type={server.serverType} /></div>
          <div><span className="font-medium">{t("detailRegion")}</span> {server.region}</div>
          <div className="col-span-2"><span className="font-medium">RG:</span> {server.resourceGroup}</div>
          <div className="col-span-2"><span className="font-medium">{t("detailSubscription")}</span> {server.subscriptionName}</div>
          {server.fqdn && (
            <div className="col-span-2 truncate"><span className="font-medium">FQDN:</span> <span className="font-mono text-[10px]">{server.fqdn}</span></div>
          )}
        </div>
      </div>

      {/* SKU Profile */}
      <div>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">SKU & Capacidad</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          <div><span className="font-medium">SKU:</span> <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">{sku.name}</code></div>
          <div><TierBadge tier={sku.tier} /></div>
          <div><span className="font-medium">vCores:</span> {sku.vCores}</div>
          <div><span className="font-medium">Memoria:</span> {sku.memoryGib} GiB</div>
          <div><span className="font-medium">IOPS:</span> {sku.iops.toLocaleString()}</div>
          <div><span className="font-medium">Storage:</span> {sku.storageGib} GiB</div>
          <div><span className="font-medium">HA:</span> <span className={sku.haMode !== "Disabled" ? "text-emerald-600" : "text-slate-500"}>{sku.haMode}</span></div>
          <div><span className="font-medium">MySQL:</span> {sku.version}</div>
          <div><span className="font-medium">{t("detailReplicas")}</span> {sku.readReplicas}</div>
          <div><span className="font-medium">Backup:</span> {sku.backupRetentionDays}d {sku.geoRedundantBackup ? "(Geo)" : ""}</div>
        </div>
      </div>

      {/* Metrics */}
      <div>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Rendimiento</p>
        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-0.5">
              <span>CPU Avg / Peak</span>
              <span className="font-mono">{m.cpuPercentMax.toFixed(1)}% pico</span>
            </div>
            <MetricBar value={m.cpuPercentAvg} />
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-0.5">
              <span>Memoria</span>
            </div>
            <MetricBar value={m.memoryPercentAvg} />
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-0.5">
              <span>Storage Usado</span>
              <span className="font-mono">{m.storageUsedGib.toFixed(1)} / {sku.storageGib} GiB</span>
            </div>
            <MetricBar value={m.storageUsedPct} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400 mt-1">
            <div><span className="font-medium">QPS:</span> {m.queriesPerSecond.toFixed(1)}</div>
            <div><span className="font-medium">Conexiones avg:</span> {m.activeConnectionsAvg}</div>
            <div><span className="font-medium">Slow queries:</span> {m.slowQueries}</div>
            <div><span className="font-medium">Fallos conex.:</span> <span className={m.failedConnections > 5 ? "text-red-500" : ""}>{m.failedConnections}</span></div>
          </div>
        </div>
      </div>

      {/* Cost */}
      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t("monthlyCost")}</p>
        <p className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif]">{format(cost.monthlyCostUsd)}</p>
        <div className="grid grid-cols-3 gap-1 mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          <div><span className="font-medium">{t("detailCompute")}</span><br />{format(cost.computeCostUsd)}</div>
          <div><span className="font-medium">Storage:</span><br />{format(cost.storageCostUsd)}</div>
          <div><span className="font-medium">Backup:</span><br />{format(cost.backupCostUsd)}</div>
        </div>
        {cost.savingsMonthlyUsd > 0 && (
          <p className="text-xs font-semibold text-emerald-600 mt-2">
            ✦ {t("potentialSavingsValue", { amount: format(cost.savingsMonthlyUsd) })}
          </p>
        )}
      </div>

      {/* Action CTA in detail panel */}
      <button
        onClick={onOpenOptimization}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 h-8 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
      >
        <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
        <span>Optimizar Servidor</span>
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function AzureMySqlFinopsBoard() {
  const t = useTranslations("AzureMySQL");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MySqlFinopsSummaryResponse | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  // Filters
  const [resourceFilter, setResourceFilter] = useState(FILTER_ALL);
  const [regionFilter, setRegionFilter] = useState(FILTER_ALL);
  const [typeFilter, setTypeFilter] = useState(FILTER_ALL);
  const [resourceGroupFilter, setResourceGroupFilter] = useState(FILTER_ALL);
  const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [modalServer, setModalServer] = useState<MySqlServerDetail | null>(null);

  const fetchData = useCallback(
    async (isManualRefresh = false) => {
      if (!selectedTenant || selectedTenant.id === "default") {
        setLoading(false);
        return;
      }
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const tenantId = selectedTenant.id;
        let token: string | null = null;
        if (!isMockTenant(tenantId)) {
          if (accounts[0]) {
            token = await getFreshIdToken(instance, accounts[0]);
          }
        }

        const params = new URLSearchParams({ tenantId, bust: isManualRefresh ? "1" : "0" });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`/api/intelligence/databases/mysql-metrics?${params}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: MySqlFinopsSummaryResponse = await res.json();
        setData(json);
        setLastUpdatedAt(new Date());
        if (isManualRefresh) toast.success(t("toastRefreshed"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error desconocido";
        setError(msg);
        if (isManualRefresh) toast.error(t("toastRefreshError"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedTenant, instance, accounts]
  );

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id]);

  // ── Deduplicate & filter ──────────────────────────────────────────────────
  const items = useMemo<MySqlServerDetail[]>(() => {
    if (!data?.servers) return [];
    const seen = new Map<string, MySqlServerDetail>();
    for (const s of data.servers) {
      const k = String(s.id || s.name).toLowerCase();
      if (!seen.has(k)) seen.set(k, s);
    }
    return Array.from(seen.values());
  }, [data]);

  const resourceOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...Array.from(new Set(items.map((s) => s.name))).map((n) => ({ value: n, label: n })),
  ], [items, t]);

  const regionOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...Array.from(new Set(items.map((s) => s.region))).map((r) => ({ value: r, label: r })),
  ], [items, t]);

  const typeOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    { value: "FlexibleServer", label: "Flexible Server" },
    { value: "SingleServer", label: "Single Server (Legacy)" },
  ], [t]);

  const rgOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...Array.from(new Set(items.map((s) => s.resourceGroup))).map((r) => ({ value: r, label: r })),
  ], [items, t]);

  const sortOptions = useMemo<FinopsTableOption[]>(() => [
    { value: "cost-desc", label: t("sortCostDesc") },
    { value: "cost-asc", label: t("sortCostAsc") },
    { value: "name-asc", label: t("sortAz") },
    { value: "name-desc", label: t("sortZa") },
  ], [t]);

  const filtered = useMemo(() => {
    let list = [...items];
    if (resourceFilter !== FILTER_ALL) list = list.filter((s) => s.name === resourceFilter);
    if (regionFilter !== FILTER_ALL) list = list.filter((s) => s.region === regionFilter);
    if (typeFilter !== FILTER_ALL) list = list.filter((s) => s.serverType === typeFilter);
    if (resourceGroupFilter !== FILTER_ALL) list = list.filter((s) => s.resourceGroup === resourceGroupFilter);

    list.sort((a, b) => {
      switch (sortMode) {
        case "name-asc": return a.name.localeCompare(b.name);
        case "name-desc": return b.name.localeCompare(a.name);
        case "cost-asc": return a.cost.monthlyCostUsd - b.cost.monthlyCostUsd;
        case "cost-desc": return b.cost.monthlyCostUsd - a.cost.monthlyCostUsd;
        default: return 0;
      }
    });
    return list;
  }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);

  const { page, setPage, pageSize, setPageSize, paged, total, totalPages } = usePagination(filtered, 15);

  const selectedServer = useMemo(() => items.find((s) => s.id === selectedServerId) ?? null, [items, selectedServerId]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!selectedTenant || selectedTenant.id === "default") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[340px] text-center p-8">
        <IconDatabase size={48} stroke={1} className="text-[#0054A6]/30 mb-4" />
        <p className="text-base font-semibold text-slate-600 dark:text-slate-400">{t("selectTenant")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[340px] text-center p-8 gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-[#0054A6]/20 border-t-[#0054A6] animate-spin" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{t("loadingTitle")}</p>
        <p className="text-xs text-slate-400">{t("loadingSubtitle")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[340px] text-center p-8 gap-3">
        <IconAlertTriangle size={40} stroke={1.5} className="text-red-500" />
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">{t("load_error")}</p>
        <p className="text-xs text-slate-400">{error}</p>
        <button
          onClick={() => fetchData(true)}
          className="mt-2 px-3 py-1.5 rounded-lg border border-[#0054A6] text-[#0054A6] text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
        >
          {t("refresh")}
        </button>
      </div>
    );
  }

  const fin = data?.financialSummary || {
    mtdCost: 0,
    forecastEom: { value: 0, low: 0, high: 0 },
    deltaMoM: { value: 0, percentage: 0 },
    potentialSavings: 0,
  };
  const eff = data?.efficiency || {
    costPerVCore: 0,
    costPerGibStorage: 0,
    underutilizedCount: 0,
    legacySingleServerCount: 0,
  };
  const risk = data?.risk || {
    healthScore: 100,
    criticalAlerts: 0,
    idleServersCount: 0,
    haOverprovisionedCount: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif]">
              {t("moduleTitle")}
            </h2>
            <InfoTooltip content={t("moduleTooltip")} />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("moduleSubtitle")}</p>
          {lastUpdatedAt && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 flex items-center gap-1">
              <IconClockHour4 size={11} stroke={2} />
              {t("updatedAt")}: {lastUpdatedAt.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg border border-[#0054A6] text-[#0054A6] text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 shrink-0 whitespace-nowrap"
        >
          <IconRefresh size={14} stroke={2} className={refreshing ? "animate-spin text-[#0054A6]" : "text-[#0054A6]"} />
          <span>{refreshing ? t("refreshing") : t("refresh")}</span>
        </button>
      </div>

      {/* KPIs (Fondo blanco puro / neutral según estándar de diseño) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard
          icon={IconWallet}
          label={t("kpiMtdCost")}
          value={format(fin.mtdCost)}
          sub={t("currentBillingCycle")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_mtd")}
        />
        <KpiCard
          icon={IconGauge}
          label={t("kpiForecast")}
          value={format(fin.forecastEom.value)}
          sub={`${format(fin.forecastEom.low)} – ${format(fin.forecastEom.high)}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_forecast")}
        />
        <KpiCard
          icon={IconTarget}
          label={t("kpiSavings")}
          value={format(fin.potentialSavings)}
          sub={`${data?.recommendations?.length || 0} ${t("actionsDetected")}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_savings")}
        />
        <KpiCard
          icon={fin.deltaMoM.percentage >= 0 ? IconArrowUpRight : IconArrowDownRight}
          label={t("kpiDeltaMoM")}
          value={`${fin.deltaMoM.percentage >= 0 ? "+" : ""}${fin.deltaMoM.percentage.toFixed(1)}%`}
          sub={format(fin.deltaMoM.value)}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_delta")}
        />
        <KpiCard
          icon={IconDatabase}
          label={t("kpiResources")}
          value={String(items.length)}
          sub={`${eff.legacySingleServerCount} ${t("legacyCount")}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_resources")}
        />
        <KpiCard
          icon={IconCpu}
          label={t("kpiEfficiency")}
          value={format(eff.costPerVCore)}
          sub={t("perVCore")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_efficiency")}
        />
        <KpiCard
          icon={IconBolt}
          label={t("kpiUnderutilized")}
          value={String(eff.underutilizedCount)}
          sub={t("candidatesRightsizing")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_underutilized")}
        />
        <KpiCard
          icon={IconActivity}
          label={t("kpiHealth")}
          value={`${risk.healthScore.toFixed(0)}%`}
          sub={`${risk.criticalAlerts} ${t("criticalAlerts")}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_health")}
        />
      </div>

      {/* Grid: Table + Detail Panel */}
      <div className={`flex gap-5 ${selectedServer ? "flex-col xl:flex-row" : ""}`}>
        {/* Table section */}
        <div className="flex-1 min-w-0">
          {/* Filters */}
          <FinopsTableControls
            resourceOptions={resourceOptions}
            regionOptions={regionOptions}
            typeOptions={typeOptions}
            resourceGroupOptions={rgOptions}
            sortOptions={sortOptions}
            selectedResource={resourceFilter}
            selectedRegion={regionFilter}
            selectedType={typeFilter}
            selectedResourceGroup={resourceGroupFilter}
            selectedSort={sortMode}
            onResourceChange={(v) => { setResourceFilter(v); setPage(1); }}
            onRegionChange={(v) => { setRegionFilter(v); setPage(1); }}
            onTypeChange={(v) => { setTypeFilter(v); setPage(1); }}
            onResourceGroupChange={(v) => { setResourceGroupFilter(v); setPage(1); }}
            onSortChange={(v) => { setSortMode(v as SortMode); setPage(1); }}
            labels={{
              resource: t("filterResource"),
              region: t("filterRegion"),
              type: t("filterType"),
              resourceGroup: t("filterResourceGroup"),
              sort: t("sortBy"),
            }}
          />

          {/* Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-200 font-[Montserrat,sans-serif]">
                  {t("tableTitle")}
                </h3>
                <InfoTooltip content={t("tableTooltip")} />
              </div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {total} {t("resourcesCount")}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-left">
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">
                      <div className="flex items-center gap-1">{t("colResource")} <InfoTooltip content={t("tooltip_col_resource")} /></div>
                    </ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">
                      <div className="flex items-center gap-1">{t("colRegion")} <InfoTooltip content={t("tooltip_col_region")} /></div>
                    </ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colSubscription")}</ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">
                      <div className="flex items-center gap-1">{t("colType")} <InfoTooltip content={t("tooltip_col_type")} /></div>
                    </ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colSku")}</ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-center">{t("colState")}</ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">
                      <div className="flex items-center justify-end gap-1">{t("colCpuMem")} <InfoTooltip content={t("tooltip_col_cpu")} /></div>
                    </ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">
                      <div className="flex items-center justify-end gap-1">{t("colStorage")} <InfoTooltip content={t("tooltip_col_storage")} /></div>
                    </ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colCost")}</ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colSavings")}</ResizableTh>
                    <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-center">{t("colActions")}</ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-12 text-slate-400 dark:text-slate-600">
                        {t("noRecords")}
                      </td>
                    </tr>
                  ) : (
                    paged.map((server: MySqlServerDetail) => {
                      const isSelected = server.id === selectedServerId;
                      return (
                        <tr
                          key={server.id}
                          className={`border-t border-slate-100 dark:border-slate-800 cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-blue-50 dark:bg-blue-950/20"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          }`}
                          onClick={() => setSelectedServerId(isSelected ? "" : server.id)}
                        >
                          {/* Resource */}
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <IconDatabase size={14} stroke={1.5} className="text-[#0054A6] flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs truncate max-w-[160px]">
                                  {server.name}
                                </p>
                              </div>
                            </div>
                          </td>
                          {/* Region */}
                          <td className="p-3">
                            <p className="text-xs text-slate-600 dark:text-slate-400">{server.region}</p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[120px]">{server.resourceGroup}</p>
                          </td>
                          {/* Subscription */}
                          <td className="p-3">
                            <p className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[120px]">{server.subscriptionName}</p>
                          </td>
                          {/* Type */}
                          <td className="p-3">
                            <ServerTypeBadge type={server.serverType} />
                          </td>
                          {/* SKU */}
                          <td className="p-3">
                            <TierBadge tier={server.skuProfile.tier} />
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{server.skuProfile.name}</p>
                          </td>
                          {/* State */}
                          <td className="p-3 text-center">
                            <StateBadge state={server.state} isLegacy={server.isLegacy} />
                          </td>
                          {/* CPU / Mem */}
                          <td className="p-3 text-right">
                            <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                              CPU {server.metrics.cpuPercentAvg.toFixed(1)}%
                            </p>
                            <p className="text-[10px] font-mono text-slate-400">
                              Mem {server.metrics.memoryPercentAvg.toFixed(1)}%
                            </p>
                          </td>
                          {/* Storage */}
                          <td className="p-3 text-right">
                            <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                              {server.metrics.storageUsedGib.toFixed(0)} / {server.skuProfile.storageGib} GiB
                            </p>
                            <p className="text-[10px] font-mono text-slate-400">
                              {server.metrics.storageUsedPct.toFixed(1)}%
                            </p>
                          </td>
                          {/* Cost */}
                          <td className="p-3 text-right">
                            <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-200">
                              {format(server.cost.monthlyCostUsd)}
                            </p>
                          </td>
                          {/* Savings */}
                          <td className="p-3 text-right">
                            {server.cost.savingsMonthlyUsd > 0 ? (
                              <p className="text-sm font-bold text-emerald-600">
                                {format(server.cost.savingsMonthlyUsd)}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400">—</p>
                            )}
                          </td>
                          {/* Actions */}
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setModalServer(server)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
                            >
                              <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                              <span>{t("inspect")}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
              <Pagination
                page={page}
                setPage={setPage}
                pageSize={pageSize}
                setPageSize={(s) => { setPageSize(s); setPage(1); }}
                total={total}
                totalPages={totalPages}
                pageSizes={[15, 30, 45, 60]}
              />
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedServer && (
          <div className="xl:w-80 flex-shrink-0">
            <ServerDetailPanel
              server={selectedServer}
              format={format}
              onOpenOptimization={() => setModalServer(selectedServer)}
            />
          </div>
        )}
      </div>

      {/* Optimization & Remediation Modal */}
      {modalServer && (
        <OptimizationModal
          server={modalServer}
          onClose={() => setModalServer(null)}
          format={format}
        />
      )}
    </div>
  );
}
