"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Coins, Gauge, RefreshCw, ShieldAlert, Sparkles, Wallet } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";

interface MetricPoint {
  timestamp: string;
  cpu_percent: number | null;
  memory_percent: number | null;
  active_connections: number | null;
  connections_failed: number | null;
  storage_percent: number | null;
  io_consumption_percent: number | null;
  network_bytes_ingress: number | null;
  network_bytes_egress: number | null;
}

interface PostgresInstanceMetrics {
  id: string;
  name: string;
  region: string;
  sku: string;
  monthlyCostUsd: number;
  telemetry?: {
    available: boolean;
    source?: "azure_monitor" | "not_collected" | "mock";
    message?: string;
  };
  history: MetricPoint[];
}

interface Recommendation {
  title: string;
  instanceId: string;
  monthlySavings: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
}

interface PostgresFinOpsResponse {
  success?: boolean;
  mock?: boolean;
  resourceExists?: boolean;
  instances?: PostgresInstanceMetrics[];
  financialSummary?: {
    mtdCost: number;
    forecastEom: { value: number; low: number; high: number };
    deltaMoM: { value: number; percentage: number };
    potentialSavings: number;
  };
  efficiency?: {
    costPerUsedGb: number;
    costPerKOps: number;
    underutilizedCount: number;
  };
  risk?: {
    healthScore: number;
    criticalAlerts: number;
  };
  recommendations?: Recommendation[];
  error?: string;
  details?: string;
  message?: string;
}

function normalizeResponse(data: PostgresFinOpsResponse): Required<Pick<PostgresFinOpsResponse, "instances" | "financialSummary" | "efficiency" | "risk" | "recommendations">> {
  const instances = data.instances || [];
  const mtd = instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0);
  return {
    instances,
    financialSummary: data.financialSummary || {
      mtdCost: mtd,
      forecastEom: { value: mtd, low: mtd * 0.92, high: mtd * 1.08 },
      deltaMoM: { value: 0, percentage: 0 },
      potentialSavings: 0,
    },
    efficiency: data.efficiency || { costPerUsedGb: 0, costPerKOps: 0, underutilizedCount: 0 },
    risk: data.risk || { healthScore: 0, criticalAlerts: 0 },
    recommendations: data.recommendations || [],
  };
}

