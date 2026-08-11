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

const COSMOS_TYPES = [
  "microsoft.documentdb/databaseaccounts",
  "Microsoft.DocumentDB/databaseAccounts",
];

const COSMOS_METRICS = [
  "TotalRequestUnits",
  "ProvisionedThroughput",
  "TotalRequests",
  "ThrottledRequests",
  "ServerSideLatency",
  "DataUsage",
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
  ru_consumed: number | null;
  ru_provisioned: number | null;
  request_count: number | null;
  throttled_requests: number | null;
  latency_ms: number | null;
  data_usage_gb: number | null;
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

function metricAliases(metric: string): string[] {
  const aliases: Record<string, string[]> = {
    ru_consumed: ["totalrequestunits"],
    ru_provisioned: ["provisionedthroughput"],
    request_count: ["totalrequests"],
    throttled_requests: ["throttledrequests"],
    latency_ms: ["serversidelatency"],
    data_usage_gb: ["datausage"],
  };
  return aliases[metric] || [metric];
}

function deriveRecommendations(
  instances: Array<{ id: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>
): Recommendation[] {
  const suggestions: Recommendation[] = [];

  for (const instance of instances) {
    const monthlyCost = instance.monthlyCostUsd || 0;
    const history = instance.history || [];
    const beforeCount = suggestions.length;
    const avgRuConsumed = avg(history.map((point) => point.ru_consumed));
    const avgRuProvisioned = avg(history.map((point) => point.ru_provisioned));
    const avgLatency = avg(history.map((point) => point.latency_ms));
    const throttled = sum(history.map((point) => point.throttled_requests));

    const utilization = avgRuProvisioned && avgRuProvisioned > 0
      ? (avgRuConsumed ?? 0) / avgRuProvisioned
      : 0;

    if (monthlyCost > 0 && avgRuProvisioned !== null && utilization < 0.35) {
      suggestions.push({
        title: "Rightsizing de throughput por baja utilización de RU",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.24),
        risk: "medium",
        confidence: "high",
        actionType: "guided",
      });
    }

    if (monthlyCost > 0 && throttled > 0 && utilization < 0.7) {
      suggestions.push({
        title: "Rebalancear throughput/particiones para reducir throttling",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.12),
        risk: "high",
        confidence: "medium",
        actionType: "manual",
      });
    }

    if (monthlyCost > 0 && avgLatency !== null && avgLatency < 15 && utilization < 0.5) {
      suggestions.push({
        title: "Evaluar autoscale o reducción de capacidad provisionada",
        instanceId: instance.id,
        monthlySavings: round2(monthlyCost * 0.15),
        risk: "low",
        confidence: "medium",
        actionType: "guided",
      });
    }

    if (monthlyCost > 0 && suggestions.length === beforeCount) {
      suggestions.push({
        title: "Revisar estrategia de reservas/commit para Cosmos DB",
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

function buildFinOpsSummaries(instances: Array<{ id: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>) {
  const now = new Date();
  const mtdCost = round2(instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0));
  const forecastEom = estimateForecast(mtdCost, now);
  const baselinePrevMonth = mtdCost * 0.9;
  const deltaValue = mtdCost - baselinePrevMonth;
  const deltaPct = baselinePrevMonth > 0 ? (deltaValue / baselinePrevMonth) * 100 : 0;

  let underutilizedCount = 0;
  let criticalAlerts = 0;
  let healthAccumulator = 0;
  let totalRequests = 0;
  let totalUsageGb = 0;

  for (const instance of instances) {
    const history = instance.history || [];
    const avgRuConsumed = avg(history.map((point) => point.ru_consumed)) ?? 0;
    const avgRuProvisioned = avg(history.map((point) => point.ru_provisioned)) ?? 0;
    const avgLatency = avg(history.map((point) => point.latency_ms)) ?? 0;
    const avgUsageGb = avg(history.map((point) => point.data_usage_gb)) ?? 0;
    const requests = sum(history.map((point) => point.request_count));
    const throttled = sum(history.map((point) => point.throttled_requests));
    const utilization = avgRuProvisioned > 0 ? avgRuConsumed / avgRuProvisioned : 0;

    totalRequests += requests;
    totalUsageGb += avgUsageGb;

    if (avgRuProvisioned > 0 && utilization < 0.35) underutilizedCount += 1;
    if (throttled > 0 || avgLatency > 25 || utilization > 0.9) criticalAlerts += 1;

    let healthScore = 100;
    healthScore -= Math.min(35, utilization * 50);
    healthScore -= Math.min(25, throttled * 1.5);
    healthScore -= Math.min(25, Math.max(0, avgLatency - 10));
    healthScore -= Math.min(15, Math.max(0, avgUsageGb - 500) * 0.1);
    healthScore = Math.max(0, Math.min(100, healthScore));
    healthAccumulator += healthScore;
  }

  const kOps = totalRequests > 0 ? totalRequests / 1000 : 0;
  const recommendations = deriveRecommendations(instances);
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
      costPerUsedGb: totalUsageGb > 0 ? round2(mtdCost / totalUsageGb) : 0,
      costPerKOps: kOps > 0 ? round2(mtdCost / kOps) : 0,
      underutilizedCount,
    },
    risk: {
      healthScore: instances.length > 0 ? round2(healthAccumulator / instances.length) : 0,
      criticalAlerts,
    },
    recommendations,
  };
}

function generateMockCosmosHistory(seedOffset: number): MetricHistoryPoint[] {
  const points: MetricHistoryPoint[] = [];
  const now = new Date();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const h = d.getHours();
    const m = d.getMinutes();
    const timestamp = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const dailyPattern = h >= 8 && h <= 21 ? 1.3 : 0.58;
    const wave = Math.sin((h + seedOffset) * 0.22);
    const noise = 1 + Math.sin(i * 1.2) * 0.08;
    const load = Math.max(0.1, dailyPattern * (1 + wave * 0.2) * noise);

    points.push({
      timestamp,
      ru_consumed: round2(Math.max(200, 4800 * load)),
      ru_provisioned: 6000,
      request_count: Math.round(Math.max(1000, 52000 * load)),
      throttled_requests: load > 1.25 ? Math.round(8 * load) : 0,
      latency_ms: round2(Math.max(4, 8 + load * 5)),
      data_usage_gb: round2(Math.max(40, 110 + Math.sin(h * 0.1) * 8 + seedOffset)),
    });
  }

  return points;
}

async function getMonthlyCosmosCostFromSnapshots(tenantId: string, subscriptionIds: string[]): Promise<number> {
  if (subscriptionIds.length === 0) return 0;
  const placeholders = subscriptionIds.map(() => "?").join(",");
  const sql = `
    SELECT COALESCE(SUM(cost_usd), 0) AS total
    FROM CostSnapshots
    WHERE tenant_id = ?
      AND subscription_id IN (${placeholders})
      AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      AND (
        LOWER(COALESCE(service_name, '')) LIKE '%cosmos%'
        OR LOWER(COALESCE(service_name, '')) LIKE '%documentdb%'
      )
  `;

  try {
    const [rows]: any = await pool.query(sql, [tenantId, ...subscriptionIds]);
    const total = Number(rows?.[0]?.total || 0);
    return Number.isFinite(total) ? round2(total) : 0;
  } catch (error: any) {
    console.warn(`[cosmos-metrics] Snapshot cost fallback failed for ${tenantId}:`, error?.message);
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
          id: "cosmos-mock-prod",
          name: "cosmos-prod-eastus",
          region: "East US",
          sku: "Standard",
          monthlyCostUsd: 930,
          history: generateMockCosmosHistory(10),
        },
        {
          id: "cosmos-mock-stg",
          name: "cosmos-stg-eastus",
          region: "East US",
          sku: "Standard",
          monthlyCostUsd: 240,
          history: generateMockCosmosHistory(38),
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

    const cacheKey = getDiagnosticsCacheKey("cosmos-metrics", tenantId);
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

    const resources = await listResourcesByTypes(tenantId, COSMOS_TYPES, subscriptionIds, credential);
    if (resources.length === 0) {
      const payload = {
        mock: false,
        resourceExists: false,
        message: "No existe Azure Cosmos DB en este tenant.",
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
      const fallbackTotal = await getMonthlyCosmosCostFromSnapshots(tenantId, subscriptionIds);
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
          const metricNamespace = "Microsoft.DocumentDB/databaseAccounts";
          const metricSeries = new Map<string, Array<{ timeStamp: string; value: number | null }>>();

          await Promise.all(
            COSMOS_METRICS.map(async (metricName) => {
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
              ru_consumed: getMetricValue("ru_consumed"),
              ru_provisioned: getMetricValue("ru_provisioned"),
              request_count: getMetricValue("request_count"),
              throttled_requests: getMetricValue("throttled_requests"),
              latency_ms: getMetricValue("latency_ms"),
              data_usage_gb: getMetricValue("data_usage_gb"),
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
        } catch {
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
      message: "No se pudieron consultar las métricas de Cosmos DB en este momento.",
      instances: [],
      errors: [{ code: "COSMOS_METRICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
    });
  }
}
