"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import {
  IconShieldCheck,
  IconFileCheck,
  IconUsersGroup,
  IconDownload,
  IconFileSpreadsheet,
  IconChevronDown,
  IconChevronUp,
  IconColumns,
  IconSparkles,
  IconX,
  IconRotateClockwise,
  IconAlertTriangle,
  IconInfoCircle,
  IconServer,
  IconDatabase,
  IconNetwork,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import { buildCsvRows, toCsv } from "@/services/azureGovernanceReporting.service";
import {
  NON_COMPLIANT_COLUMNS,
  RBAC_COLUMNS,
  REPORTING_COLORS,
  type GovernanceReportingPayload,
  type NonCompliantResourceDetail,
  type OrphanedAssignmentDetail,
  type TableColumnConfig,
} from "@/types/azureGovernanceReporting.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
  "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const CELL = "min-w-[120px] max-w-[240px] truncate";

/** Enteros con el locale activo. Antes era "es-AR" fijo para los tres idiomas. */
function useNum() {
  const locale = useLocale();
  return useCallback((v: number) => v.toLocaleString(locale), [locale]);
}

/** Color de la barra según la familia del recurso, dentro de la escala azul. */
function barColorFor(label: string): string {
  const s = label.toLowerCase();
  if (s.includes("machine") || s.includes("app service") || s.includes("compute")) return REPORTING_COLORS.compute;
  if (s.includes("storage") || s.includes("database") || s.includes("disk") || s.includes("vault"))
    return REPORTING_COLORS.storage;
  if (s.includes("network") || s.includes("ip") || s.includes("security group")) return REPORTING_COLORS.network;
  return REPORTING_COLORS.neutral;
}

function useColumnConfig(storageKey: string, defaults: TableColumnConfig[]) {
  const [columns, setColumns] = useState<TableColumnConfig[]>(defaults);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      setColumns((prev) =>
        prev.map((c) => {
          const m = parsed.find((p: { id?: string }) => p?.id === c.id);
          return m ? { ...c, visible: Boolean(m.visible) } : c;
        })
      );
    } catch {
      // Preferencia corrupta: se ignora.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(columns.map((c) => ({ id: c.id, visible: c.visible }))));
    } catch {
      // Cuota llena o modo privado.
    }
  }, [columns, storageKey]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const isVisible = useCallback((id: string) => columns.find((c) => c.id === id)?.visible ?? true, [columns]);
  const toggle = useCallback(
    (id: string) => setColumns((p) => p.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))),
    []
  );
  return { columns, isVisible, toggle, open, setOpen, menuRef };
}