export default function PostgresTestBoard() {
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [instances, setInstances] = useState<PostgresInstanceMetrics[]>([]);
  const [financialSummary, setFinancialSummary] = useState({
    mtdCost: 0,
    forecastEom: { value: 0, low: 0, high: 0 },
    deltaMoM: { value: 0, percentage: 0 },
    potentialSavings: 0,
  });
  const [efficiency, setEfficiency] = useState({
    costPerUsedGb: 0,
    costPerKOps: 0,
    underutilizedCount: 0,
  });
  const [risk, setRisk] = useState({ healthScore: 0, criticalAlerts: 0 });
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const fetchPostgresMetrics = useCallback(async (isManual = false) => {
    if (!selectedTenant) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const tenantId = selectedTenant.id;
      const isMock = isMockTenant(tenantId);
      let token: string | null = null;
      if (!isMock) {
        if (!accounts[0]) throw new Error("No hay sesión activa para consultar métricas de PostgreSQL.");
        token = await getFreshIdToken(instance, accounts[0]);
      }

      const params = new URLSearchParams({ tenantId, bust: "1" });
      const response = await fetch(`/api/intelligence/databases/postgres-metrics?${params.toString()}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.details || body.message || `Error HTTP ${response.status}`);
      }

      const data: PostgresFinOpsResponse = await response.json();
      const normalized = normalizeResponse(data);
      setInstances(normalized.instances);
      if (normalized.instances.length > 0 && !selectedInstanceId) setSelectedInstanceId(normalized.instances[0].id);
      setFinancialSummary(normalized.financialSummary);
      setEfficiency(normalized.efficiency);
      setRisk(normalized.risk);
      setRecommendations(normalized.recommendations);
      setIsMock(Boolean(data.mock) || isMock);
      setLastUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al cargar PostgreSQL FinOps cockpit");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTenant, instance, accounts, selectedInstanceId]);

  useEffect(() => {
    void fetchPostgresMetrics(false);
  }, [fetchPostgresMetrics]);

  const telemetry = useMemo(() => {
    const withTelemetry = instances.filter((i) => i.telemetry?.available === true).length;
    const total = instances.length;
    return { withTelemetry, total, missing: Math.max(total - withTelemetry, 0) };
  }, [instances]);

  const currentInstance = useMemo(() => instances.find((i) => i.id === selectedInstanceId), [instances, selectedInstanceId]);
  const topRecommendations = useMemo(() => {
    const filtered = selectedInstanceId ? recommendations.filter((rec) => rec.instanceId === selectedInstanceId) : recommendations;
    return filtered.slice(0, 5);
  }, [recommendations, selectedInstanceId]);

  if (!selectedTenant) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Selecciona un tenant para ver el cockpit FinOps/CMP de PostgreSQL.</div>;
  }
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <p className="text-sm text-slate-600">Cargando Azure Database for PostgreSQL FinOps Cockpit...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-900">Azure Database for PostgreSQL FinOps Cockpit</h2>
            </div>
            <p className="text-sm text-slate-600">Costo, eficiencia, riesgo y acciones priorizadas por instancia para decisiones FinOps/CMP.</p>
            {instances.length > 0 && (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-slate-700">Selecciona instancia:</label>
                <select value={selectedInstanceId || ""} onChange={(e) => setSelectedInstanceId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-400">
                  {instances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({inst.sku})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {lastUpdatedAt && <p className="mt-2 text-xs text-slate-500">Actualizado: {lastUpdatedAt.toLocaleTimeString()} {isMock ? "(mock)" : "(real-time)"}</p>}
          </div>
          <button type="button" onClick={() => void fetchPostgresMetrics(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </section>

      {error && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Costo MTD" value={format(financialSummary.mtdCost)} icon={<Wallet className="h-5 w-5 text-sky-600" />} />
        <KpiCard title="Forecast fin de mes" value={format(financialSummary.forecastEom.value)} subtitle={`${format(financialSummary.forecastEom.low)} - ${format(financialSummary.forecastEom.high)}`} icon={<Gauge className="h-5 w-5 text-violet-600" />} />
        <KpiCard title="Ahorro potencial" value={format(financialSummary.potentialSavings)} icon={<Coins className="h-5 w-5 text-emerald-600" />} />
        <KpiCard title="Variación vs mes anterior" value={`${financialSummary.deltaMoM.percentage >= 0 ? "+" : ""}${financialSummary.deltaMoM.percentage.toFixed(2)}%`} subtitle={format(financialSummary.deltaMoM.value)} icon={financialSummary.deltaMoM.percentage >= 0 ? <ArrowUpRight className="h-5 w-5 text-rose-600" /> : <ArrowDownRight className="h-5 w-5 text-emerald-600" />} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Costo por GB transferido" value={format(efficiency.costPerUsedGb)} icon={<Gauge className="h-5 w-5 text-amber-600" />} />
        <KpiCard title="Costo por K conexiones" value={format(efficiency.costPerKOps)} icon={<Gauge className="h-5 w-5 text-indigo-600" />} />
        <KpiCard title="Instancias subutilizadas" value={String(efficiency.underutilizedCount)} icon={<CheckCircle2 className="h-5 w-5 text-cyan-600" />} />
        <KpiCard title="Salud operativa" value={`${risk.healthScore.toFixed(1)} / 100`} subtitle={`${risk.criticalAlerts} alertas críticas`} icon={<ShieldAlert className="h-5 w-5 text-rose-600" />} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Top oportunidades de ahorro</h3>
        {topRecommendations.length === 0 ? (
          <p className="text-sm text-slate-600">Sin recomendaciones para la instancia seleccionada.</p>
        ) : (
          <div className="space-y-3">
            {topRecommendations.map((rec) => (
              <div key={`${rec.instanceId}-${rec.title}`} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{rec.title}</p>
                    <p className="text-xs text-slate-500">{rec.instanceId}</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">{format(rec.monthlySavings)} / mes</p>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Riesgo: <b>{rec.risk}</b> · Confianza: <b>{rec.confidence}</b> · Acción: <b>{rec.actionType}</b>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Cobertura de telemetría</h3>
        <p className="text-sm text-slate-600">
          {telemetry.withTelemetry} / {telemetry.total} instancias con métricas operativas.
        </p>
        {telemetry.missing > 0 && <p className="mt-2 text-xs text-amber-700">{telemetry.missing} instancias sin telemetría reciente. Los KPIs financieros y recomendaciones siguen activos con fallback de costo.</p>}
        {currentInstance?.telemetry?.message && <p className="mt-2 text-xs text-slate-500">{currentInstance.telemetry.message}</p>}
      </section>
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle?: string; icon: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        {icon}
      </div>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
    </article>
  );
}
