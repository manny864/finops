import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
    listResourcesByTypes,
    getDiagnosticsCacheKey,
    readDiagnosticsCache,
    writeDiagnosticsCache
} from "../diagnosticsShared";
import { redis } from "@/lib/redis";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import pool from "@/modules/storage/db";

// Both lowercase and proper case to match various Azure API responses
const REDIS_TYPES = [
    "microsoft.cache/redis",
    "microsoft.cache/redisenterprise",
    "Microsoft.Cache/Redis",
    "Microsoft.Cache/redisEnterprise"
];

// Métricas para Redis estándar (microsoft.cache/redis)
const STANDARD_REDIS_METRICS = [
    "PercentProcessorTime",
    "ServerLoad",
    "UsedMemory",
    "CacheHits",
    "CacheMisses",
    "ConnectedClients",
    "OperationsPerSecond",
    "EvictedKeys",
    "ExpiredKeys",
    "Errors",
    "CacheRead",
    "CacheWrite"
];

// Métricas para Redis Enterprise (microsoft.cache/redisenterprise)
const ENTERPRISE_REDIS_METRICS = [
    "CpuPercent",
    "UsedMemory",
    "CacheHits",
    "CacheMisses",
    "ConnectedClients",
    "TotalOperations",
    "EvictedKeys",
    "ExpiredKeys",
    "TotalNetworkRead",
    "TotalNetworkWrite"
];

interface MetricHistoryPoint {
    timestamp: string;
    PercentProcessorTime: number | null;
    ServerLoad: number | null;
    UsedMemory: number | null;
    CacheHits: number | null;
    CacheMisses: number | null;
    ConnectedClients: number | null;
    OperationsPerSecond: number | null;
    EvictedKeys: number | null;
    ExpiredKeys: number | null;
    Errors: number | null;
    TotalCommandsProcessed: number | null;
    CacheRead: number | null;
    CacheWrite: number | null;
}

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

interface FinancialSummary {
    mtdCost: number;
    forecastEom: {
        value: number;
        low: number;
        high: number;
    };
    deltaMoM: {
        value: number;
        percentage: number;
    };
    potentialSavings: number;
}

interface EfficiencySummary {
    costPerUsedGb: number;
    costPerKOps: number;
    underutilizedCount: number;
}

interface RiskSummary {
    healthScore: number;
    criticalAlerts: number;
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
        high: round2(baseForecast + confidenceBand)
    };
}

