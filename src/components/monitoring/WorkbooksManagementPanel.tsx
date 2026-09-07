"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconBook,
  IconCash,
  IconFileBroken,
  IconRotateClockwise,
  IconSearch,
  IconDatabaseExport,
  IconTerminal2,
  IconX,
  IconCheck,
  IconExternalLink,
  IconAlertTriangle,
  IconCopy,
  IconClockPause,
  IconChartAreaLine,
  IconUsers,
  IconLock,
  IconSparkles,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildWorkbookRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import {
  WORKBOOK_SOURCE_LABELS,
  type WorkbookRemediationAction,
  type WorkbookResourceItem,
  type WorkbooksPayload,
} from "@/types/azureWorkbooks.types";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

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
        // Sin token se deja que el servidor responda 401 y SWR lo propague:
        // no se sirve un mock de rescate (Directiva 24.1).
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

/** Badge de salud del workbook con la semantica del modulo. */
function HealthBadge({ workbook }: { workbook: WorkbookResourceItem }) {
  const t = useTranslations("WorkbooksManagement");
  const map = {
    Valid: { label: "Valido", cls: "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400" },
    Orphan: { label: "Huerfano", cls: "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" },
    SourceError: { label: "Error de Origen", cls: "border-red-300 dark:border-red-800 text-red-700 dark:text-red-400" },
    Stale: { label: "Desactualizado", cls: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400" },
  } as const;
  const cfg = map[workbook.healthStatus];
  return (
    <span
      title={workbook.healthReason || "Sin observaciones"}
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

/** Badge del intervalo de auto-refresh; ambar cuando es agresivo. */
function RefreshBadge({ workbook }: { workbook: WorkbookResourceItem }) {
  const t = useTranslations("WorkbooksManagement");
  if (workbook.autoRefreshSeconds <= 0) {
    return <span className="text-[11px] text-slate-400">Desactivado</span>;
  }
  const critical = workbook.autoRefreshSeconds <= 300;
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${
        critical
          ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
          : "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
      }`}
    >
      {workbook.autoRefreshInterval}
      {critical ? " (Critico)" : ""}
    </span>
  );
}

// ─── Drawer Lateral de Detalle del Workbook (z-50) ───
function WorkbookDetailDrawer({
  workbook,
  onClose,
}: {
  workbook: WorkbookResourceItem | null;
  onClose: () => void;
}) {
  const t = useTranslations("WorkbooksManagement");
  if (!workbook) return null;

  const portalUrl = `https://portal.azure.com/#@/resource${workbook.id}`;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconBook className="w-5 h-5 text-[#0078D4] shrink-0" stroke={1.5} />
              <span className="truncate">{workbook.displayName}</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
              {workbook.resourceGroup} · {workbook.subscriptionName} · {workbook.location}
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

        <div className="p-5 space-y-5">
          {/* Resumen de costo indirecto */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{t("estMonthlyCost")}</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {formatCurrency(workbook.estimatedQueryCostUSD)}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{t("gbPerRun")}</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {workbook.totalScanGBPerRun.toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Ejecuciones/mes</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {workbook.estimatedMonthlyRuns}
              </div>
            </div>
          </div>

          {workbook.healthReason && (
            <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 flex items-start gap-2">
              <IconAlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" stroke={1.5} />
              <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">{workbook.healthReason}</p>
            </div>
          )}

          {/* Recursos y workspaces objetivo */}
          <div>
            <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
              {t("targetResources")}
              <InfoTooltip content={t("targetTooltip")} />
            </h3>
            <div className="space-y-1.5">
              {workbook.linkedSourceId ? (
                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">sourceId</div>
                  <code className="text-[10px] text-slate-700 dark:text-slate-300 break-all">{workbook.linkedSourceId}</code>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t("noSourceResource")}
                </p>
              )}
              {workbook.missingWorkspaceIds.map((ws) => (
                <div
                  key={ws}
                  className="p-2.5 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900"
                >
                  <div className="text-[10px] font-semibold text-red-600 dark:text-red-400">Workspace inexistente</div>
                  <code className="text-[10px] text-slate-700 dark:text-slate-300 break-all">{ws}</code>
                </div>
              ))}
            </div>
          </div>

          {/* Consultas KQL internas */}
          <div>
            <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
              Consultas Internas ({workbook.queries.length})
              <InfoTooltip content={t("queriesTooltip")} />
            </h3>
            {workbook.queries.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t("noQueries")}
              </p>
            ) : (
              <div className="space-y-2.5">
                {workbook.queries.map((query, i) => (
                  <div
                    key={`${query.stepName}-${i}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                  >
                    <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[#1B2A41] dark:text-slate-200 truncate">
                        {query.stepName}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900">
                          {WORKBOOK_SOURCE_LABELS[query.dataSource]}
                        </span>
                        {query.estimatedScanGB > 0 && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border bg-white dark:bg-slate-900 ${
                              query.isHeavy
                                ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                                : "border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400"
                            }`}
                          >
                            ~{query.estimatedScanGB} GB
                          </span>
                        )}
                      </div>
                    </div>
                    {query.lacksTimeFilter && (
                      <div className="px-3 py-1.5 bg-amber-50/60 dark:bg-amber-950/20 border-t border-amber-200 dark:border-amber-800">
                        <p className="text-[10px] text-amber-800 dark:text-amber-300">
                          {t.rich("noTimeFilter", { code: (c) => <code>{c}</code> })}
                        </p>
                      </div>
                    )}
                    <pre className="p-3 bg-slate-950 text-slate-100 font-mono text-[10px] overflow-x-auto leading-relaxed">
                      {query.queryPreview}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <IconExternalLink className="w-4 h-4" />
            {t("openInPortal")}
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediacion CLI / PowerShell (z-50) ───
function WorkbookRemediationModal({
  action,
  onClose,
}: {
  action: WorkbookRemediationAction | null;
  onClose: () => void;
}) {
  const t = useTranslations("WorkbooksManagement");
  const [copied, setCopied] = useState<"cli" | "ps" | null>(null);
  if (!action) return null;

  const cmd = buildWorkbookRemediationCommand(action);

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
          <IconTerminal2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div className="pr-8">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{action.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{action.description}</p>
          </div>
        </div>

        {action.estimatedSavingsUSD > 0 && (
          <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
            <span className="text-xs text-slate-600 dark:text-slate-400">{t("estimatedMonthlySavings")} </span>
            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(action.estimatedSavingsUSD)}
            </span>
          </div>
        )}

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
          {t("reviewNote1")}
          {t("reviewNote2")}
        </p>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function WorkbooksManagementPanel() {
  const t = useTranslations("WorkbooksManagement");
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

  const apiUrl = `/api/intelligence/monitoring/workbooks?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<WorkbooksPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedSource, setSelectedSource] = useState<string>("ALL");
  const [selectedHealth, setSelectedHealth] = useState<string>("ALL");
  const [selectedRg, setSelectedRg] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"cost_desc" | "refresh_desc" | "name_asc" | "name_desc" | "modified_asc">(
    "cost_desc"
  );

  const [detailWorkbook, setDetailWorkbook] = useState<WorkbookResourceItem | null>(null);
  const [activeRemediation, setActiveRemediation] = useState<WorkbookRemediationAction | null>(null);

  const workbooksList: WorkbookResourceItem[] = useMemo(() => data?.workbooks || [], [data?.workbooks]);

  const resourceGroups = useMemo(() => {
    const set = new Set<string>();
    workbooksList.forEach((w) => {
      if (w.resourceGroup) set.add(w.resourceGroup);
    });
    return Array.from(set).sort();
  }, [workbooksList]);

  const filteredWorkbooks = useMemo(() => {
    return workbooksList
      .filter((w) => {
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const hit =
            w.displayName.toLowerCase().includes(term) ||
            w.name.toLowerCase().includes(term) ||
            w.resourceGroup.toLowerCase().includes(term) ||
            (w.subscriptionName || "").toLowerCase().includes(term);
          if (!hit) return false;
        }
        if (selectedType !== "ALL" && w.workbookType !== selectedType) return false;
        if (selectedSource !== "ALL" && w.primaryDataSource !== selectedSource) return false;
        if (selectedHealth === "VALID" && w.healthStatus !== "Valid") return false;
        if (selectedHealth === "BROKEN" && w.healthStatus === "Valid") return false;
        if (selectedRg !== "ALL" && w.resourceGroup !== selectedRg) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "cost_desc") return b.estimatedQueryCostUSD - a.estimatedQueryCostUSD;
        if (sortBy === "refresh_desc") {
          // Los que no tienen auto-refresh van al final, no al principio.
          const av = a.autoRefreshSeconds === 0 ? Number.MAX_SAFE_INTEGER : a.autoRefreshSeconds;
          const bv = b.autoRefreshSeconds === 0 ? Number.MAX_SAFE_INTEGER : b.autoRefreshSeconds;
          return av - bv;
        }
        if (sortBy === "name_asc") return a.displayName.localeCompare(b.displayName);
        if (sortBy === "name_desc") return b.displayName.localeCompare(a.displayName);
        if (sortBy === "modified_asc") return b.daysSinceModified - a.daysSinceModified;
        return 0;
      });
  }, [workbooksList, searchTerm, selectedType, selectedSource, selectedHealth, selectedRg, sortBy]);

  const {
    paged: paginatedWorkbooks,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredWorkbooks, 15);

  const handleExportCSV = () => {
    if (filteredWorkbooks.length === 0) return;
    const headers = [
      "Display Name",
      "Resource Name",
      "Type",
      "Resource Group",
      "Subscription",
      "Primary Data Source",
      "Auto Refresh",
      "Last Modified",
      "Days Since Modified",
      "Health",
      "Scan GB Per Run",
      "Monthly Runs",
      "Estimated Monthly Cost USD",
    ];
    const rows = filteredWorkbooks.map((w) => [
      `"${w.displayName}"`,
      `"${w.name}"`,
      `"${w.workbookType}"`,
      `"${w.resourceGroup}"`,
      `"${w.subscriptionName}"`,
      `"${WORKBOOK_SOURCE_LABELS[w.primaryDataSource]}"`,
      `"${w.autoRefreshInterval || "Desactivado"}"`,
      `"${w.lastModifiedDate}"`,
      w.daysSinceModified,
      `"${w.healthStatus}"`,
      w.totalScanGBPerRun,
      w.estimatedMonthlyRuns,
      w.estimatedQueryCostUSD.toFixed(2),
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `azure-workbooks-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    totalWorkbooksCount: 0,
    sharedCount: 0,
    privateCount: 0,
    orphanCount: 0,
    staleCount: 0,
    autoRefreshCount: 0,
    aggressiveRefreshCount: 0,
    heavyQueryCount: 0,
    estimatedMonthlyQueryCostUSD: 0,
    potentialSavingsUSD: 0,
    breakdownByDataSource: [],
  };

  const costTrend = data?.costTrend || [];

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado y Controles Globales ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconBook className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("pageTitle")}</span>
              <InfoTooltip
                content="El recurso Workbook es gratuito; lo que se gobierna aca es el gasto indirecto de sus consultas. Importante: en Log Analytics tier Analytics las consultas NO se facturan (se paga la ingesta); el escaneo por consulta solo genera cargo sobre Basic Logs, datos archivados y search jobs, a ~$0.005/GB, que es la tarifa que usa este tablero. La palanca grande de los workbooks es la higiene: huerfanos, sprawl y las tablas de alto volumen que revelan."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Azure Resource Graph" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("subtitle")}
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
            {t("refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 Tarjetas KPI (Iconos Tabler Azules sin Fondo) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiIndirectCost")}</span>
              <InfoTooltip content={t("kpiIndirectCostTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.estimatedMonthlyQueryCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("heavyQueries", { count: summary.heavyQueryCount })}
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("totalWorkbooks")}</span>
              <InfoTooltip content="Dashboards aprovisionados en Azure Monitor: compartidos (microsoft.insights/workbooks) y privados (myworkbooks)." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalWorkbooksCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-[#0054A6] dark:text-blue-300 font-semibold">{summary.sharedCount} compartidos</span>{" "}
              · <span className="text-slate-400">{summary.privateCount} privados</span>
            </div>
          </div>
          <IconBook className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Huerfanos / Rotos</span>
              <InfoTooltip content="Workbooks cuyo recurso de origen fue eliminado, o que referencian workspaces de Log Analytics que ya no existen." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              {summary.orphanCount}
              {summary.orphanCount > 0 && <IconAlertTriangle className="w-4 h-4 text-amber-500" stroke={2} />}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.staleCount} desactualizados (&gt;180 dias)
            </div>
          </div>
          <IconFileBroken className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("withAutoRefresh")}</span>
              <InfoTooltip content={t("kpiRefreshTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.autoRefreshCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.aggressiveRefreshCount > 0 ? (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  {t("aggressiveIntervals", { n: summary.aggressiveRefreshCount })}
                </span>
              ) : (
                t("noAggressiveIntervals")
              )}
            </div>
          </div>
          <IconRotateClockwise className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Graficas: Distribucion por Fuente + Tendencia de Escaneo ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            {t("costBySource")}
            <InfoTooltip content={t("costBySourceTooltip")} />
          </h3>
          {summary.breakdownByDataSource.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">{t("noData")}</div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie
                  data={summary.breakdownByDataSource}
                  dataKey="costUSD"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {summary.breakdownByDataSource.map((entry) => (
                    <Cell key={entry.dataSource} fill={entry.color} />
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
            <IconChartAreaLine className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            Volumen Escaneado (30 dias)
            <InfoTooltip content={t("trendTooltip")} />
          </h3>
          {costTrend.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              {t("noHistory")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <AreaChart data={costTrend}>
                <defs>
                  <linearGradient id="wbScanGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
                <RechartsTooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                <Area
                  type="monotone"
                  dataKey="estimatedCostUSD"
                  stroke="#0078D4"
                  strokeWidth={2}
                  fill="url(#wbScanGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── Barra de Filtros y Busqueda ─── */}
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
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("typeAll")}</option>
            <option value="Shared">{t("typeShared")}</option>
            <option value="Private">{t("typePrivate")}</option>
          </select>

          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("sourceAll")}</option>
            <option value="LogAnalytics">Log Analytics (KQL)</option>
            <option value="ResourceGraph">Azure Resource Graph</option>
            <option value="AzureMetrics">Azure Monitor Metrics</option>
            <option value="Mixed">{t("sourceMixed")}</option>
          </select>

          <select
            value={selectedHealth}
            onChange={(e) => setSelectedHealth(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("statusAll")}</option>
            <option value="VALID">{t("statusValid")}</option>
            <option value="BROKEN">{t("statusOrphan")}</option>
          </select>

          <select
            value={selectedRg}
            onChange={(e) => setSelectedRg(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("allRgs")}</option>
            {resourceGroups.map((rg) => (
              <option key={rg} value={rg}>
                {rg}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex justify-end">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="cost_desc">{t("sortCostDesc")}</option>
            <option value="refresh_desc">{t("sortRefresh")}</option>
            <option value="modified_asc">{t("sortAge")}</option>
            <option value="name_asc">{t("sortNameAsc")}</option>
            <option value="name_desc">{t("sortNameDesc")}</option>
          </select>
        </div>
      </div>

      {/* ─── Tabla de Inventario y Gobernanza (Ancho 100%) ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            {t("inventoryTitle")}
          </h3>
          <InfoTooltip content={t("tableTooltip")} />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{total} dashboards</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <ResizableTh minWidth={240}>Workbook</ResizableTh>
                <ResizableTh minWidth={150}>{t("colResourceGroup")}</ResizableTh>
                <ResizableTh minWidth={170}>Suscripcion</ResizableTh>
                <ResizableTh minWidth={160}>Fuente Principal</ResizableTh>
                <ResizableTh minWidth={130}>Auto-Refresh</ResizableTh>
                <ResizableTh minWidth={150}>{t("colLastModified")}</ResizableTh>
                <ResizableTh minWidth={130}>Salud</ResizableTh>
                <ResizableTh minWidth={110}>{t("colMonthlyCost")}</ResizableTh>
                <ResizableTh minWidth={190}>Acciones</ResizableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedWorkbooks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    <IconBook className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
                    <p className="text-xs font-medium">
                      {workbooksList.length === 0
                        ? "Azure Monitor no reporta workbooks en las suscripciones visibles."
                        : "Ningun workbook coincide con los filtros aplicados."}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedWorkbooks.map((w: WorkbookResourceItem) => (
                  <tr key={w.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => setDetailWorkbook(w)}
                        className="flex items-start gap-2 text-left cursor-pointer group"
                      >
                        <IconBook className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                        <span className="min-w-0">
                          <span className="block font-semibold text-[#1B2A41] dark:text-slate-100 group-hover:text-[#0054A6] truncate max-w-[240px]">
                            {w.displayName}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-white dark:bg-slate-900 ${
                              w.workbookType === "Shared"
                                ? "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
                                : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                            }`}
                          >
                            {w.workbookType === "Shared" ? (
                              <IconUsers className="w-3 h-3" stroke={2} />
                            ) : (
                              <IconLock className="w-3 h-3" stroke={2} />
                            )}
                            {w.workbookType === "Shared" ? "Compartido" : "Privado"}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 truncate max-w-[160px]" title={w.resourceGroup}>
                      {w.resourceGroup}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 truncate max-w-[180px]" title={w.subscriptionName}>
                      {w.subscriptionName}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900 whitespace-nowrap">
                        {WORKBOOK_SOURCE_LABELS[w.primaryDataSource]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <RefreshBadge workbook={w} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-slate-600 dark:text-slate-400">
                        {w.lastModifiedDate ? new Date(w.lastModifiedDate).toLocaleDateString() : "—"}
                      </span>
                      {w.daysSinceModified > 0 && (
                        <span
                          className={`block text-[10px] ${
                            w.daysSinceModified > 180 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-slate-400"
                          }`}
                        >
                          hace {w.daysSinceModified} dias
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <HealthBadge workbook={w} />
                    </td>
                    <td className="px-3 py-2.5 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                      {formatCurrency(w.estimatedQueryCostUSD)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setDetailWorkbook(w)}
                          className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                        >
                          <IconSparkles size={13} stroke={1.5} className="text-[#0054A6]" />
                          {t("viewKql")}
                        </button>
                        {w.autoRefreshSeconds > 0 && (
                          <button
                            onClick={() =>
                              setActiveRemediation({
                                id: `refresh-manual-${w.id}`,
                                resourceId: w.id,
                                title: `Ajustar auto-refresh de ${w.displayName}`,
                                description: `Se refresca cada ${w.autoRefreshInterval}. El intervalo vive dentro de serializedData, asi que el ajuste requiere exportar y reaplicar la definicion.`,
                                category: "DISABLE_AUTOREFRESH",
                                estimatedSavingsUSD: 0,
                                confidence: "MEDIUM",
                                actionType: "ADJUST_REFRESH",
                              })
                            }
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer flex items-center gap-1 whitespace-nowrap"
                          >
                            <IconClockPause className="w-3.5 h-3.5" />
                            Refresco
                          </button>
                        )}
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

      {/* ─── Panel de Recomendaciones Priorizadas ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              {t("actionsTitle")}
              <InfoTooltip content={t("actionsTooltip")} />
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t("totalPotentialSavings")}{" "}
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(summary.potentialSavingsUSD)}/mes
              </span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {data?.remediations && data.remediations.length > 0 ? (
            data.remediations.map((action) => (
              <div
                key={action.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between space-y-3 hover:border-blue-300 dark:hover:border-blue-700 transition"
              >
                <div className="space-y-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900 uppercase">
                      {action.category}
                    </span>
                    {action.estimatedSavingsUSD > 0 && (
                      <span className="text-xs font-extrabold text-emerald-600">
                        +{formatCurrency(action.estimatedSavingsUSD)}/mes
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">{action.title}</h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-3 leading-relaxed">
                    {action.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-medium">Confianza: {action.confidence}</span>
                  <button
                    onClick={() => setActiveRemediation(action)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1 cursor-pointer"
                  >
                    <IconTerminal2 className="w-3.5 h-3.5" />
                    Remediar
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              {t("noFindings")}
            </div>
          )}
        </div>
      </div>

      {/* ─── Capas superpuestas (z-50) ─── */}
      <WorkbookDetailDrawer workbook={detailWorkbook} onClose={() => setDetailWorkbook(null)} />
      <WorkbookRemediationModal action={activeRemediation} onClose={() => setActiveRemediation(null)} />
    </div>
  );
}
