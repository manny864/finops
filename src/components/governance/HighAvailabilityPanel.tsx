"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import {
  IconShieldCheck,
  IconAlertOctagon,
  IconAlertTriangle,
  IconInfoCircle,
  IconChecklist,
  IconHistory,
  IconColumns,
  IconSearch,
  IconSparkles,
  IconEye,
  IconX,
  IconRotateClockwise,
  IconServer,
  IconDatabase,
  IconNetwork,
  IconCloud,
  IconArrowRight,
  IconCheck,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  downtimeMinutesPerMonth,
  HA_COLUMNS,
  ISSUE_TITLES_ES,
  REMEDIATION_COST_HINTS,
  SEVERITY_LABELS_ES,
  type HaIssueCategory,
  type HaPayload,
  type HaRecommendationItem,
  type HaSeverityLevel,
  type TableColumnConfig,
} from "@/types/azureHighAvailability.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
  "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const CELL = "min-w-[120px] max-w-[240px] truncate";

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El minutaje es lo que hace concreto un SLA: "99,9%" no le dice nada a nadie. */
const downtimeLabel = (sla: number) => {
  if (sla <= 0) return "sin SLA publicado";
  const min = downtimeMinutesPerMonth(sla);
  return min >= 60 ? `${(min / 60).toFixed(1)} h de caída/mes` : `${min.toFixed(1)} min de caída/mes`;
};

const SEVERITY_BADGE: Record<HaSeverityLevel, string> = {
  CRITICAL: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800",
  HIGH: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
  MEDIUM: "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800",
  LOW: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
};