function deriveRecommendations(instances: Array<{ id: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>): Recommendation[] {
    const suggestions: Recommendation[] = [];

    for (const instance of instances) {
        const monthlyCost = instance.monthlyCostUsd || 0;
        const history = instance.history || [];
        const beforeCount = suggestions.length;
        const avgCpu = avg(history.map((point) => point.PercentProcessorTime));
        const avgConnections = avg(history.map((point) => point.ConnectedClients));
        const avgOps = avg(history.map((point) => point.OperationsPerSecond));
        const totalEvictions = sum(history.map((point) => point.EvictedKeys));

        if (monthlyCost > 0 && avgCpu !== null && avgCpu < 25 && (avgConnections ?? 0) < 50) {
            suggestions.push({
                title: "Downsize de SKU por baja utilización",
                instanceId: instance.id,
                monthlySavings: round2(monthlyCost * 0.25),
                risk: "medium",
                confidence: "high",
                actionType: "guided"
            });
        }

        if (monthlyCost > 0 && avgCpu !== null && avgCpu < 12 && (avgOps ?? 0) < 300) {
            suggestions.push({
                title: "Aplicar schedules en ambientes no productivos",
                instanceId: instance.id,
                monthlySavings: round2(monthlyCost * 0.35),
                risk: "low",
                confidence: "medium",
                actionType: "automatic"
            });
        }

        if (monthlyCost > 0 && totalEvictions === 0 && avgCpu !== null && avgCpu < 35) {
            suggestions.push({
                title: "Revisar alta disponibilidad para optimizar costo",
                instanceId: instance.id,
                monthlySavings: round2(monthlyCost * 0.15),
                risk: "high",
                confidence: "low",
                actionType: "manual"
            });
        }

        if (monthlyCost > 0 && suggestions.length === beforeCount) {
            const isLikelyNonProd = /dev|stg|stage|test|qa|sandbox/i.test(instance.id);
            suggestions.push({
                title: isLikelyNonProd
                    ? "Aplicar schedule no-productivo para ahorro base"
                    : "Revisar plan de compromiso/rightsizing de Redis",
                instanceId: instance.id,
                monthlySavings: round2(monthlyCost * (isLikelyNonProd ? 0.3 : 0.1)),
                risk: isLikelyNonProd ? "low" : "medium",
                confidence: "low",
                actionType: isLikelyNonProd ? "automatic" : "guided"
            });
        }
    }

    return suggestions.sort((a, b) => b.monthlySavings - a.monthlySavings).slice(0, 8);
}

async function getMonthlyRedisCostFromSnapshots(tenantId: string, subscriptionIds: string[]): Promise<number> {
    if (subscriptionIds.length === 0) return 0;

    const placeholders = subscriptionIds.map(() => "?").join(",");
    const sql = `
      SELECT COALESCE(SUM(cost_usd), 0) AS total
      FROM CostSnapshots
      WHERE tenant_id = ?
        AND subscription_id IN (${placeholders})
        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        AND LOWER(COALESCE(service_name, '')) LIKE '%redis%'
    `;

    try {
        const [rows]: any = await pool.query(sql, [tenantId, ...subscriptionIds]);
        const total = Number(rows?.[0]?.total || 0);
        return Number.isFinite(total) ? round2(total) : 0;
    } catch (error: any) {
        console.warn(`[redis-metrics] Snapshot cost fallback failed for ${tenantId}:`, error?.message);
        return 0;
    }
}

function buildFinOpsSummaries(instances: Array<{ monthlyCostUsd: number; history: MetricHistoryPoint[] }>): {
    financialSummary: FinancialSummary;
    efficiency: EfficiencySummary;
    risk: RiskSummary;
    recommendations: Recommendation[];
} {
    const now = new Date();
    const mtdCost = round2(instances.reduce((acc, instance) => acc + (instance.monthlyCostUsd || 0), 0));
    const forecastEom = estimateForecast(mtdCost, now);

    const baselinePrevMonth = mtdCost * 0.92;
    const deltaValue = mtdCost - baselinePrevMonth;
    const deltaPct = baselinePrevMonth > 0 ? (deltaValue / baselinePrevMonth) * 100 : 0;

    let totalUsedMemoryBytes = 0;
    let totalOpsPerSecond = 0;
    let underutilizedCount = 0;
    let criticalAlerts = 0;
    let healthAccumulator = 0;

    for (const instance of instances) {
        const history = instance.history || [];
        const avgCpu = avg(history.map((point) => point.PercentProcessorTime)) ?? 0;
        const avgMemory = avg(history.map((point) => point.UsedMemory)) ?? 0;
        const avgOps = avg(history.map((point) => point.OperationsPerSecond)) ?? 0;
        const evictions = sum(history.map((point) => point.EvictedKeys));
        const errors = sum(history.map((point) => point.Errors));

        totalUsedMemoryBytes += avgMemory;
        totalOpsPerSecond += avgOps;

        if (avgCpu < 25 && avgOps < 500) {
            underutilizedCount += 1;
        }

        if (avgMemory > 0 && avgMemory >= 0.85 * 1024 * 1024 * 1024 * 5) {
            criticalAlerts += 1;
        }
        if (evictions > 0) {
            criticalAlerts += 1;
        }
        if (errors > 0) {
            criticalAlerts += 1;
        }

        let healthScore = 100;
        healthScore -= Math.min(30, avgCpu * 0.35);
        healthScore -= Math.min(30, evictions * 2);
        healthScore -= Math.min(20, errors * 3);
        healthScore = Math.max(0, Math.min(100, healthScore));
        healthAccumulator += healthScore;
    }

    const usedGb = totalUsedMemoryBytes > 0 ? totalUsedMemoryBytes / (1024 * 1024 * 1024) : 0;
    const kOps = totalOpsPerSecond > 0 ? totalOpsPerSecond / 1000 : 0;

    const recommendations = deriveRecommendations(instances as Array<{ id: string; monthlyCostUsd: number; history: MetricHistoryPoint[] }>);
    const potentialSavings = round2(recommendations.reduce((acc, rec) => acc + rec.monthlySavings, 0));

    return {
        financialSummary: {
            mtdCost,
            forecastEom,
            deltaMoM: {
                value: round2(deltaValue),
                percentage: round2(deltaPct)
            },
            potentialSavings
        },
        efficiency: {
            costPerUsedGb: usedGb > 0 ? round2(mtdCost / usedGb) : 0,
            costPerKOps: kOps > 0 ? round2(mtdCost / kOps) : 0,
            underutilizedCount
        },
        risk: {
            healthScore: instances.length > 0 ? round2(healthAccumulator / instances.length) : 0,
            criticalAlerts
        },
        recommendations
    };
}

function generateMockRedisHistory(seedOffset: number): MetricHistoryPoint[] {
    const points: MetricHistoryPoint[] = [];
    const now = new Date();
    
    for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hours = d.getHours();
        const mins = d.getMinutes();
        const timestamp = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        
        const dailyPattern = hours >= 9 && hours <= 18 ? 1.4 : 0.7;
        const sineWave = Math.sin((hours + seedOffset) * 0.25);
        const noise = 1 + (Math.sin(i * 1.5) * 0.1);
        
        const loadFactor = Math.max(0.1, dailyPattern * (1 + sineWave * 0.3) * noise);

        const cpu = parseFloat(Math.min(99.9, Math.max(1.2, 25 * loadFactor + (seedOffset % 5))).toFixed(1));
        const serverLoad = parseFloat(Math.min(99.9, Math.max(0.8, cpu * 0.85 + (seedOffset % 3))).toFixed(1));
        
        const baseMemory = 2.5 * 1024 * 1024 * 1024;
        const memoryGrowth = i * 4 * 1024 * 1024;
        const memoryVar = Math.sin(hours) * 150 * 1024 * 1024;
        const usedMemory = Math.round(baseMemory - memoryGrowth + memoryVar);

        const clients = Math.round(Math.max(5, 60 * loadFactor + (seedOffset % 12)));
        const ops = Math.round(Math.max(10, 4200 * loadFactor + (seedOffset % 200)));
        
        const cacheHits = Math.round(Math.max(50, 95000 * loadFactor));
        const cacheMisses = Math.round(Math.max(2, 4500 * (1.2 - loadFactor * 0.2)));
        
        const evicted = hours === 14 || hours === 16 ? Math.round(Math.max(0, 12 * Math.random() - 8)) : 0;
        const expired = Math.round(Math.max(5, 45 * loadFactor));
        
        const errors = Math.random() > 0.96 ? Math.round(Math.random() * 3) : 0;
        const totalCmds = Math.round(ops * 3600);
        
        const cacheRead = Math.round(Math.max(1024 * 100, 15 * 1024 * 1024 * loadFactor));
        const cacheWrite = Math.round(Math.max(1024 * 20, 4 * 1024 * 1024 * loadFactor));

        points.push({
            timestamp,
            PercentProcessorTime: cpu,
            ServerLoad: serverLoad,
            UsedMemory: usedMemory,
            CacheHits: cacheHits,
            CacheMisses: cacheMisses,
            ConnectedClients: clients,
            OperationsPerSecond: ops,
            EvictedKeys: evicted,
            ExpiredKeys: expired,
            Errors: errors,
            TotalCommandsProcessed: totalCmds,
            CacheRead: cacheRead,
            CacheWrite: cacheWrite
        });
    }
    
    return points;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json(
                { error: "tenantId parameter is required" },
                { status: 400 }
            );
        }

        await requireTenantAccess(request, tenantId);

        // Mock mode verification
        if (isMockTenant(tenantId) || tenantId.startsWith("mock-")) {
            const mockInstances = [
                {
                    id: "redis-mock-prod",
                    name: "redis-prod-eastus",
                    region: "East US",
                    sku: "Premium (P1)",
                    monthlyCostUsd: 1450,
                    history: generateMockRedisHistory(10)
                },
                {
                    id: "redis-mock-dev",
                    name: "redis-dev-eastus",
                    region: "East US",
                    sku: "Standard (C1)",
                    monthlyCostUsd: 280,
                    history: generateMockRedisHistory(42)
                }
            ];
            const summaries = buildFinOpsSummaries(mockInstances);
            return NextResponse.json({
                success: true,
                mock: true,
                instances: mockInstances,
                ...summaries
            });
        }

        const cacheKey = getDiagnosticsCacheKey("redis-metrics", tenantId);
        
        const isRealtime = searchParams.get("realtime") === "true" || searchParams.get("bust") === "1";

        // Bypass cache in realtime mode or when cache bust requested
        if (searchParams.get("bust") === "1") {
            await redis.del(cacheKey).catch(() => undefined);
        } else if (!isRealtime) {
            const cached = await readDiagnosticsCache<unknown>(cacheKey);
            if (cached) return NextResponse.json(cached);
        }

        const credential = await getAzureCredential(tenantId);
        // First try getAllSubscriptionsForTenant (with plan limits)
        let subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
        
        console.log(`[redis-metrics] getAllSubscriptionsForTenant returned ${subscriptionIds.length} subscriptions`);
        if (subscriptionIds.length > 0) {
          console.log(`[redis-metrics] subscriptionIds:`, subscriptionIds);
        }

        if (subscriptionIds.length === 0) {
          const payload = {
            mock: false,
            resourceExists: false,
            message: "No hay suscripciones visibles para este tenant.",
            instances: []
          };
          await writeDiagnosticsCache(cacheKey, payload);
          return NextResponse.json(payload);
        }

        const resources = await listResourcesByTypes(tenantId, REDIS_TYPES, subscriptionIds, credential);
        console.log(`[redis-metrics] listResourcesByTypes returned ${resources.length} resources`);
        if (resources.length > 0) {
          console.log(`[redis-metrics] resources:`, resources.map(r => ({ name: r.name, type: r.type, id: r.id })));
        }
        
        if (resources.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existe Azure Cache for Redis en este tenant.",
                instances: []
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
            const fallbackTotal = await getMonthlyRedisCostFromSnapshots(tenantId, subscriptionIds);
            if (fallbackTotal > 0) {
                const evenShare = round2(fallbackTotal / resources.length);
                for (const resource of resources) {
                    costPerResource.set(resource.id.toLowerCase(), evenShare);
                }
                console.log(`[redis-metrics] Applied CostSnapshots fallback total=${fallbackTotal} across ${resources.length} resources`);
            }
        }

        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        const headers = { Authorization: `Bearer ${tokenResponse.token}` };

        // Consultar métricas en paralelo para cada instancia
        const instances = await Promise.all(
            resources.map(async (resource) => {
                const monthlyCostUsd = costPerResource.get(resource.id.toLowerCase()) || 0;
                try {
                    const isEnterprise = resource.type?.toLowerCase() === "microsoft.cache/redisenterprise";
                    const metricsToQuery = isEnterprise ? ENTERPRISE_REDIS_METRICS : STANDARD_REDIS_METRICS;
                    const timespan = isRealtime ? "PT1H" : "PT24H";
                    const interval = isRealtime ? "PT1M" : "PT1H";
                    const metricNamespace = isEnterprise ? "Microsoft.Cache/redisEnterprise" : "Microsoft.Cache/Redis";
                    const metricSeries = new Map<string, Array<{ timeStamp: string; value: number | null }>>();

                    await Promise.all(
                        metricsToQuery.map(async (metricName) => {
                            const metricUrl = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnamespace=${encodeURIComponent(metricNamespace)}&metricnames=${encodeURIComponent(metricName)}&timespan=${timespan}&interval=${interval}&aggregation=Average,Total`;
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
                                })),
                            );
                        }),
                    );

                    const timestampSet = new Set<string>();
                    for (const rows of metricSeries.values()) {
                        for (const row of rows) timestampSet.add(row.timeStamp);
                    }
                    const sortedTimestamps = Array.from(timestampSet).sort();

                    const history: MetricHistoryPoint[] = [];

                    for (const pointDateStr of sortedTimestamps) {
                        const dateObj = new Date(pointDateStr);
                        const timestamp = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

                        const getMetricValue = (metricName: string): number | null => {
                            const rows = metricSeries.get(metricName.toLowerCase());
                            if (!rows) return null;
                            const point = rows.find((row) => row.timeStamp === pointDateStr);
                            return point?.value ?? null;
                        };

                        let cpu: number | null = null;
                        let serverLoad: number | null = null;
                        let usedMemory: number | null = null;
                        let cacheHits: number | null = null;
                        let cacheMisses: number | null = null;
                        let clients: number | null = null;
                        let ops: number | null = null;
                        let evicted: number | null = null;
                        let expired: number | null = null;
                        let errors: number | null = null;
                        let totalCmds: number | null = null;
                        let cacheRead: number | null = null;
                        let cacheWrite: number | null = null;

                        if (isEnterprise) {
                            cpu = getMetricValue("CpuPercent");
                            serverLoad = cpu;
                            usedMemory = getMetricValue("UsedMemory");
                            cacheHits = getMetricValue("CacheHits");
                            cacheMisses = getMetricValue("CacheMisses");
                            clients = getMetricValue("ConnectedClients");

                            const totalOps = getMetricValue("TotalOperations");
                            ops = totalOps === null ? null : parseFloat((totalOps / 3600).toFixed(2));

                            evicted = getMetricValue("EvictedKeys");
                            expired = getMetricValue("ExpiredKeys");
                            errors = null;
                            totalCmds = totalOps;
                            cacheRead = getMetricValue("TotalNetworkRead");
                            cacheWrite = getMetricValue("TotalNetworkWrite");
                        } else {
                            cpu = getMetricValue("PercentProcessorTime");
                            serverLoad = getMetricValue("ServerLoad");
                            usedMemory = getMetricValue("UsedMemory");
                            cacheHits = getMetricValue("CacheHits");
                            cacheMisses = getMetricValue("CacheMisses");
                            clients = getMetricValue("ConnectedClients");
                            ops = getMetricValue("OperationsPerSecond");
                            evicted = getMetricValue("EvictedKeys");
                            expired = getMetricValue("ExpiredKeys");
                            errors = getMetricValue("Errors");
                            totalCmds = ops === null ? null : Math.round(ops * 3600);
                            cacheRead = getMetricValue("CacheRead");
                            cacheWrite = getMetricValue("CacheWrite");
                        }

                        history.push({
                            timestamp,
                            PercentProcessorTime: cpu,
                            ServerLoad: serverLoad,
                            UsedMemory: usedMemory,
                            CacheHits: cacheHits,
                            CacheMisses: cacheMisses,
                            ConnectedClients: clients,
                            OperationsPerSecond: ops,
                            EvictedKeys: evicted,
                            ExpiredKeys: expired,
                            Errors: errors,
                            TotalCommandsProcessed: totalCmds,
                            CacheRead: cacheRead,
                            CacheWrite: cacheWrite
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
                            message: telemetryAvailable ? undefined : "Azure Monitor no devolvió métricas para el período solicitado."
                        }
                    };

                } catch (err: any) {
                    console.error(`Error al consultar métricas para ${resource.name}:`, err.message);
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
                            message: "No se pudieron consultar las métricas en Azure Monitor."
                        }
                    };
                }
            })
        );

        const payload = {
            mock: false,
            resourceExists: true,
            instances,
            ...buildFinOpsSummaries(instances)
        };

        await writeDiagnosticsCache(cacheKey, payload);
        return NextResponse.json(payload);

    } catch (error) {
        if (error instanceof AuthError) {
            const debugAuth =
                request.nextUrl.searchParams.get("debugAuth") === "1" ||
                request.headers.get("x-debug-auth") === "1";

            const body: { error: string; code?: string } = { error: error.message };
            if (debugAuth && error.code) {
                body.code = error.code;
            }

            return NextResponse.json(body, { status: error.status });
        }
        return NextResponse.json({
            mock: false,
            resourceExists: false,
            message: "No se pudieron consultar las métricas de Redis en este momento.",
            instances: [],
            errors: [{ code: "REDIS_METRICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }]
        });
    }
}
