"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  IconShieldCheck,
  IconCircleCheck,
  IconAlertCircle,
  IconFileCheck,
  IconColumns,
  IconSearch,
  IconPlus,
  IconTrash,
  IconEye,
  IconSparkles,
  IconX,
  IconRotateClockwise,
  IconAlertTriangle,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  AUTOBLOCK_COLORS,
  NON_COMPLIANT_COLUMNS,
  POLICY_COLUMNS,
  REMEDIABLE_EFFECTS,
  type AutoBlockPayload,
  type PolicyAssignmentItem,
  type PolicyEffectType,
  type NonCompliantResourceItem,
  type TableColumnConfig,
} from "@/types/azureAutoBlockPolicies.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
  "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const CELL = "min-w-[120px] max-w-[240px] truncate";

function EffectBadge({ effect, enforced = true }: { effect: PolicyEffectType; enforced?: boolean }) {
  const t = useTranslations("AutoBlockPolicies");
  const style =
    effect === "Deny"
      ? "border-blue-300 dark:border-blue-700 text-[#0054A6]"
      : effect === "Modify" || effect === "DeployIfNotExists"
        ? "border-blue-200 dark:border-blue-800 text-blue-600"
        : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${style}`}>
        {effect}
      </span>
      {!enforced && (
        <span
          title={t("doNotEnforceTooltip")}
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 whitespace-nowrap"
        >
          {t("notEnforced")}
        </span>
      )}
    </span>
  );
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
  const t = useTranslations("AutoBlockPolicies");
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

export default function AutoBlockPoliciesPanel() {
  const t = useTranslations("AutoBlockPolicies");
  /**
   * En vivo, Azure nombra la asignacion y la descripcion; el dataset demo las
   * manda por clave para que el sandbox no quede en espanol en los otros dos
   * idiomas.
   */
  const policyName = (a: PolicyAssignmentItem) => (a.displayNameKey ? t(a.displayNameKey) : a.displayName);
  const policyDesc = (a: PolicyAssignmentItem) =>
    a.descriptionKey ? t(a.descriptionKey) : a.description || t("noDescription");
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
  const apiUrl = `/api/governance/auto-block?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;

  const { data, error, isValidating, mutate } = useSWR<AutoBlockPayload>(
    canFetch ? apiUrl : null,
    async (url: string) => {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const summary = data?.summary;
  const assignments = useMemo(() => summary?.activeAssignments || [], [summary]);

  // ─── Asistente de despliegue ───
  const [deployScope, setDeployScope] = useState("");
  const [definitionSearch, setDefinitionSearch] = useState("");
  const [selectedDefinition, setSelectedDefinition] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);

  // ─── Tabla de políticas ───
  const [scopeFilter, setScopeFilter] = useState("ALL");
  const [drawerPolicy, setDrawerPolicy] = useState<PolicyAssignmentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyAssignmentItem | null>(null);
  const [remediating, setRemediating] = useState<string | null>(null);
  /** Ids ocultos por eliminación optimista mientras ARM procesa el DELETE. */
  const [optimisticDeleted, setOptimisticDeleted] = useState<Set<string>>(new Set());

  const policyCols = useColumnConfig(`table_columns_config_auto_block_policies_${tenantId}`, POLICY_COLUMNS);
  const detailCols = useColumnConfig(`table_columns_config_auto_block_detail_${tenantId}`, NON_COMPLIANT_COLUMNS);

  const scopes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of assignments) if (a.scopeId) seen.set(a.scopeId, a.scopeDisplayName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments]);

  const filteredAssignments = useMemo(
    () =>
      assignments.filter(
        (a) => !optimisticDeleted.has(a.id) && (scopeFilter === "ALL" || a.scopeId === scopeFilter)
      ),
    [assignments, scopeFilter, optimisticDeleted]
  );

  const policyPg = usePagination(filteredAssignments, 15);

  const drawerResources = useMemo(() => {
    if (!drawerPolicy) return [];
    return (data?.nonCompliantResources || []).filter(
      (r) => r.violatedPolicyName === drawerPolicy.displayName || r.violatedPolicyName === drawerPolicy.name
    );
  }, [drawerPolicy, data]);

  const drawerPg = usePagination(drawerResources, 15);

  const templates = useMemo(() => {
    const q = definitionSearch.trim().toLowerCase();
    return (data?.definitionTemplates || []).filter(
      (tpl) => !q || t(tpl.displayNameKey).toLowerCase().includes(q) || tpl.category.toLowerCase().includes(q)
    );
  }, [data, definitionSearch]);

  const donutData = useMemo(
    () => [
      { name: "Conformes", value: summary?.totalCompliantCount || 0, color: AUTOBLOCK_COLORS.compliant },
      { name: "No conformes", value: summary?.totalNonCompliantCount || 0, color: AUTOBLOCK_COLORS.nonCompliant },
    ],
    [summary]
  );
  const hasEvaluations = (summary?.totalCompliantCount || 0) + (summary?.totalNonCompliantCount || 0) > 0;

  // ─── Mutaciones ───
  const handleDeploy = async () => {
    const tpl = (data?.definitionTemplates || []).find((t) => t.definitionId === selectedDefinition);
    if (!deployScope || !tpl) {
      toast.error(t("pickScopeAndDefinition"));
      return;
    }
    setIsDeploying(true);
    try {
      const res = await fetch(`/api/governance/auto-block/deploy${isMock ? "?mock=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          definitionId: tpl.definitionId,
          scopeId: deployScope,
          effect: tpl.effect,
          displayName: t(tpl.displayNameKey),
          description: t(tpl.descriptionKey),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(body.message || t("policyDeployed"));
      setSelectedDefinition("");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || t("deployFailed"));
    } finally {
      setIsDeploying(false);
    }
  };

  const handleRemediate = async (a: PolicyAssignmentItem) => {
    setRemediating(a.id);
    try {
      const res = await fetch(`/api/governance/auto-block/remediate${isMock ? "?mock=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ tenantId, policyAssignmentId: a.id, scopeId: a.scopeId, effect: a.effect }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(body.message || t("remediationTaskCreated"));
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || t("remediationFailed"));
    } finally {
      setRemediating(null);
    }
  };

  const handleDelete = async (a: PolicyAssignmentItem) => {
    setDeleteTarget(null);
    setOptimisticDeleted((prev) => new Set(prev).add(a.id));
    try {
      const res = await fetch(
        `/api/governance/auto-block/deploy?tenantId=${encodeURIComponent(tenantId)}&assignmentId=${encodeURIComponent(a.id)}${isMock ? "&mock=true" : ""}`,
        { method: "DELETE", headers: await authHeaders() }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(t("assignmentDeleted"));
      mutate();
    } catch (e) {
      // La política sigue viva: se restaura la fila en vez de dejar la tabla
      // mostrando una eliminación que no ocurrió.
      setOptimisticDeleted((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
      toast.error(errorMessage(e) || t("deleteFailed"));
    }
  };

  const kpis = [
    {
      label: t("kpiOverall"),
      tip: t("kpiOverallTip"),
      value: hasEvaluations ? `${summary?.overallCompliancePercentage.toFixed(1)}%` : "—",
      sub: hasEvaluations
        ? t("evaluationsCount", { count: (summary?.totalCompliantCount || 0) + (summary?.totalNonCompliantCount || 0) })
        : t("noEvaluations"),
      Icon: IconShieldCheck,
      color: "text-[#0078D4]",
    },
    {
      label: t("kpiCompliant"),
      tip: t("kpiCompliantTip"),
      value: `${summary?.totalCompliantCount || 0}`,
      sub: t("noViolations"),
      Icon: IconCircleCheck,
      color: "text-[#2563EB]",
    },
    {
      label: t("kpiNonCompliant"),
      tip: t("kpiNonCompliantTip"),
      value: `${summary?.totalNonCompliantCount || 0}`,
      sub: t("withDetail", { count: data?.nonCompliantResources.length || 0 }),
      Icon: IconAlertCircle,
      color: "text-[#0284C7]",
    },
    {
      label: t("kpiActivePolicies"),
      tip: t("kpiActivePoliciesTip"),
      value: `${summary?.activeAssignmentsCount || 0}`,
      sub: t("notEnforcedCount", { count: assignments.filter((a) => !a.isEnforced).length }),
      Icon: IconFileCheck,
      color: "text-slate-900 dark:text-white",
    },
  ];

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconShieldCheck size={22} className="text-[#0078D4]" stroke={1.5} />
              <span>{t("pageTitle")}</span>
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
            {t("pageSubtitle")}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
        >
          <IconRotateClockwise size={16} className={`text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
          {t("refresh")}
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── KPIs ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between"
          >
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span>{k.label}</span>
                <InfoTooltip content={k.tip} />
              </div>
              <div className={`text-2xl font-extrabold truncate ${k.color}`}>{k.value}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={k.sub}>
                {k.sub}
              </div>
            </div>
            <k.Icon size={32} className="text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Fila 1: donut + categorías ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5 mb-3">
            {t("globalComplianceTitle")}
            <InfoTooltip content={t("globalComplianceTooltip")} />
          </h3>
          {hasEvaluations ? (
            <>
              <div className="relative h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
                      {donutData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [t("resourcesCount", { count: Number(v ?? 0) }), ""]}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-extrabold text-[#0078D4]">
                    {summary?.overallCompliancePercentage.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">{t("compliantWord")}</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
                  {t("compliantLabel", { count: summary?.totalCompliantCount ?? 0 })}
                </span>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400">
                  {t("nonCompliantLabel", { count: summary?.totalNonCompliantCount ?? 0 })}
                </span>
              </div>
            </>
          ) : (
            <div className="h-52 flex flex-col items-center justify-center text-center gap-2">
              <IconInfoCircle size={28} className="text-[#0078D4]" stroke={1.5} />
              <p className="text-xs text-slate-500 dark:text-slate-400 px-4">
                {t("noEvaluationsHint")}
              </p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5 mb-3">
            {t("categoryComplianceTitle")}
            <InfoTooltip content={t("categoryComplianceTooltip")} />
          </h3>
          <div className="space-y-2.5">
            {(summary?.categoryCompliance || []).slice(0, 8).map((c) => (
              <div key={c.categoryKey} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#1B2A41] dark:text-slate-100 truncate" title={c.categoryDisplayName}>
                    {c.categoryDisplayName}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                    {t("categoryRatio", { pct: c.compliancePercentage.toFixed(1), ok: c.compliantResources, total: c.totalResources })}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${c.compliancePercentage}%`, backgroundColor: AUTOBLOCK_COLORS.compliant }}
                  />
                </div>
              </div>
            ))}
            {(summary?.categoryCompliance || []).length === 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
                {t("noCategoryEvaluations")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Fila 2: iniciativas ─── */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
          {t("initiativesTitle")}
          <InfoTooltip content={t("initiativesTooltip")} />
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {(summary?.initiatives || []).map((ini) => (
            <div
              key={ini.id}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <IconShieldCheck size={16} className="text-[#0078D4] shrink-0" stroke={1.5} />
                    <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 truncate" title={ini.displayName}>
                      {ini.displayName}
                    </h4>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t("initiativeStats", { policies: ini.totalPoliciesCount, resources: ini.totalEvaluatedResources })}
                  </span>
                </div>
                <button
                  onClick={() => setScopeFilter("ALL")}
                  title={t("viewGapsTooltip")}
                  className="text-[11px] font-semibold text-[#0054A6] cursor-pointer bg-transparent whitespace-nowrap"
                >
                  <IconSparkles size={14} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                  {t("viewGaps")}
                </button>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${ini.compliancePercentage}%`,
                      backgroundColor:
                        ini.status === "HEALTHY" ? AUTOBLOCK_COLORS.compliant : AUTOBLOCK_COLORS.gap,
                    }}
                  />
                </div>
                <span className="text-sm font-extrabold text-[#0078D4] tabular-nums whitespace-nowrap">
                  {ini.compliancePercentage.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
          {(summary?.initiatives || []).length === 0 && (
            <div className="lg:col-span-2 py-8 text-center text-xs text-slate-500 dark:text-slate-400 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {t("noInitiatives")}
            </div>
          )}
        </div>
      </div>

      {/* ─── Fila 3: asistente de despliegue ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            {t("deployWizardTitle")}
            <InfoTooltip content={t("deployWizardTooltip")} />
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("deployWizardSubtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{t("scopeLabel")}</label>
            <select
              value={deployScope}
              onChange={(e) => setDeployScope(e.target.value)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="">{t("selectScope")}</option>
              {(data?.availableScopes || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} ({s.type === "ManagementGroup" ? "Management Group" : s.type === "Subscription" ? t("scopeSubscription") : "Resource Group"})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{t("definitionLabel")}</label>
            <div className="relative">
              <IconSearch size={14} className="text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder={t("searchTemplate")}
                value={definitionSearch}
                onChange={(e) => setDefinitionSearch(e.target.value)}
                className="w-full pl-8 pr-2 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {templates.map((tpl) => (
            <button
              key={tpl.definitionId}
              onClick={() => setSelectedDefinition(tpl.definitionId)}
              className={`p-3 rounded-xl border text-left cursor-pointer transition space-y-1.5 bg-white dark:bg-slate-900 ${
                selectedDefinition === tpl.definitionId
                  ? "border-[#0078D4]"
                  : "border-slate-200 dark:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">
                  {t(tpl.displayNameKey)}
                </span>
                <EffectBadge effect={tpl.effect} />
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
                {t(tpl.descriptionKey)}
              </p>
              <p className="text-[10px] text-[#0054A6] leading-relaxed">{t(tpl.rationaleKey)}</p>
            </button>
          ))}
        </div>

        <button
          onClick={handleDeploy}
          disabled={isDeploying || !deployScope || !selectedDefinition}
          className="w-full py-2.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50"
        >
          <IconPlus size={16} className="inline mr-1.5" stroke={2} />
          {t("deployButton")}
        </button>
      </div>

      {/* ─── Fila 4: tabla de políticas activas ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            {t("activePoliciesTitle")}
            <InfoTooltip content={t("activePoliciesTooltip")} />
          </h3>
          <ColumnMenu {...policyCols} />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setScopeFilter("ALL")}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border cursor-pointer bg-white dark:bg-slate-900 ${
              scopeFilter === "ALL" ? "border-[#0078D4] text-[#0054A6]" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            }`}
          >
            {t("filterAll")}
          </button>
          {scopes.map((s) => (
            <button
              key={s.id}
              onClick={() => setScopeFilter(s.id)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border cursor-pointer bg-white dark:bg-slate-900 whitespace-nowrap ${
                scopeFilter === s.id ? "border-[#0078D4] text-[#0054A6]" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-xs table-fixed">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {POLICY_COLUMNS.filter((c) => policyCols.isVisible(c.id)).map((c) => (
                  <ResizableTh
                    key={c.id}
                    minWidth={c.minWidth}
                    className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200"
                  >
                    {t(`col_${c.id}`)}
                  </ResizableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {policyPg.paged.length === 0 ? (
                <tr>
                  <td colSpan={POLICY_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    {assignments.length === 0 ? t("emptyAssignments") : t("emptyFiltered")}
                  </td>
                </tr>
              ) : (
                policyPg.paged.map((a: PolicyAssignmentItem) => (
                  <tr key={a.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    {policyCols.isVisible("policy") && (
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <IconShieldCheck size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 ${CELL}`} title={policyName(a)}>
                            {policyName(a)}
                          </span>
                        </div>
                      </td>
                    )}
                    {policyCols.isVisible("effect") && (
                      <td className="py-2.5 px-3">
                        <EffectBadge effect={a.effect} enforced={a.isEnforced} />
                      </td>
                    )}
                    {policyCols.isVisible("scope") && (
                      <td className="py-2.5 px-3">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 inline-block ${CELL}`}
                          title={a.scopeId}
                        >
                          {a.scopeDisplayName}
                        </span>
                      </td>
                    )}
                    {policyCols.isVisible("nonCompliant") && (
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-[#0078D4] tabular-nums">{a.nonCompliantResourcesCount}</span>
                        <span className="text-slate-400"> / {a.nonCompliantResourcesCount + a.compliantResourcesCount}</span>
                      </td>
                    )}
                    {policyCols.isVisible("description") && (
                      <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={policyDesc(a)}>
                        {policyDesc(a)}
                      </td>
                    )}
                    {policyCols.isVisible("actions") && (
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {REMEDIABLE_EFFECTS.includes(a.effect) && (
                            <button
                              onClick={() => handleRemediate(a)}
                              disabled={remediating === a.id}
                              title={t("remediateTooltip")}
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                            >
                              <IconSparkles size={14} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                              {remediating === a.id ? t("creating") : t("remediate")}
                            </button>
                          )}
                          <button
                            onClick={() => setDrawerPolicy(a)}
                            title={t("viewNonCompliant")}
                            className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
                          >
                            <IconEye size={14} className="inline mr-1" stroke={1.5} />
                            {t("view")}
                          </button>
                          <button onClick={() => setDeleteTarget(a)} title={t("deleteAssignment")} className="cursor-pointer bg-transparent">
                            <IconTrash size={16} className="text-slate-400 hover:text-rose-600" stroke={1.5} />
                          </button>
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
          page={policyPg.page}
          totalPages={policyPg.totalPages}
          pageSize={policyPg.pageSize}
          total={policyPg.total}
          setPage={policyPg.setPage}
          setPageSize={policyPg.setPageSize}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* ─── Drawer: recursos no conformes ─── */}
      {drawerPolicy && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-[100]">
          <div className="w-full max-w-4xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                  <IconEye size={18} className="text-[#0078D4]" stroke={1.5} />
                  {t("nonCompliantDrawerTitle")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate" title={policyName(drawerPolicy)}>
                  {policyName(drawerPolicy)} · {drawerPolicy.scopeDisplayName}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ColumnMenu {...detailCols} />
                <button onClick={() => setDrawerPolicy(null)} className="cursor-pointer bg-transparent">
                  <IconX size={18} className="text-slate-400" stroke={1.5} />
                </button>
              </div>
            </div>

            <div className={VISIBLE_SCROLLBAR}>
              <table className="w-full text-xs table-fixed">
                <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    {NON_COMPLIANT_COLUMNS.filter((c) => detailCols.isVisible(c.id)).map((c) => (
                      <ResizableTh
                        key={c.id}
                        minWidth={c.minWidth}
                        className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200"
                      >
                        {t(`col_${c.id}`)}
                      </ResizableTh>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {drawerPg.paged.length === 0 ? (
                    <tr>
                      <td colSpan={NON_COMPLIANT_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        {drawerPolicy.nonCompliantResourcesCount > 0 ? t("detailTruncated") : t("emptyNonCompliantDetail")}
                      </td>
                    </tr>
                  ) : (
                    drawerPg.paged.map((r: NonCompliantResourceItem) => (
                      <tr key={r.resourceId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        {detailCols.isVisible("resource") && (
                          <td className="py-2.5 px-3">
                            <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 block ${CELL}`} title={r.resourceId}>
                              {r.resourceName}
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block">{r.resourceGroup}</span>
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
                          <td className="py-2.5 px-3">
                            <span
                              className={`text-slate-600 dark:text-slate-300 block ${CELL}`}
                              title={r.violatedPolicyNameKey ? t(r.violatedPolicyNameKey) : r.violatedPolicyName}
                            >
                              {r.violatedPolicyNameKey ? t(r.violatedPolicyNameKey) : r.violatedPolicyName}
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block" title={t(r.reasonKey)}>
                              {t(r.reasonKey).slice(0, 70)}
                              {t(r.reasonKey).length > 70 ? "…" : ""}
                            </span>
                          </td>
                        )}
                        {detailCols.isVisible("effect") && (
                          <td className="py-2.5 px-3">
                            <EffectBadge effect={r.policyEffect} />
                          </td>
                        )}
                        {detailCols.isVisible("actions") && (
                          <td className="py-2.5 px-3">
                            {REMEDIABLE_EFFECTS.includes(r.policyEffect) ? (
                              <button
                                onClick={() => handleRemediate(drawerPolicy)}
                                className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 cursor-pointer whitespace-nowrap"
                              >
                                <IconSparkles size={14} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                                {t("remediate")}
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400" title={t("notRemediableTooltip")}>
                                {t("notRemediable")}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={drawerPg.page}
              totalPages={drawerPg.totalPages}
              pageSize={drawerPg.pageSize}
              total={drawerPg.total}
              setPage={drawerPg.setPage}
              setPageSize={drawerPg.setPageSize}
              pageSizes={[15, 30, 45, 60]}
            />
          </div>
        </div>
      )}

      {/* ─── Modal: confirmar eliminación ─── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconTrash size={18} className="text-[#0078D4]" stroke={1.5} />
                {t("deleteModalTitle")}
              </h3>
              <button onClick={() => setDeleteTarget(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t.rich("deleteModalBody", {
                policy: policyName(deleteTarget),
                scope: deleteTarget.scopeDisplayName,
                b: (c) => <strong className="text-[#1B2A41] dark:text-slate-100">{c}</strong>,
              })}
              {deleteTarget.effect === "Deny" && <> {t.rich("deleteModalDenyNote", { b: (c) => <strong>{c}</strong> })}</>}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
              >
                {t("deleteAssignment")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <span className="text-[10px] text-slate-400">
          {t("footerSource")}
        </span>
      </div>
    </div>
  );
}