function iconForType(type: string) {
  const s = type.toLowerCase();
  if (s.includes("virtualmachines") || s.includes("managedclusters")) return IconServer;
  if (s.includes("sql") || s.includes("postgres") || s.includes("mysql") || s.includes("documentdb")) return IconDatabase;
  if (s.includes("network") || s.includes("publicip")) return IconNetwork;
  return IconCloud;
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
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
      >
        <IconColumns size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
        Personalizar Columnas
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-60 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-[100] space-y-0.5">
          {columns.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <input type="checkbox" checked={c.visible} onChange={() => toggle(c.id)} className="accent-[#0054A6] cursor-pointer" />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HighAvailabilityPanel() {
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
  const apiUrl = `/api/governance/ha?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;

  const { data, error, isValidating, mutate } = useSWR<HaPayload>(
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
  const recommendations = useMemo(() => summary?.recommendations || [], [summary]);

  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [issueFilter, setIssueFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<"severity" | "name_asc" | "name_desc" | "type" | "cost_desc">("severity");
  const [showExempted, setShowExempted] = useState(false);

  const [drawerItem, setDrawerItem] = useState<HaRecommendationItem | null>(null);
  const [remediateItem, setRemediateItem] = useState<HaRecommendationItem | null>(null);
  const [exemptItem, setExemptItem] = useState<HaRecommendationItem | null>(null);
  const [exemptReason, setExemptReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const cols = useColumnConfig(`table_columns_config_high_availability_${tenantId}`, HA_COLUMNS);

  const resourceTypes = useMemo(
    () => Array.from(new Set(recommendations.map((r) => r.resourceTypeDisplay))).sort(),
    [recommendations]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = recommendations.filter((r) => {
      if (!showExempted && r.isExempted) return false;
      if (q && !r.resourceName.toLowerCase().includes(q) && !r.resourceGroup.toLowerCase().includes(q)) return false;
      if (sevFilter !== "ALL" && r.severity !== sevFilter) return false;
      if (typeFilter !== "ALL" && r.resourceTypeDisplay !== typeFilter) return false;
      if (issueFilter !== "ALL" && r.issueCategory !== issueFilter) return false;
      return true;
    });
    const order: Record<HaSeverityLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return [...list].sort((a, b) => {
      if (sortBy === "name_asc") return a.resourceName.localeCompare(b.resourceName);
      if (sortBy === "name_desc") return b.resourceName.localeCompare(a.resourceName);
      if (sortBy === "type") return a.resourceTypeDisplay.localeCompare(b.resourceTypeDisplay);
      if (sortBy === "cost_desc") return b.estimatedRemediationCostUSD - a.estimatedRemediationCostUSD;
      return order[a.severity] - order[b.severity];
    });
  }, [recommendations, search, sevFilter, typeFilter, issueFilter, sortBy, showExempted]);

  const pg = usePagination(filtered, 15);

  const postAction = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/governance/ha${isMock ? "?mock=true" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ tenantId, ...body }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    return payload;
  };

  const handleExempt = async () => {
    if (!exemptItem) return;
    setIsSaving(true);
    try {
      await postAction({
        action: "EXEMPT",
        recommendationId: exemptItem.id,
        resourceId: exemptItem.resourceId,
        resourceName: exemptItem.resourceName,
        issueCategory: exemptItem.issueCategory,
        reason: exemptReason.trim() || "Carga no productiva (dev/test)",
      });
      toast.success(`${exemptItem.resourceName} eximido del tablero de alta disponibilidad`);
      setExemptItem(null);
      setExemptReason("");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo registrar la exención");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveExemption = async (item: HaRecommendationItem) => {
    try {
      await postAction({ action: "REMOVE_EXEMPTION", recommendationId: item.id });
      toast.success("Exención removida");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo remover la exención");
    }
  };

  const kpis = [
    {
      label: "Brechas Críticas (SLA en Riesgo)",
      tip: "Cargas productivas con riesgo de pérdida de datos o caída total sin SLA. Las exenciones registradas no cuentan.",
      value: summary?.criticalCount ?? 0,
      Icon: IconAlertOctagon,
      color: "text-[#0078D4]",
    },
    {
      label: "Brechas de Severidad Alta",
      tip: "Clústeres y servicios productivos en instancia o zona única.",
      value: summary?.highCount ?? 0,
      Icon: IconAlertTriangle,
      color: "text-[#2563EB]",
    },
    {
      label: "Brechas de Severidad Media",
      tip: "SKUs sin SLA publicado y configuraciones sin redundancia en cargas secundarias.",
      value: summary?.mediumCount ?? 0,
      Icon: IconInfoCircle,
      color: "text-[#0284C7]",
    },
    {
      label: "Recomendaciones Menores",
      tip: "Oportunidades de resiliencia en cargas no productivas.",
      value: summary?.lowCount ?? 0,
      Icon: IconChecklist,
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
              <span>Recomendaciones de Alta Disponibilidad</span>
            </h1>
            <InfoTooltip
              content="Cada brecha muestra el SLA vigente y el alcanzable traducido a minutos de caída mensual: '99,9%' no significa nada hasta convertirlo en 43,8 minutos al mes."
              position="bottom"
              align="left"
            />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Resource Graph Live" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Detecta máquinas virtuales, bases de datos y recursos cloud sin redundancia zonal, geográfica ni respaldo.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowExempted(!showExempted)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl border bg-white dark:bg-slate-900 cursor-pointer ${
              showExempted ? "border-[#0054A6] text-[#0054A6]" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            }`}
          >
            <IconHistory size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
            {showExempted ? "Ocultar eximidas" : "Historial de Remediaciones"}
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer disabled:opacity-60"
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

      {/* ─── KPIs ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between"
          >
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span className="truncate">{k.label}</span>
                <InfoTooltip content={k.tip} />
              </div>
              <div className={`text-3xl font-extrabold tabular-nums ${k.color}`}>{k.value}</div>
            </div>
            <k.Icon size={32} className="text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Banner informativo ─── */}
      <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 rounded-xl flex items-start gap-2.5">
        <IconInfoCircle size={18} className="text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          <strong className="text-[#1B2A41] dark:text-slate-100">Remediación de resiliencia:</strong> la mayoría de estas
          recomendaciones exigen cambios de arquitectura —distribuir en zonas o habilitar geo-redundancia implica recrear
          el recurso o elegir región secundaria—, así que no son un botón. Sólo la migración de SKU de IP pública y la
          asociación de una política de backup se pueden aplicar directamente desde la plataforma; el resto abre un
          blueprint del cambio para que lo ejecute el equipo.
          {summary && summary.totalEstimatedRemediationCostUSD > 0 && (
            <>
              {" "}
              Costo estimado de cerrar todas las brechas activas:{" "}
              <strong className="text-[#0054A6]">{money(summary.totalEstimatedRemediationCostUSD)}/mes</strong>.
            </>
          )}
        </p>
      </div>

      {/* ─── Filtros ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <IconSearch size={14} className="text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Buscar recurso o grupo de recursos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>
          <ColumnMenu {...cols} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={sevFilter}
            onChange={(e) => setSevFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Severidad: Todas</option>
            <option value="CRITICAL">Crítica</option>
            <option value="HIGH">Alta</option>
            <option value="MEDIUM">Media</option>
            <option value="LOW">Baja</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Tipo de Recurso: Todos</option>
            {resourceTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={issueFilter}
            onChange={(e) => setIssueFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Tipo de Problema: Todos</option>
            {(Object.keys(ISSUE_TITLES_ES) as HaIssueCategory[]).map((k) => (
              <option key={k} value={k}>
                {ISSUE_TITLES_ES[k]}
              </option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="severity">Ordenar por: Severidad</option>
            <option value="cost_desc">Costo: Mayor a Menor</option>
            <option value="name_asc">Nombre: A-Z</option>
            <option value="name_desc">Nombre: Z-A</option>
            <option value="type">Tipo de Recurso</option>
          </select>
        </div>
      </div>

      {/* ─── Tabla ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-xs table-fixed">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {HA_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                  <ResizableTh key={c.id} minWidth={c.minWidth} className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200">
                    {c.label}
                  </ResizableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pg.paged.length === 0 ? (
                <tr>
                  <td colSpan={HA_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    {recommendations.length === 0
                      ? "Azure Resource Graph no reporta brechas de alta disponibilidad en las suscripciones visibles."
                      : "Ninguna recomendación coincide con los filtros aplicados."}
                  </td>
                </tr>
              ) : (
                pg.paged.map((r: HaRecommendationItem) => {
                  const Icon = iconForType(r.resourceType);
                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 ${r.isExempted ? "opacity-60" : ""}`}
                    >
                      {cols.isVisible("resource") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Icon size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                            <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 ${CELL}`} title={r.resourceId}>
                              {r.resourceName}
                            </span>
                          </div>
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {r.resourceGroup} · {r.subscriptionName}
                            {r.location ? ` · ${r.location}` : ""}
                          </span>
                        </td>
                      )}
                      {cols.isVisible("type") && (
                        <td className="py-2.5 px-3">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {r.resourceTypeDisplay}
                          </span>
                        </td>
                      )}
                      {cols.isVisible("issue") && (
                        <td className={`py-2.5 px-3 text-slate-700 dark:text-slate-300 ${CELL}`} title={r.issueTitle}>
                          {r.issueTitle}
                        </td>
                      )}
                      {cols.isVisible("severity") && (
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${SEVERITY_BADGE[r.severity]}`}>
                            {SEVERITY_LABELS_ES[r.severity]}
                          </span>
                          {r.isExempted && (
                            <span
                              title={r.exemptionReason}
                              className="block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 whitespace-nowrap"
                            >
                              Eximida
                            </span>
                          )}
                        </td>
                      )}
                      {cols.isVisible("risk") && (
                        <td className="py-2.5 px-3">
                          <span className="text-slate-600 dark:text-slate-300 block line-clamp-2" title={r.riskDescription}>
                            {r.riskDescription}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {r.currentSlaPercentage > 0 ? `${r.currentSlaPercentage}%` : "sin SLA"} → {r.targetSlaPercentage}%
                          </span>
                        </td>
                      )}
                      {cols.isVisible("cost") && (
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {r.estimatedRemediationCostUSD > 0 ? (
                            <span className="font-semibold text-[#0078D4] tabular-nums">
                              +{money(r.estimatedRemediationCostUSD)}/mes
                            </span>
                          ) : (
                            <span
                              className="text-[11px] text-slate-500 dark:text-slate-400"
                              title={REMEDIATION_COST_HINTS[r.issueCategory].note}
                            >
                              A determinar
                            </span>
                          )}
                        </td>
                      )}
                      {cols.isVisible("actions") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => setRemediateItem(r)}
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer whitespace-nowrap"
                            >
                              <IconSparkles size={14} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                              Remediar
                            </button>
                            {r.isExempted ? (
                              <button
                                onClick={() => handleRemoveExemption(r)}
                                className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
                              >
                                Reincorporar
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setExemptItem(r);
                                  setExemptReason("");
                                }}
                                className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
                              >
                                <IconShieldCheck size={14} className="inline mr-1" stroke={1.5} />
                                Eximir
                              </button>
                            )}
                            <button onClick={() => setDrawerItem(r)} title="Ver arquitectura y SLA" className="cursor-pointer bg-transparent">
                              <IconEye size={16} className="text-slate-400 hover:text-[#0078D4]" stroke={1.5} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={pg.page}
          totalPages={pg.totalPages}
          pageSize={pg.pageSize}
          total={pg.total}
          setPage={pg.setPage}
          setPageSize={pg.setPageSize}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* ─── Drawer: arquitectura y SLA ─── */}
      {drawerItem && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-[100]">
          <div className="w-full max-w-lg h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-5 overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                  <IconEye size={18} className="text-[#0078D4]" stroke={1.5} />
                  Arquitectura y SLA
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate" title={drawerItem.resourceId}>
                  {drawerItem.resourceName}
                </p>
              </div>
              <button onClick={() => setDrawerItem(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            {/* Topología */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">Topología actual</h4>
              <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 flex-wrap">
                <span className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700">
                  {drawerItem.subscriptionName}
                </span>
                <IconArrowRight size={14} className="text-slate-400" />
                <span className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700">
                  {drawerItem.resourceGroup || "—"}
                </span>
                <IconArrowRight size={14} className="text-slate-400" />
                <span className="px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800 text-[#0054A6]">
                  {drawerItem.resourceName}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {drawerItem.location ? `Desplegado en ${drawerItem.location}` : "Región no reportada por Resource Graph"} ·{" "}
                {drawerItem.resourceTypeDisplay}
              </p>
            </div>

            {/* Comparativa de SLA */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">SLA actual vs. proyectado</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/50 space-y-0.5">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">Configuración actual</span>
                  <span className="text-xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                    {drawerItem.currentSlaPercentage > 0 ? `${drawerItem.currentSlaPercentage}%` : "—"}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                    {downtimeLabel(drawerItem.currentSlaPercentage)}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-0.5">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">Con redundancia</span>
                  <span className="text-xl font-extrabold text-[#0078D4] tabular-nums">
                    {drawerItem.targetSlaPercentage}%
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                    {downtimeLabel(drawerItem.targetSlaPercentage)}
                  </span>
                </div>
              </div>
              {drawerItem.currentSlaPercentage === drawerItem.targetSlaPercentage && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Un backup no mejora el SLA de disponibilidad: mejora el RPO, es decir cuántos datos se pierden si algo
                  falla. Por eso ambas cifras coinciden acá.
                </p>
              )}
            </div>

            {/* Costos */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">Costo adicional estimado</h4>
              <span className="text-2xl font-extrabold text-[#0078D4] tabular-nums">
                {drawerItem.estimatedRemediationCostUSD > 0
                  ? `+${money(drawerItem.estimatedRemediationCostUSD)}/mes`
                  : "A determinar"}
              </span>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                {REMEDIATION_COST_HINTS[drawerItem.issueCategory].note}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Es un delta de precio de lista, no una cotización: el importe real depende de la región y de los
                compromisos vigentes. El tráfico entre zonas se factura aparte.
              </p>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-1">Riesgo</h4>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{drawerItem.riskDescription}</p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: blueprint de remediación ─── */}
      {remediateItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconSparkles size={18} className="text-[#0078D4]" stroke={1.5} />
                Blueprint de remediación
              </h3>
              <button onClick={() => setRemediateItem(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#1B2A41] dark:text-slate-100">{remediateItem.resourceName}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{remediateItem.issueTitle}</p>
            </div>

            {remediateItem.isRemediableViaApi ? (
              <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30">
                <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                  Esta corrección es idempotente en ARM y se puede aplicar desde la plataforma. Se envía como petición al
                  flujo de <strong>Aprobaciones de Remediación</strong>, donde un segundo operador la revisa antes de que
                  toque Azure.
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                  Esta brecha <strong>no se puede cerrar por API</strong>: distribuir en zonas o asociar un Availability
                  Set exige recrear el recurso, y habilitar geo-redundancia exige decidir la región secundaria. El
                  blueprint de abajo describe el cambio para que lo planifique el equipo de infraestructura.
                </p>
              </div>
            )}

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed break-all">
                {remediateItem.issueCategory === "BASIC_SKU_NO_SLA" &&
                  `az network public-ip update --ids ${remediateItem.resourceId} --sku Standard`}
                {remediateItem.issueCategory === "NO_BACKUP" &&
                  `az backup protection enable-for-vm --vault-name <vault> --resource-group ${remediateItem.resourceGroup} --vm ${remediateItem.resourceName} --policy-name DefaultPolicy`}
                {remediateItem.issueCategory === "SINGLE_INSTANCE_CAPACITY" &&
                  `az appservice plan update --ids ${remediateItem.resourceId} --number-of-workers 2`}
                {remediateItem.issueCategory === "NO_GEO_REDUNDANCY" &&
                  `# Requiere elegir región secundaria y ventana de failover.\n# Ver: az sql failover-group create / az cosmosdb update --locations`}
                {remediateItem.issueCategory === "NO_AVAILABILITY_ZONE" &&
                  `# Requiere recrear el recurso en una zona:\n# az vm create --zone 1 ... (la VM actual no se puede mover a una zona en caliente)`}
                {remediateItem.issueCategory === "NO_AVAILABILITY_SET" &&
                  `# Un Availability Set sólo se puede asignar al crear la VM:\n# az vm availability-set create + recrear la VM desde el disco`}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRemediateItem(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(
                    document.querySelector<HTMLElement>(".font-mono")?.innerText || ""
                  );
                  toast.success("Comando copiado al portapapeles");
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
              >
                <IconCheck size={16} className="inline mr-1" stroke={2} />
                Copiar comando
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Drawer: exención justificada ─── */}
      {exemptItem && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-[100]">
          <div className="w-full max-w-sm h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconShieldCheck size={18} className="text-[#0078D4]" stroke={1.5} />
                Eximir recomendación
              </h3>
              <button onClick={() => setExemptItem(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              <strong className="text-[#1B2A41] dark:text-slate-100">{exemptItem.resourceName}</strong> deja de contar en
              los KPIs pero sigue visible con el filtro de eximidas. La justificación queda registrada con tu usuario:
              alguien va a tener que defenderla en la próxima auditoría.
            </p>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Motivo</label>
              <textarea
                value={exemptReason}
                onChange={(e) => setExemptReason(e.target.value)}
                rows={4}
                placeholder="Ej: entorno de laboratorio, se recrea desde plantilla en minutos."
                className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setExemptItem(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleExempt}
                disabled={isSaving}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50"
              >
                <IconCheck size={16} className="inline mr-1" stroke={2} />
                Registrar exención
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
