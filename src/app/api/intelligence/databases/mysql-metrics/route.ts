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

const MYSQL_TYPES = [
  "microsoft.dbformysql/flexibleservers",
  "microsoft.dbformysql/servers",
  "Microsoft.DBforMySQL/flexibleServers",
  "Microsoft.DBforMySQL/servers",
];

const MYSQL_METRICS = [
  "cpu_percent",
  "memory_percent",
  "active_connections",
  "connections_failed",
  "storage_percent",
  "io_consumption_percent",
  "network_bytes_ingress",
  "network_bytes_egress",
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
  memory_percent: number | null;
  active_connections: number | null;
  connections_failed: number | null;
  storage_percent: number | null;
  io_consumption_percent: number | null;
  network_bytes_ingress: number | null;
  network_bytes_egress: number | null;
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
  const year = asOf.getFullYear();
  const month = asOf.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const baseForecast = (mtdCost / day) * daysInMonth;
  const confidenceBand = baseForecast * 0.08;
  return {
    value: round2(baseForecast),
    low: round2(Math.max(0, baseForecast - confidenceBand)),
    high: round2(baseForecast + confidenceBand),
  };
}

function deriveRecommendations(
  instances: Array<{ id: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>
): Recommendation[] {
  const suggestions: Recommendation[] = [];

  for (const instance of instances) {
    const monthlyCost = instance.monthlyCostUsd || 0;
    const history = instance.history || [];
    const beforeCount = suggestions.length;
    const avgCpu = avg(history.map((point) => point.cpu_percent));
    const avgStorage = avg(history.map((point) => point.storage_percent));
    const avgConnections = avg(history.map((point) => point.active_connections));
    const avgIo = avg(history.map((point) => point.io_consumption_percent));
    const failedConnections = sum(history.map((point) => point.connections_failed));

    if (monthlyCost > 0 && avgCpu !== null && avgCpu < 25 && (avgConnections ?? 0) < 50) {
      suggestions.push({
        title: "Downsize de SKU por baja utilización",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.25),
        risk: "medium",
        confidence: "high",
        actionType: "guided",
      });
    }

    if (monthlyCost > 0 && avgStorage !== null && avgStorage < 45 && (avgIo ?? 0) < 45) {
      suggestions.push({
        title: "Optimizar storage/IO provisionado",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.15),
        risk: "low",
        confidence: "medium",
        actionType: "guided",
      });
    }

    if (monthlyCost > 0 && failedConnections > 0) {
      suggestions.push({
        title: "Reducir fallos de conexión para evitar riesgo operativo",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.1),
        risk: "high",
        confidence: "medium",
        actionType: "manual",
      });
    }

    if (monthlyCost > 0 && suggestions.length === beforeCount) {
      const isLikelyNonProd = /dev|stg|stage|test|qa|sandbox/i.test(instance.id);
      suggestions.push({
        title: isLikelyNonProd
          ? "Aplicar schedule no-productivo para ahorro base"
          : "Revisar compromiso y rightsizing de MySQL",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * (isLikelyNonProd ? 0.3 : 0.1)),
        risk: isLikelyNonProd ? "low" : "medium",
        confidence: "low",
        actionType: isLikelyNonProd ? "automatic" : "guided",
      });
    }
  }

  return suggestions.sort((a, b) => b.monthlySavings - a.monthlySavings).slice(0, 8);
}