function ColumnMenu({ columns, toggle, open, setOpen, menuRef }: ReturnType<typeof useColumnConfig>) {
  const t = useTranslations("GovernanceReporting");
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
      >
        <IconColumns size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
        {t("customizeColumns")}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-60 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-[100] space-y-0.5">
          {columns.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <input type="checkbox" checked={c.visible} onChange={() => toggle(c.id)} className="accent-[#0054A6] cursor-pointer" />
              {t(`col_${c.id}`)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function DistributionBar({ label, count, percentage, color }: { label: string; count: number; percentage: number; color: string }) {
  const n = useNum();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-[#1B2A41] dark:text-slate-100 truncate" title={label}>
          {label}
        </span>
        <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
          {n(count)} <span className="text-slate-400">({percentage.toFixed(1)}%)</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, percentage)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function GovernanceReportingPanel() {
  const t = useTranslations("GovernanceReporting");
  const n = useNum();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const isMock = useMemo(
    () =>
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-"),
    [tenantId, searchParams]
  );

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (isMock || accounts.length === 0) return {};
    try {
      const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [instance, accounts, isMock]);

  const canFetch = Boolean(tenantId) && (isMock || accounts.length > 0);
  const apiUrl = `/api/governance/reporting?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;

  const { data, error, isValidating, mutate } = useSWR<GovernanceReportingPayload>(
    canFetch ? apiUrl : null,
    async (url: string) => {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const summary = data?.summary;

  const [showNonCompliant, setShowNonCompliant] = useState(false);
  const [showRbacDrawer, setShowRbacDrawer] = useState(false);
  const [showScoreDetail, setShowScoreDetail] = useState(false);

  const detailCols = useColumnConfig(`table_columns_config_gov_reporting_${tenantId}`, NON_COMPLIANT_COLUMNS);
  const rbacCols = useColumnConfig(`table_columns_config_gov_reporting_rbac_${tenantId}`, RBAC_COLUMNS);

  const nonCompliantPg = usePagination(data?.nonCompliantResources || [], 15);
  const rbacPg = usePagination(data?.orphanedAssignments || [], 15);

  const maxRbac = useMemo(
    () => Math.max(1, ...(summary?.rbacBreakdown || []).map((b) => b.count)),
    [summary]
  );

  const handleCsv = () => {
    if (!data) return;
    const csv = toCsv(buildCsvRows(data, (k, args) => t(k, args)));
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reporting-gobernanza-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  /**
   * El PDF se genera con el diálogo de impresión del navegador en vez de
   * embeber una librería: es la misma salida vectorial, sin sumar peso al
   * bundle ni un segundo motor de layout que mantener sincronizado con la UI.
   */
  const handlePdf = () => {
    if (typeof window === "undefined") return;
    toast.info(t("pdfToast"));
    window.print();
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconShieldCheck size={22} className="text-[#0078D4]" stroke={1.5} />
              <span>{t("title")}</span>
            </h1>
            <InfoTooltip
              content={t("pageTooltip")}
              position="bottom"
              align="left"
            />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? t("sourceLive") : t("sourceDemo")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <button
            onClick={handlePdf}
            disabled={!data}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50"
          >
            <IconDownload size={16} className="inline mr-1.5" stroke={2} />
            {t("exportPdf")}
          </button>
          <button
            onClick={handleCsv}
            disabled={!data}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-50"
          >
            <IconFileSpreadsheet size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
            {t("exportCsv")}
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 cursor-pointer disabled:opacity-60"
          >
            <IconRotateClockwise size={16} className={`inline text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── Sección 1: Score ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs text-center space-y-1">
        <IconShieldCheck size={32} className="text-[#0078D4] mx-auto mb-2" stroke={1.5} />
        <div className="flex items-center justify-center gap-1.5">
          <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{t("scoreTitle")}</h2>
          <InfoTooltip content={t("scoreTooltip")} />
        </div>
        <div className="text-5xl font-extrabold text-[#0078D4] tabular-nums">
          {summary?.financialSecurityScorePercentage.toFixed(0) ?? 0}%
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {summary
            ? t("scoreSubtitle", {
                resources: summary.auditedResourcesCount,
                assignments: summary.activePolicyAssignmentsCount,
                subscriptions: summary.subscriptionsCount,
              })
            : t("loadingInventory")}
        </p>
        <button
          onClick={() => setShowScoreDetail(!showScoreDetail)}
          className="text-[11px] font-semibold text-[#0054A6] cursor-pointer bg-transparent print:hidden"
        >
          {showScoreDetail ? <IconChevronUp size={14} className="inline mr-1" /> : <IconChevronDown size={14} className="inline mr-1" />}
          {showScoreDetail ? t("hidePillars") : t("showPillars")}
        </button>

        {showScoreDetail && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 text-left">
            {(summary?.pillars || []).map((p) => (
              <div key={p.pillar} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">{t(`pillar_${p.pillar}`)}</span>
                  <span className="text-xs font-extrabold text-[#0078D4] tabular-nums whitespace-nowrap">
                    {p.measurable ? `${p.rawScore}%` : t("notMeasurable")}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden my-1.5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${p.measurable ? p.rawScore : 0}%`,
                      backgroundColor: p.measurable ? REPORTING_COLORS.compute : REPORTING_COLORS.neutral,
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t("pillarWeight", { weight: p.weight })}
                  {p.measurable && p.effectiveWeight !== p.weight ? t("pillarEffectiveWeight", { effective: p.effectiveWeight }) : ""} ·{" "}
                  {t(p.detailKey, p.detailArgs)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Sección 2: Azure Policy ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
          <IconFileCheck size={18} className="text-[#0078D4]" stroke={1.5} />
          {t("policyTitle")}
          <InfoTooltip content={t("policyTooltip")} />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              value: summary?.nonCompliantResourcesCount ?? 0,
              key: "nonCompliantResources",
              color: "text-[#0078D4]",
              expandable: true,
            },
            { value: summary?.nonCompliantPoliciesCount ?? 0, key: "nonCompliantPolicies", color: "text-[#2563EB]", expandable: false },
            { value: summary?.activePolicyAssignmentsCount ?? 0, key: "policyAssignments", color: "text-[#0284C7]", expandable: false },
          ].map((c) => (
            <div key={c.key} className="space-y-1">
              <div className={`text-3xl font-extrabold tabular-nums ${c.color}`}>{n(c.value)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t(c.key)}</div>
              {c.expandable && (
                <button
                  onClick={() => setShowNonCompliant(!showNonCompliant)}
                  className="text-[11px] font-semibold text-[#0054A6] cursor-pointer bg-transparent print:hidden"
                >
                  {showNonCompliant ? <IconChevronUp size={14} className="inline ml-1" /> : <IconChevronDown size={14} className="inline ml-1" />}
                  {t("showDetail")}
                </button>
              )}
            </div>
          ))}
        </div>

        {showNonCompliant && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">{t("nonCompliantTitle")}</h4>
              <ColumnMenu {...detailCols} />
            </div>
            <div className={VISIBLE_SCROLLBAR}>
              <table className="w-full text-xs table-fixed">
                <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    {NON_COMPLIANT_COLUMNS.filter((c) => detailCols.isVisible(c.id)).map((c) => (
                      <ResizableTh key={c.id} minWidth={c.minWidth} className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200">
                        {t(`col_${c.id}`)}
                      </ResizableTh>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {nonCompliantPg.paged.length === 0 ? (
                    <tr>
                      <td colSpan={NON_COMPLIANT_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        {t("emptyNonCompliant")}
                      </td>
                    </tr>
                  ) : (
                    nonCompliantPg.paged.map((r: NonCompliantResourceDetail, i: number) => (
                      <tr key={`${r.resourceId}-${i}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        {detailCols.isVisible("resource") && (
                          <td className="py-2.5 px-3">
                            <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 block ${CELL}`} title={r.resourceId}>
                              {r.resourceName}
                            </span>
                          </td>
                        )}
                        {detailCols.isVisible("type") && (
                          <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={r.resourceType}>
                            {r.resourceType}
                          </td>
                        )}
                        {detailCols.isVisible("subscription") && (
                          <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={r.subscriptionName}>
                            {r.subscriptionName}
                          </td>
                        )}
                        {detailCols.isVisible("policy") && (
                          <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={r.violatedPolicyName}>
                            {r.violatedPolicyName}
                          </td>
                        )}
                        {detailCols.isVisible("effect") && (
                          <td className="py-2.5 px-3">
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 whitespace-nowrap"
                              title={r.policyEffect === "—" ? t("effectTooltip") : undefined}
                            >
                              {r.policyEffect}
                            </span>
                          </td>
                        )}
                        {detailCols.isVisible("actions") && (
                          <td className="py-2.5 px-3">
                            <a
                              href="/governance/policies"
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 cursor-pointer whitespace-nowrap inline-block"
                            >
                              <IconSparkles size={14} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                              {t("remediate")}
                            </a>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={nonCompliantPg.page}
              totalPages={nonCompliantPg.totalPages}
              pageSize={nonCompliantPg.pageSize}
              total={nonCompliantPg.total}
              setPage={nonCompliantPg.setPage}
              setPageSize={nonCompliantPg.setPageSize}
              pageSizes={[15, 30, 45, 60]}
            />
          </div>
        )}
      </div>

      {/* ─── Sección 3: Inventario ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
          <IconServer size={18} className="text-[#0078D4]" stroke={1.5} />
          {t("inventoryTitleCount", { count: n(summary?.auditedResourcesCount || 0) })}
          <InfoTooltip content={t("inventoryTooltip")} />
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <IconDatabase size={14} className="text-[#0078D4]" stroke={1.5} />
              {t("byType")}
            </h4>
            {(summary?.resourceTypeBreakdown || []).map((t) => (
              <DistributionBar
                key={t.typeKey}
                label={t.typeDisplayName}
                count={t.count}
                percentage={t.percentage}
                color={barColorFor(t.typeDisplayName)}
              />
            ))}
            {(summary?.resourceTypeBreakdown || []).length === 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">{t("emptyInventory")}</p>
            )}
          </div>
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <IconNetwork size={14} className="text-[#0078D4]" stroke={1.5} />
              {t("byLocation")}
            </h4>
            {(summary?.regionBreakdown || []).map((r) => (
              <DistributionBar
                key={r.regionKey}
                label={r.regionDisplayName}
                count={r.count}
                percentage={r.percentage}
                color={REPORTING_COLORS.region}
              />
            ))}
            {(summary?.regionBreakdown || []).length === 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">{t("emptyRegions")}</p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Sección 4: RBAC ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            <IconUsersGroup size={18} className="text-[#0078D4]" stroke={1.5} />
            {t("rbacTitleCount", { count: n(summary?.totalRbacAssignmentsCount || 0) })}
            <InfoTooltip content={t("rbacTooltip")} />
          </h3>
          <button
            onClick={() => setShowRbacDrawer(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 cursor-pointer whitespace-nowrap print:hidden"
          >
            <IconSparkles size={16} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
            {t("auditOrphans")}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(summary?.rbacBreakdown || []).map((b, i) => (
            <div key={b.principalType} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#1B2A41] dark:text-slate-100">{b.principalType}</span>
                <span className="font-extrabold text-[#0078D4] tabular-nums">{n(b.count)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(b.count / maxRbac) * 100}%`,
                    backgroundColor: [REPORTING_COLORS.compute, REPORTING_COLORS.storage, REPORTING_COLORS.network][i % 3],
                  }}
                />
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {t("withPrivilegedRole", { count: b.privilegedRolesCount })}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <IconInfoCircle size={16} className="text-[#0078D4] shrink-0" stroke={1.5} />
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t.rich("orphanSidsDetected", {
                count: n(summary?.orphanedSidsCount || 0),
                b: (c) => <strong className="text-[#0078D4] tabular-nums">{c}</strong>,
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <IconShieldCheck size={16} className="text-[#0078D4] shrink-0" stroke={1.5} />
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t.rich("privilegedAssignments", {
                count: n(summary?.privilegedRolesCount || 0),
                b: (c) => <strong className="text-[#0078D4] tabular-nums">{c}</strong>,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* ─── Footer ─── */}
      <p className="text-[11px] text-slate-400 text-center">
        {t("source", { subs: n(summary?.subscriptionsCount || 0) })}
      </p>

      {/* ─── Drawer: auditoría RBAC ─── */}
      {showRbacDrawer && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-[100] print:hidden">
          <div className="w-full max-w-4xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                  <IconUsersGroup size={18} className="text-[#0078D4]" stroke={1.5} />
                  {t("drawerTitle")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t("drawerSubtitle", { orphans: n(summary?.orphanedSidsCount || 0), privileged: n(summary?.privilegedRolesCount || 0) })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ColumnMenu {...rbacCols} />
                <button onClick={() => setShowRbacDrawer(false)} className="cursor-pointer bg-transparent">
                  <IconX size={18} className="text-slate-400" stroke={1.5} />
                </button>
              </div>
            </div>

            <div className={VISIBLE_SCROLLBAR}>
              <table className="w-full text-xs table-fixed">
                <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    {RBAC_COLUMNS.filter((c) => rbacCols.isVisible(c.id)).map((c) => (
                      <ResizableTh key={c.id} minWidth={c.minWidth} className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200">
                        {t(`col_${c.id}`)}
                      </ResizableTh>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rbacPg.paged.length === 0 ? (
                    <tr>
                      <td colSpan={RBAC_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        {t("emptyRbac")}
                      </td>
                    </tr>
                  ) : (
                    rbacPg.paged.map((a: OrphanedAssignmentDetail) => (
                      <tr key={a.assignmentId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        {rbacCols.isVisible("principal") && (
                          <td className={`py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300 ${CELL}`} title={a.principalId}>
                            {a.principalId}
                          </td>
                        )}
                        {rbacCols.isVisible("type") && (
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{a.principalType}</td>
                        )}
                        {rbacCols.isVisible("role") && (
                          <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={a.roleName}>
                            {a.roleName}
                          </td>
                        )}
                        {rbacCols.isVisible("scope") && (
                          <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={a.scopeDisplayName}>
                            {a.scopeDisplayName}
                          </td>
                        )}
                        {rbacCols.isVisible("status") && (
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1 flex-wrap">
                              {a.isOrphaned && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 text-[#0054A6] whitespace-nowrap">
                                  {t("badgeOrphanSid")}
                                </span>
                              )}
                              {a.isPrivileged && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  {t("badgePrivileged")}
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={rbacPg.page}
              totalPages={rbacPg.totalPages}
              pageSize={rbacPg.pageSize}
              total={rbacPg.total}
              setPage={rbacPg.setPage}
              setPageSize={rbacPg.setPageSize}
              pageSizes={[15, 30, 45, 60]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
