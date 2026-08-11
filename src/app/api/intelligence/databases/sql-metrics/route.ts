import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  listResourcesByTypes,
  getDiagnosticsCacheKey,
  readDiagnosticsCache,
  writeDiagnosticsCache,
} from "../diagnosticsShared";
import { redis } from "@/lib/redis";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import pool from "@/modules/storage/db";

const SQL_TYPES = [
  "microsoft.sql/servers/databases",
  "microsoft.sql/servers/elasticpools",
  "microsoft.sql/managedinstances",
  "microsoft.sql/instancepools",
  "Microsoft.Sql/servers/databases",
  "Microsoft.Sql/servers/elasticPools",
  "Microsoft.Sql/managedInstances",
  "Microsoft.Sql/instancePools",
];

const SQL_DB_METRICS = [
  "cpu_percent",
  "dtu_consumption_percent",
  "storage_percent",
  "sessions_percent",
  "workers_percent",
  "connection_failed",
  "physical_data_read_percent",
  "log_write_percent",
];

const SQL_MI_METRICS = [
  "avg_cpu_percent",
  "storage_space_used_mb",
  "io_requests",
  "connection_failed",
];

type RecommendationRisk = "low" | "medium" | "high";
type RecommendationConfidence = "high" | "medium" | "low";
type RecommendationActionType = "manual" | "guided" | "automatic";

interface Recommendation {
  title: string;
  instanceId: string;
  monthlySavings: number;
  risk: RecommendationRisk;
  confidence: RecommendationConfidence;
  actionType: RecommendationActionType;
}

interface MetricHistoryPoint {
  timestamp: string;
  cpu_percent: number | null;
  workload_percent: number | null;
  active_connections: number | null;
  connections_failed: number | null;
  storage_percent: number | null;
  io_percent: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function avg(values: Array<number | null>): number | null {
  const measured = values.filter((v): v is number => v !== null);
  if (measured.length === 0) return null;
  const total = measured.reduce((acc, v) => acc + v, 0);
  return total / measured.length;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((acc, value) => acc + (value ?? 0), 0);
}

function estimateForecast(mtdCost: number, asOf: Date): { value: number; low: number; high: number } {
  const day = Math.max(1, asOf.getDate());
  const daysInMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();
  const baseForecast = (mtdCost / day) * daysInMonth;
  const confidenceBand = baseForecast * 0.08;
  return {
    value: round2(baseForecast),
    low: round2(Math.max(0, baseForecast - confidenceBand)),
    high: round2(baseForecast + confidenceBand),
  };
}

function deriveRecommendations(
  instances: Array<{ id: string; type: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>
): Recommendation[] {
  const suggestions: Recommendation[] = [];

  for (const instance of instances) {
    const monthlyCost = instance.monthlyCostUsd || 0;
    const history = instance.history || [];
    const beforeCount = suggestions.length;
    const avgCpu = avg(history.map((point) => point.cpu_percent));
    const avgWorkload = avg(history.map((point) => point.workload_percent));
    const avgStorage = avg(history.map((point) => point.storage_percent));
    const failedConnections = sum(history.map((point) => point.connections_failed));
    const isElasticPool = instance.type.toLowerCase().includes("elasticpool");

    if (monthlyCost > 0 && avgCpu !== null && avgCpu < 25 && (avgWorkload ?? 0) < 35) {
      suggestions.push({
        title: isElasticPool ? "Rightsizing del Elastic Pool por baja carga" : "Rightsizing de SQL por baja carga",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.22),
        risk: "medium",
        confidence: "high",
        actionType: "guided",
      });
    }

    if (monthlyCost > 0 && avgStorage !== null && avgStorage < 40) {
      suggestions.push({
        title: "Optimizar capacidad de almacenamiento provisionada",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.12),
        risk: "low",
        confidence: "medium",
        actionType: "guided",
      });
    }

    if (monthlyCost > 0 && failedConnections > 0) {
      suggestions.push({
        title: "Reducir fallos de conexión para mitigar riesgo operativo",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.08),
        risk: "high",
        confidence: "medium",
        actionType: "manual",
      });
    }

    if (monthlyCost > 0 && suggestions.length === beforeCount) {
      suggestions.push({
        title: "Revisar plan de compromiso y tier de servicio",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.1),
        risk: "medium",
        confidence: "low",
        actionType: "guided",
      });
    }
  }

  return suggestions.sort((a, b) => b.monthlySavings - a.monthlySavings).slice(0, 10);
}

