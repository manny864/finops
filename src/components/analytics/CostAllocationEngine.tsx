"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconArrowsSplit2,
  IconCash,
  IconChecklist,
  IconAlertCircle,
  IconUsersGroup,
  IconPlus,
  IconTrash,
  IconX,
  IconCheck,
  IconRotateClockwise,
  IconAlertTriangle,
  IconSparkles,
  IconRouter,
  IconServer,
  IconDatabase,
  IconShieldLock,
  IconNetwork,
  IconBox,
} from "@tabler/icons-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  ALLOC_SCALE,
  STRATEGY_LABELS,
  type AllocationStrategy,
  type CostAllocationPayload,
  type SharedCostRule,
  type SharedResourceType,
} from "@/types/azureCostAllocation.types";

/** Scrollbar horizontal siempre visible: en macOS los overlay desaparecen. */
const VISIBLE_SCROLLBAR =
  "overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.300)_theme(colors.slate.100)] " +
  "dark:[scrollbar-color:theme(colors.slate.600)_theme(colors.slate.800)] " +
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full " +
  "[&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 " +
  "[&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

const TYPE_ICONS: Record<SharedResourceType, React.ComponentType<{ className?: string; stroke?: number }>> = {
  ExpressRoute: IconRouter,
  AKS: IconServer,
  LogAnalytics: IconDatabase,
  AzureFirewall: IconShieldLock,
  VNetHub: IconNetwork,
  VPNGateway: IconNetwork,
  Other: IconBox,
};

function buildFetcher(instance: IPublicClientApplication, accounts: AccountInfo[], isMock: boolean) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Se deja propagar el 401; no hay mock de rescate.
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Error al cargar el prorrateo");
    }
    return res.json();
  };
}