function buildFinOpsSummaries(instances: Array<{ monthlyCostUsd: number; history: MetricHistoryPoint[] }>) {
  const now = new Date();
  const mtdCost = round2(instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0));
  const forecastEom = estimateForecast(mtdCost, now);

  const baselinePrevMonth = mtdCost * 0.9;
  const deltaValue = mtdCost - baselinePrevMonth;
  const deltaPct = baselinePrevMonth > 0 ? (deltaValue / baselinePrevMonth) * 100 : 0;

  let underutilizedCount = 0;
  let criticalAlerts = 0;
  let healthAccumulator = 0;
  let totalConnections = 0;
  let totalNetworkBytes = 0;

  for (const instance of instances) {
    const history = instance.history || [];
    const avgCpu = avg(history.map((point) => point.cpu_percent)) ?? 0;
    const avgIo = avg(history.map((point) => point.io_consumption_percent)) ?? 0;
    const avgStorage = avg(history.map((point) => point.storage_percent)) ?? 0;
    const avgConn = avg(history.map((point) => point.active_connections)) ?? 0;
    const failedConn = sum(history.map((point) => point.connections_failed));
    const ingress = sum(history.map((point) => point.network_bytes_ingress));
    const egress = sum(history.map((point) => point.network_bytes_egress));

    totalConnections += avgConn;
    totalNetworkBytes += ingress + egress;

    if (avgCpu < 25 && avgIo < 50 && avgConn < 80) underutilizedCount += 1;
    if (avgStorage >= 85 || avgIo >= 80 || failedConn > 0) criticalAlerts += 1;

    let healthScore = 100;
    healthScore -= Math.min(30, avgCpu * 0.35);
    healthScore -= Math.min(25, avgIo * 0.25);
    healthScore -= Math.min(25, Math.max(0, avgStorage - 70));
    healthScore -= Math.min(20, failedConn * 2);
    healthScore = Math.max(0, Math.min(100, healthScore));
    healthAccumulator += healthScore;
  }

  const kConnections = totalConnections > 0 ? totalConnections / 1000 : 0;
  const networkGb = totalNetworkBytes > 0 ? totalNetworkBytes / (1024 * 1024 * 1024) : 0;
  const recommendations = deriveRecommendations(
    instances as Array<{ id: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>
  );
  const potentialSavings = round2(recommendations.reduce((acc, rec) => acc + rec.monthlySavings, 0));

  return {
    financialSummary: {
      mtdCost,
      forecastEom,
      deltaMoM: {
        value: round2(deltaValue),
        percentage: round2(deltaPct),
      },
      potentialSavings,
    },
    efficiency: {
      costPerUsedGb: networkGb > 0 ? round2(mtdCost / networkGb) : 0,
      costPerKOps: kConnections > 0 ? round2(mtdCost / kConnections) : 0,
      underutilizedCount,
    },
    risk: {
      healthScore: instances.length > 0 ? round2(healthAccumulator / instances.length) : 0,
      criticalAlerts,
    },
    recommendations,
  };
}

function generateMockMysqlHistory(seedOffset: number): MetricHistoryPoint[] {
  const points: MetricHistoryPoint[] = [];
  const now = new Date();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hours = d.getHours();
    const mins = d.getMinutes();
    const timestamp = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    const dailyPattern = hours >= 9 && hours <= 18 ? 1.3 : 0.6;
    const sineWave = Math.sin((hours + seedOffset) * 0.25);
    const noise = 1 + Math.sin(i * 1.5) * 0.08;
    const loadFactor = Math.max(0.1, dailyPattern * (1 + sineWave * 0.25) * noise);

    points.push({
      timestamp,
      cpu_percent: round2(Math.min(99.9, Math.max(1.5, 35 * loadFactor + (seedOffset % 4)))),
      memory_percent: round2(Math.min(99.9, Math.max(10, 50 * loadFactor + 20 + (seedOffset % 10)))),
      active_connections: Math.round(Math.max(2, 45 * loadFactor + (seedOffset % 10))),
      connections_failed: Math.random() > 0.95 ? Math.round(Math.random() * 2) : 0,
      storage_percent: round2(Math.min(99.9, Math.max(5, 45 + i * 0.05 + Math.sin(hours) * 0.1))),
      io_consumption_percent: round2(Math.min(99.9, Math.max(0.5, 20 * loadFactor + (seedOffset % 5)))),
      network_bytes_ingress: Math.round(Math.max(1024 * 5, 8 * 1024 * 1024 * loadFactor)),
      network_bytes_egress: Math.round(Math.max(1024 * 20, 25 * 1024 * 1024 * loadFactor)),
    });
  }

  return points;
}