function buildFinOpsSummaries(instances: Array<{ id: string; type: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>) {
  const now = new Date();
  const mtdCost = round2(instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0));
  const forecastEom = estimateForecast(mtdCost, now);
  const baselinePrevMonth = mtdCost * 0.9;
  const deltaValue = mtdCost - baselinePrevMonth;
  const deltaPct = baselinePrevMonth > 0 ? (deltaValue / baselinePrevMonth) * 100 : 0;

  let underutilizedCount = 0;
  let criticalAlerts = 0;
  let healthAccumulator = 0;
  let totalWorkload = 0;
  let totalStorage = 0;

  for (const instance of instances) {
    const history = instance.history || [];
    const avgCpu = avg(history.map((point) => point.cpu_percent)) ?? 0;
    const avgWorkload = avg(history.map((point) => point.workload_percent)) ?? 0;
    const avgStorage = avg(history.map((point) => point.storage_percent)) ?? 0;
    const failedConn = sum(history.map((point) => point.connections_failed));

    totalWorkload += avgWorkload;
    totalStorage += avgStorage;

    if (avgCpu < 25 && avgWorkload < 35) underutilizedCount += 1;
    if (avgStorage > 85 || avgWorkload > 85 || failedConn > 0) criticalAlerts += 1;

    let healthScore = 100;
    healthScore -= Math.min(30, avgCpu * 0.35);
    healthScore -= Math.min(30, avgWorkload * 0.25);
    healthScore -= Math.min(20, Math.max(0, avgStorage - 70));
    healthScore -= Math.min(20, failedConn * 2);
    healthScore = Math.max(0, Math.min(100, healthScore));
    healthAccumulator += healthScore;
  }

  const workloadK = totalWorkload > 0 ? totalWorkload / 1000 : 0;
  const storageUnit = totalStorage > 0 ? totalStorage / 100 : 0;
  const recommendations = deriveRecommendations(instances);
  const potentialSavings = round2(recommendations.reduce((acc, rec) => acc + rec.monthlySavings, 0));

  return {
    financialSummary: {
      mtdCost,
      forecastEom,
      deltaMoM: { value: round2(deltaValue), percentage: round2(deltaPct) },
      potentialSavings,
    },
    efficiency: {
      costPerUsedGb: storageUnit > 0 ? round2(mtdCost / storageUnit) : 0,
      costPerKOps: workloadK > 0 ? round2(mtdCost / workloadK) : 0,
      underutilizedCount,
    },
    risk: {
      healthScore: instances.length > 0 ? round2(healthAccumulator / instances.length) : 0,
      criticalAlerts,
    },
    recommendations,
  };
}

function generateMockSqlHistory(seedOffset: number): MetricHistoryPoint[] {
  const points: MetricHistoryPoint[] = [];
  const now = new Date();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const h = d.getHours();
    const m = d.getMinutes();
    const timestamp = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const dailyPattern = h >= 8 && h <= 19 ? 1.35 : 0.6;
    const wave = Math.sin((h + seedOffset) * 0.24);
    const noise = 1 + Math.sin(i * 1.7) * 0.08;
    const load = Math.max(0.1, dailyPattern * (1 + wave * 0.2) * noise);

    points.push({
      timestamp,
      cpu_percent: round2(Math.min(99.9, Math.max(2, 30 * load + (seedOffset % 5)))),
      workload_percent: round2(Math.min(99.9, Math.max(2, 28 * load + (seedOffset % 6)))),
      active_connections: Math.round(Math.max(5, 55 * load + (seedOffset % 11))),
      connections_failed: Math.random() > 0.96 ? Math.round(Math.random() * 2) : 0,
      storage_percent: round2(Math.min(99.9, Math.max(8, 45 + i * 0.05 + Math.sin(h) * 0.1))),
      io_percent: round2(Math.min(99.9, Math.max(2, 25 * load + (seedOffset % 7)))),
    });
  }

  return points;
}