function StatusBadge({ rule }: { rule: SharedCostRule }) {
  const map = {
    VALID_100: { label: "Total asignado: 100%", cls: "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400" },
    INCOMPLETE: {
      label: `Incompleto: ${rule.totalAllocatedPercentage}%`,
      cls: "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400",
    },
    OVER_ALLOCATED: {
      label: `Sobre-asignado: ${rule.totalAllocatedPercentage}%`,
      cls: "border-red-300 dark:border-red-800 text-red-700 dark:text-red-400",
    },
  } as const;
  const cfg = map[rule.status];
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${cfg.cls}`}>
      {cfg.label} {rule.status === "VALID_100" ? "✓" : ""}
    </span>
  );
}

// ─── Editor de Regla (tarjeta expandible) ───
function RuleEditorCard({
  rule,
  costCenters,
  onSave,
  onDelete,
  saving,
}: {
  rule: SharedCostRule;
  costCenters: string[];
  onSave: (r: SharedCostRule, targets: Array<{ targetCostCenterName: string; percentage: number }>, strategy: AllocationStrategy) => void;
  onDelete: (r: SharedCostRule) => void;
  saving: boolean;
}) {
  const [rows, setRows] = useState(
    rule.targets.map((t) => ({ name: t.targetCostCenterName, pct: String(t.percentage) }))
  );
  const [strategy, setStrategy] = useState<AllocationStrategy>(rule.strategy);

  const total = rows.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  const over = total > 100.01;
  const incomplete = total < 99.99;
  const Icon = TYPE_ICONS[rule.resourceType];

  return (
    <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="w-5 h-5 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 truncate">{rule.sharedResourceName}</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {rule.resourceType} · {money(rule.monthlyCostUSD)}/mes
            </p>
          </div>
        </div>
        <StatusBadge rule={rule} />
      </div>

      <select
        value={strategy}
        onChange={(e) => setStrategy(e.target.value as AllocationStrategy)}
        className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
      >
        {(Object.keys(STRATEGY_LABELS) as AllocationStrategy[]).map((s) => (
          <option key={s} value={s}>
            {STRATEGY_LABELS[s]}
          </option>
        ))}
      </select>

      <div className="space-y-2">
        {rows.map((row, i) => {
          const pct = Number(row.pct) || 0;
          const amount = (rule.monthlyCostUSD * pct) / 100;
          return (
            <div key={i} className="flex items-center gap-2">
              <select
                value={row.name}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              >
                {[...new Set([row.name, ...costCenters])].filter(Boolean).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={row.pct}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, pct: e.target.value } : r)))}
                className="w-20 px-2 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
              <span className="text-[11px] font-semibold text-[#1B2A41] dark:text-slate-100 w-20 text-right shrink-0">
                {money(amount)}
              </span>
              <button
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-500 cursor-pointer shrink-0"
                aria-label="Eliminar fila"
              >
                <IconTrash className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Barra de progreso del reparto: el residuo se ve en slate. */}
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              width: `${Math.min(100, Number(r.pct) || 0)}%`,
              backgroundColor: ALLOC_SCALE[i % ALLOC_SCALE.length],
            }}
          />
        ))}
      </div>
      <div className="flex justify-between items-center text-[11px]">
        <span className={over ? "text-red-600 font-bold" : incomplete ? "text-amber-600 font-semibold" : "text-emerald-600 font-semibold"}>
          {total.toFixed(2)}% asignado
          {incomplete && ` · residuo ${money((rule.monthlyCostUSD * (100 - total)) / 100)}`}
        </span>
        <button
          onClick={() => setRows([...rows, { name: costCenters[0] || "", pct: "0" }])}
          className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] transition cursor-pointer flex items-center gap-1"
        >
          <IconPlus className="w-3.5 h-3.5" />
          Añadir Departamento
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          disabled={saving || over}
          onClick={() =>
            onSave(
              rule,
              rows.map((r) => ({ targetCostCenterName: r.name, percentage: Number(r.pct) || 0 })),
              strategy
            )
          }
          title={over ? "La suma supera 100%: corregir antes de guardar" : undefined}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Guardando…" : "Guardar y Aplicar"}
        </button>
        <button
          onClick={() => onDelete(rule)}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 transition cursor-pointer"
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function CostAllocationEngine() {
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

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock), [instance, accounts, isMock]);
  const apiUrl = `/api/analytics/allocation?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<CostAllocationPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const rules = useMemo(() => data?.summary.rules || [], [data]);
  const summary = data?.summary;

  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(rules, 15);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (!isMock && accounts.length > 0) {
      const t = await getFreshIdToken(instance, accounts[0]);
      if (t) h["Authorization"] = `Bearer ${t}`;
    }
    return h;
  };

  const handleSave = async (
    rule: SharedCostRule,
    targets: Array<{ targetCostCenterName: string; percentage: number }>,
    strategy: AllocationStrategy
  ) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/analytics/allocation?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          ruleName: rule.ruleName,
          sharedResourceId: rule.sharedResourceId,
          sharedResourceName: rule.sharedResourceName,
          resourceType: rule.resourceType,
          strategy,
          targets,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // El 422 trae el detalle de qué reglas de negocio fallaron.
        setSaveError(body.details || [body.error || `HTTP ${res.status}`]);
        return;
      }
      await mutate();
    } catch (e) {
      setSaveError([String(e)]);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: SharedCostRule) => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/analytics/allocation?tenantId=${encodeURIComponent(tenantId)}&resourceName=${encodeURIComponent(rule.sharedResourceName)}`,
        { method: "DELETE", headers: await authHeaders() }
      );
      if (res.ok) await mutate();
    } finally {
      setSaving(false);
    }
  };

  const unruled = (data?.availableSharedResources || []).filter((r) => !r.hasRule);

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconArrowsSplit2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Prorrateo de Costos Compartidos</span>
              <InfoTooltip
                content="Un ExpressRoute, un hub de VNet o un clúster AKS compartido no pertenecen a ningún centro de costo: los usan todos. Sin una regla de reparto ese gasto queda huérfano y el showback departamental miente por omisión — los equipos creen que gastan menos de lo que gastan."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Cost Management" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Reglas de reparto, validación del 100% y matriz de showback departamental
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAddOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconPlus className="w-4 h-4" />
            Añadir Recurso Compartido
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {saveError && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <div className="text-xs text-red-700 dark:text-red-400">
            <p className="font-bold">No se guardó la regla</p>
            <ul className="list-disc list-inside mt-1">
              {saveError.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
          <button onClick={() => setSaveError(null)} className="ml-auto text-slate-400 cursor-pointer">
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ─── 4 KPI Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Gasto Total Compartido",
            tip: "Costo mensual de los recursos que usan varios equipos y por eso necesitan una regla de reparto.",
            value: money(summary?.totalSharedSpendUSD || 0),
            sub: `${summary?.activeRulesCount || 0} regla(s) activa(s)`,
            Icon: IconCash,
          },
          {
            label: "Prorrateado con Éxito",
            tip: "Monto efectivamente distribuido entre centros de costo bajo reglas válidas.",
            value: money(summary?.totalAllocatedSpendUSD || 0),
            sub: `${summary?.allocationCoveragePercentage || 0}% de cobertura`,
            Icon: IconChecklist,
          },
          {
            label: "Residuo No Asignado",
            tip: "Gasto de reglas incompletas que ningún departamento está viendo en su showback. Existe igual: solo queda fuera del modelo.",
            value: money(summary?.totalUnallocatedSpendUSD || 0),
            sub:
              (summary?.invalidRulesCount || 0) > 0
                ? `${summary?.invalidRulesCount} regla(s) sin validar`
                : "Todas las reglas al 100%",
            Icon: IconAlertCircle,
            warn: (summary?.totalUnallocatedSpendUSD || 0) > 0,
          },
          {
            label: "Centros Beneficiarios",
            tip: "Departamentos que reciben asignaciones virtuales de los recursos compartidos.",
            value: String(summary?.affectedCostCentersCount || 0),
            sub: `${summary?.unruledSharedResourcesCount || 0} recurso(s) sin regla`,
            Icon: IconUsersGroup,
          },
        ].map((c) => (
          <div
            key={c.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between"
          >
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span>{c.label}</span>
                <InfoTooltip content={c.tip} />
              </div>
              <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
                {c.value}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{c.sub}</div>
            </div>
            <c.Icon className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* Recursos compartidos sin regla */}
      {addOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setAddOpen(false)}>
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 relative z-50 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setAddOpen(false)} className="absolute top-4 right-4 text-slate-400 cursor-pointer">
              <IconX className="w-5 h-5" />
            </button>
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 mb-1 flex items-center gap-2">
              <IconPlus className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              Recursos compartidos sin regla
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
              Su costo completo queda fuera del showback hasta que se reparta.
            </p>
            {unruled.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Todos los recursos compartidos detectados ya tienen regla.
              </p>
            ) : (
              <div className="space-y-2">
                {unruled.map((r) => (
                  <div
                    key={r.resourceId}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-[#1B2A41] dark:text-slate-100 truncate">
                        {r.resourceName}
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        {r.resourceType} · {r.resourceGroup} · {money(r.monthlyCostUSD)}/mes
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        handleSave(
                          {
                            id: "",
                            ruleName: r.resourceName,
                            sharedResourceId: r.resourceId,
                            sharedResourceName: r.resourceName,
                            resourceType: r.resourceType,
                            resourceGroup: r.resourceGroup,
                            subscriptionId: "",
                            subscriptionName: r.subscriptionName,
                            monthlyCostUSD: r.monthlyCostUSD,
                            strategy: "FIXED_PERCENTAGE",
                            targets: [],
                            totalAllocatedPercentage: 0,
                            unallocatedAmountUSD: r.monthlyCostUSD,
                            status: "INCOMPLETE",
                            lastUpdated: "",
                          },
                          [{ targetCostCenterName: data?.availableCostCenters[0] || "Sin Asignar (Untagged)", percentage: 100 }],
                          "FIXED_PERCENTAGE"
                        );
                        setAddOpen(false);
                      }}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer shrink-0"
                    >
                      Crear regla
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Fila 1: Tarjetas editables ─── */}
      <div>
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
          Reglas de Reparto
          <InfoTooltip content="Cada tarjeta reparte el costo de un recurso compartido. La suma debe dar exactamente 100%: por debajo hay residuo huérfano, y por encima se cobraría más de lo que el recurso cuesta." />
        </h3>
        {rules.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
            <IconArrowsSplit2 className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No hay reglas de prorrateo configuradas. Todo el gasto de los recursos compartidos queda fuera del
              showback departamental.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {rules.map((r) => (
              <RuleEditorCard
                key={r.id || r.sharedResourceName}
                rule={r}
                costCenters={data?.availableCostCenters || []}
                onSave={handleSave}
                onDelete={handleDelete}
                saving={saving}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Fila 2: Matriz de showback ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            Matriz de Prorrateo y Showback Departamental
          </h3>
          <InfoTooltip content="Vista consolidada de cada recurso compartido, su estrategia de reparto y el monto que recibe cada departamento." />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{total} reglas</span>
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-semibold min-w-[200px]">Recurso Compartido</th>
                <th className="px-3 py-2 font-semibold min-w-[140px]">Tipo</th>
                <th className="px-3 py-2 font-semibold min-w-[200px]">Estrategia</th>
                <th className="px-3 py-2 font-semibold min-w-[130px]">Costo MTD</th>
                <th className="px-3 py-2 font-semibold min-w-[280px]">Departamentos Asignados</th>
                <th className="px-3 py-2 font-semibold min-w-[160px]">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400 text-xs">
                    Sin reglas de prorrateo configuradas.
                  </td>
                </tr>
              ) : (
                paged.map((r: SharedCostRule) => {
                  const Icon = TYPE_ICONS[r.resourceType];
                  return (
                    <tr key={r.id || r.sharedResourceName} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className="font-semibold text-[#1B2A41] dark:text-slate-100 min-w-[120px] max-w-[240px] truncate block" title={r.sharedResourceName}>
                            {r.sharedResourceName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{r.resourceType}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900">
                          {STRATEGY_LABELS[r.strategy]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                        {money(r.monthlyCostUSD)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {r.targets.map((t, i) => (
                            <span
                              key={t.targetCostCenterName}
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-white dark:bg-slate-900 whitespace-nowrap"
                              style={{ borderColor: ALLOC_SCALE[i % ALLOC_SCALE.length], color: ALLOC_SCALE[i % ALLOC_SCALE.length] }}
                            >
                              {t.targetCostCenterName}: {money(t.allocatedAmountUSD)} ({t.percentage}%)
                            </span>
                          ))}
                          {r.unallocatedAmountUSD > 0 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-400 text-slate-500 bg-white dark:bg-slate-900 whitespace-nowrap">
                              Sin asignar: {money(r.unallocatedAmountUSD)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge rule={r} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <Pagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} pageSizes={[15, 30, 45, 60]} />
        </div>
      </div>

      {/* ─── Showback consolidado por centro de costo ─── */}
      {summary && summary.showbackByCostCenter.length > 0 && (
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            Showback Consolidado por Centro de Costo
            <InfoTooltip content="Total que cada departamento recibe por prorrateo de recursos compartidos, sumando todas las reglas." />
          </h3>
          <div className="space-y-2.5">
            {summary.showbackByCostCenter.map((c, i) => (
              <div key={c.costCenterName}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-slate-700 dark:text-slate-300 font-medium">{c.costCenterName}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {money(c.allocatedUSD)} · {c.percentage}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${c.percentage}%`, backgroundColor: ALLOC_SCALE[i % ALLOC_SCALE.length] }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Recomendaciones ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
          Recomendaciones de Prorrateo
          <InfoTooltip content="Los montos indicados son gasto que se pone bajo control del modelo de showback, no ahorro: prorratear no reduce la factura, la atribuye a quien corresponde." />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {data?.remediations && data.remediations.length > 0 ? (
            data.remediations.map((a) => (
              <div
                key={a.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900 uppercase">
                    {a.category}
                  </span>
                  {a.estimatedSavingsOrImpactUSD > 0 && (
                    <span className="text-xs font-extrabold text-[#0054A6]">
                      {money(a.estimatedSavingsOrImpactUSD)}/mes
                    </span>
                  )}
                </div>
                <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">{a.title}</h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-4 leading-relaxed">
                  {a.description}
                </p>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
                  Confianza: {a.confidence}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              Todas las reglas suman 100% y no hay recursos compartidos sin repartir.
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <span className="text-[10px] text-slate-400 flex items-center gap-1">
          <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" />
          El prorrateo no modifica la factura de Azure: genera el dataset virtual de showback.
        </span>
      </div>
    </div>
  );
}