async function getMonthlyMysqlCostFromSnapshots(tenantId: string, subscriptionIds: string[]): Promise<number> {
  if (subscriptionIds.length === 0) return 0;
  const placeholders = subscriptionIds.map(() => "?").join(",");
  const sql = `
    SELECT COALESCE(SUM(cost_usd), 0) AS total
    FROM CostSnapshots
    WHERE tenant_id = ?
      AND subscription_id IN (${placeholders})
      AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      AND (
        LOWER(COALESCE(service_name, '')) LIKE '%mysql%'
        OR LOWER(COALESCE(service_name, '')) LIKE '%azure database for mysql%'
      )
  `;

  try {
    const [rows]: any = await pool.query(sql, [tenantId, ...subscriptionIds]);
    const total = Number(rows?.[0]?.total || 0);
    return Number.isFinite(total) ? round2(total) : 0;
  } catch (error: any) {
    console.warn(`[mysql-metrics] Snapshot cost fallback failed for ${tenantId}:`, error?.message);
    return 0;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId parameter is required" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    if (isMockTenant(tenantId) || tenantId.startsWith("mock-")) {
      const instances = [
        {
          id: "mysql-mock-prod",
          name: "mysql-prod-eastus",
          region: "East US",
          sku: "General Purpose (GP_Gen5_4)",
          monthlyCostUsd: 420,
          history: generateMockMysqlHistory(15),
        },
        {
          id: "mysql-mock-dev",
          name: "mysql-dev-eastus",
          region: "East US",
          sku: "Burstable (B_Gen5_1)",
          monthlyCostUsd: 65,
          history: generateMockMysqlHistory(88),
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

    const cacheKey = getDiagnosticsCacheKey("mysql-metrics", tenantId);

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

    const resources = await listResourcesByTypes(tenantId, MYSQL_TYPES, subscriptionIds, credential);
    if (resources.length === 0) {
      const payload = {
        mock: false,
        resourceExists: false,
        message: "No existe Azure Database for MySQL en este tenant.",
        instances: [],
      };
      await writeDiagnosticsCache(cacheKey, payload);
      return NextResponse.json(payload);
    }

    const costPerResource = await getResourceCostsById(
      tenantId,
      resources
        .filter((r) => Boolean(r.subscriptionId))
        .map((r) => ({ id: r.id, subscriptionId: String(r.subscriptionId) }))
    );

    const totalCostFromCm = Array.from(costPerResource.values()).reduce((acc, value) => acc + value, 0);
    if (totalCostFromCm <= 0 && resources.length > 0) {
      const fallbackTotal = await getMonthlyMysqlCostFromSnapshots(tenantId, subscriptionIds);
      if (fallbackTotal > 0) {
        const evenShare = round2(fallbackTotal / resources.length);
        for (const resource of resources) {
          costPerResource.set(resource.id.toLowerCase(), evenShare);
        }
      }
    }

    const tokenResponse = await credential.getToken("https://management.azure.com/.default");
    const headers = { Authorization: `Bearer ${tokenResponse?.token || ""}` };

    const instances = await Promise.all(
      resources.map(async (resource) => {
        const monthlyCostUsd = costPerResource.get(resource.id.toLowerCase()) || 0;
        try {
          const resourceType = String(resource.type || "").toLowerCase();
          const metricNamespace = resourceType.includes("flexibleservers")
            ? "Microsoft.DBforMySQL/flexibleServers"
            : "Microsoft.DBforMySQL/servers";
          const metricSeries = new Map<string, Array<{ timeStamp: string; value: number | null }>>();

          await Promise.all(
            MYSQL_METRICS.map(async (metricName) => {
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
              const rows = metricSeries.get(metricName.toLowerCase());
              if (!rows) return null;
              const point = rows.find((row) => row.timeStamp === pointDateStr);
              return point?.value ?? null;
            };

            history.push({
              timestamp,
              cpu_percent: getMetricValue("cpu_percent"),
              memory_percent: getMetricValue("memory_percent"),
              active_connections: getMetricValue("active_connections"),
              connections_failed: getMetricValue("connections_failed"),
              storage_percent: getMetricValue("storage_percent"),
              io_consumption_percent: getMetricValue("io_consumption_percent"),
              network_bytes_ingress: getMetricValue("network_bytes_ingress"),
              network_bytes_egress: getMetricValue("network_bytes_egress"),
            });
          }

          const telemetryAvailable = history.length > 0;
          return {
            id: resource.id,
            name: resource.name,
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
          console.error(`[mysql-metrics] Error al consultar métricas para ${resource.name}:`, err.message);
          return {
            id: resource.id,
            name: resource.name,
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
      message: "No se pudieron consultar las métricas de MySQL en este momento.",
      instances: [],
      errors: [{ code: "MYSQL_METRICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
    });
  }
}