async function getMonthlySqlCostFromSnapshots(tenantId: string, subscriptionIds: string[]): Promise<number> {
  if (subscriptionIds.length === 0) return 0;
  const placeholders = subscriptionIds.map(() => "?").join(",");
  const sql = `
    SELECT COALESCE(SUM(cost_usd), 0) AS total
    FROM CostSnapshots
    WHERE tenant_id = ?
      AND subscription_id IN (${placeholders})
      AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      AND (
        LOWER(COALESCE(service_name, '')) LIKE '%sql database%'
        OR LOWER(COALESCE(service_name, '')) LIKE '%sql managed instance%'
        OR LOWER(COALESCE(service_name, '')) LIKE '%sql elastic pool%'
      )
  `;

  try {
    const [rows]: any = await pool.query(sql, [tenantId, ...subscriptionIds]);
    const total = Number(rows?.[0]?.total || 0);
    return Number.isFinite(total) ? round2(total) : 0;
  } catch (error: any) {
    console.warn(`[sql-metrics] Snapshot cost fallback failed for ${tenantId}:`, error?.message);
    return 0;
  }
}

function normalizeType(type: string): string {
  return String(type || "").toLowerCase();
}

function getMetricNamesByType(type: string): string[] {
  const t = normalizeType(type);
  if (t.includes("managedinstances") || t.includes("instancepools")) return SQL_MI_METRICS;
  return SQL_DB_METRICS;
}

function getMetricNamespaceByType(type: string): string {
  const t = normalizeType(type);
  if (t.includes("managedinstances")) return "Microsoft.Sql/managedInstances";
  if (t.includes("instancepools")) return "Microsoft.Sql/instancePools";
  if (t.includes("elasticpools")) return "Microsoft.Sql/servers/elasticPools";
  return "Microsoft.Sql/servers/databases";
}

function metricAliases(metric: string): string[] {
  const base = metric.toLowerCase();
  const aliases: Record<string, string[]> = {
    cpu_percent: ["cpu_percent", "avg_cpu_percent"],
    workload_percent: ["dtu_consumption_percent", "workers_percent", "sessions_percent", "io_requests"],
    active_connections: ["active_connections", "sessions_percent"],
    connections_failed: ["connection_failed", "connections_failed"],
    storage_percent: ["storage_percent", "storage_space_used_mb"],
    io_percent: ["physical_data_read_percent", "log_write_percent", "io_requests"],
  };
  return aliases[base] || [base];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "tenantId parameter is required" }, { status: 400 });

    await requireTenantAccess(request, tenantId);

    if (isMockTenant(tenantId) || tenantId.startsWith("mock-")) {
      const instances = [
        {
          id: "sql-db-prod",
          name: "sql-prod-db",
          type: "microsoft.sql/servers/databases",
          region: "East US",
          sku: "Business Critical Gen5",
          monthlyCostUsd: 780,
          history: generateMockSqlHistory(11),
        },
        {
          id: "sql-mi-prod",
          name: "sql-prod-mi",
          type: "microsoft.sql/managedinstances",
          region: "East US",
          sku: "General Purpose Gen5",
          monthlyCostUsd: 1240,
          history: generateMockSqlHistory(29),
        },
      ];
      return NextResponse.json({
        success: true,
        mock: true,
        resourceExists: true,
        instances,
        ...buildFinOpsSummaries(instances),
      });
    }

    const cacheKey = getDiagnosticsCacheKey("sql-metrics", tenantId);
    if (searchParams.get("bust") === "1") {
      await redis.del(cacheKey).catch(() => undefined);
    } else {
      const cached = await readDiagnosticsCache<unknown>(cacheKey);
      if (cached) return NextResponse.json(cached);
    }

    const credential = await getAzureCredential(tenantId);
    const subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
    if (subscriptionIds.length === 0) {
      const payload = {
        mock: false,
        resourceExists: false,
        message: "No hay suscripciones visibles para este tenant.",
        instances: [],
      };
      await writeDiagnosticsCache(cacheKey, payload);
      return NextResponse.json(payload);
    }

    const resources = await listResourcesByTypes(tenantId, SQL_TYPES, subscriptionIds, credential);
    if (resources.length === 0) {
      const payload = {
        mock: false,
        resourceExists: false,
        message: "No existe Azure SQL Database / Managed Instance / Elastic Pool en este tenant.",
        instances: [],
      };
      await writeDiagnosticsCache(cacheKey, payload);
      return NextResponse.json(payload);
    }

    const billableResources = resources.filter((r) => normalizeType(r.type) !== "microsoft.sql/servers");
    const costPerResource = await getResourceCostsById(
      tenantId,
      billableResources
        .filter((r) => Boolean(r.subscriptionId))
        .map((r) => ({ id: r.id, subscriptionId: String(r.subscriptionId) }))
    );

    const totalCostFromCm = Array.from(costPerResource.values()).reduce((acc, value) => acc + value, 0);
    if (totalCostFromCm <= 0 && billableResources.length > 0) {
      const fallbackTotal = await getMonthlySqlCostFromSnapshots(tenantId, subscriptionIds);
      if (fallbackTotal > 0) {
        const evenShare = round2(fallbackTotal / billableResources.length);
        for (const resource of billableResources) {
          costPerResource.set(resource.id.toLowerCase(), evenShare);
        }
      }
    }

    const tokenResponse = await credential.getToken("https://management.azure.com/.default");
    const headers = { Authorization: `Bearer ${tokenResponse?.token || ""}` };

    const instances = await Promise.all(
      billableResources.map(async (resource) => {
        const monthlyCostUsd = costPerResource.get(resource.id.toLowerCase()) || 0;
        try {
          const metricNames = getMetricNamesByType(resource.type);
          const metricNamespace = getMetricNamespaceByType(resource.type);
          const metricSeries = new Map<string, Array<{ timeStamp: string; value: number | null }>>();

          await Promise.all(
            metricNames.map(async (metricName) => {
              const metricUrl = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnamespace=${encodeURIComponent(metricNamespace)}&metricnames=${encodeURIComponent(metricName)}&timespan=PT24H&interval=PT1H&aggregation=Average,Total`;
              const res = await fetch(metricUrl, { headers });
              if (!res.ok) return;
              const data = await res.json();
              const series = data?.value?.[0]?.timeseries?.[0]?.data;
              if (!Array.isArray(series) || series.length === 0) return;
              metricSeries.set(
                metricName.toLowerCase(),
                series.map((row: any) => ({
                  timeStamp: String(row.timeStamp),
                  value:
                    typeof row.average === "number"
                      ? row.average
                      : typeof row.total === "number"
                        ? row.total
                        : null,
                }))
              );
            })
          );

          const timestampSet = new Set<string>();
          for (const rows of metricSeries.values()) {
            for (const row of rows) timestampSet.add(row.timeStamp);
          }
          const sortedTimestamps = Array.from(timestampSet).sort();
          const history: MetricHistoryPoint[] = [];

          for (const pointDateStr of sortedTimestamps) {
            const dateObj = new Date(pointDateStr);
            const timestamp = `${String(dateObj.getHours()).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`;

            const getMetricValue = (metricName: string): number | null => {
              const aliases = metricAliases(metricName);
              for (const alias of aliases) {
                const rows = metricSeries.get(alias);
                if (!rows) continue;
                const point = rows.find((row) => row.timeStamp === pointDateStr);
                if (point?.value !== null && point?.value !== undefined) return Number(point.value);
              }
              return null;
            };

            history.push({
              timestamp,
              cpu_percent: getMetricValue("cpu_percent"),
              workload_percent: getMetricValue("workload_percent"),
              active_connections: getMetricValue("active_connections"),
              connections_failed: getMetricValue("connections_failed"),
              storage_percent: getMetricValue("storage_percent"),
              io_percent: getMetricValue("io_percent"),
            });
          }

          const telemetryAvailable = history.length > 0;
          return {
            id: resource.id,
            name: resource.name,
            type: normalizeType(resource.type),
            region: resource.location || "unknown",
            sku: resource.skuName || "Unknown",
            monthlyCostUsd,
            history,
            telemetry: {
              available: telemetryAvailable,
              source: telemetryAvailable ? "azure_monitor" : "not_collected",
              message: telemetryAvailable ? undefined : "Azure Monitor no devolvió métricas para el período solicitado.",
            },
          };
        } catch (err: any) {
          return {
            id: resource.id,
            name: resource.name,
            type: normalizeType(resource.type),
            region: resource.location || "unknown",
            sku: resource.skuName || "Unknown",
            monthlyCostUsd,
            history: [],
            telemetry: {
              available: false,
              source: "not_collected",
              message: "No se pudieron consultar las métricas en Azure Monitor.",
            },
          };
        }
      })
    );

    const payload = {
      mock: false,
      resourceExists: true,
      instances,
      ...buildFinOpsSummaries(instances),
    };
    await writeDiagnosticsCache(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({
      mock: false,
      resourceExists: false,
      message: "No se pudieron consultar las métricas de Azure SQL en este momento.",
      instances: [],
      errors: [{ code: "SQL_METRICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
    });
  }
}
