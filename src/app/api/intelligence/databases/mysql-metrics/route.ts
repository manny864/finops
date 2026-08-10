import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
    listResourcesByTypes,
    getDiagnosticsCacheKey,
    readDiagnosticsCache,
    writeDiagnosticsCache,
    getMonthlyCostByType,
    distributeCostPerResource
} from "../diagnosticsShared";
import { redis } from "@/lib/redis";

const MYSQL_TYPES = ["microsoft.dbformysql/flexibleservers", "microsoft.dbformysql/servers"];

// Métricas para MySQL Flexible/Single Server
const MYSQL_METRICS = [
    "cpu_percent",
    "memory_percent",
    "active_connections",
    "connections_failed",
    "storage_percent",
    "io_consumption_percent",
    "network_bytes_ingress",
    "network_bytes_egress"
];

interface MetricHistoryPoint {
    timestamp: string;
    cpu_percent: number;
    memory_percent: number;
    active_connections: number;
    connections_failed: number;
    storage_percent: number;
    io_consumption_percent: number;
    network_bytes_ingress: number;
    network_bytes_egress: number;
}

function generateMockMysqlHistory(seedOffset: number): MetricHistoryPoint[] {
    const points: MetricHistoryPoint[] = [];
    const now = new Date();
    
    for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hours = d.getHours();
        const mins = d.getMinutes();
        const timestamp = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        
        const dailyPattern = hours >= 9 && hours <= 18 ? 1.3 : 0.6;
        const sineWave = Math.sin((hours + seedOffset) * 0.25);
        const noise = 1 + (Math.sin(i * 1.5) * 0.08);
        
        const loadFactor = Math.max(0.1, dailyPattern * (1 + sineWave * 0.25) * noise);

        const cpu = parseFloat(Math.min(99.9, Math.max(1.5, 35 * loadFactor + (seedOffset % 4))).toFixed(1));
        const memory = parseFloat(Math.min(99.9, Math.max(10, 50 * loadFactor + 20 + (seedOffset % 10))).toFixed(1));
        const storage = parseFloat(Math.min(99.9, Math.max(5, 45 + (i * 0.05) + Math.sin(hours) * 0.1)).toFixed(1));
        const connections = Math.round(Math.max(2, 45 * loadFactor + (seedOffset % 10)));
        const failedConnections = Math.random() > 0.95 ? Math.round(Math.random() * 2) : 0;
        const io = parseFloat(Math.min(99.9, Math.max(0.5, 20 * loadFactor + (seedOffset % 5))).toFixed(1));
        
        const netIngress = Math.round(Math.max(1024 * 5, 8 * 1024 * 1024 * loadFactor));
        const netEgress = Math.round(Math.max(1024 * 20, 25 * 1024 * 1024 * loadFactor));

        points.push({
            timestamp,
            cpu_percent: cpu,
            memory_percent: memory,
            active_connections: connections,
            connections_failed: failedConnections,
            storage_percent: storage,
            io_consumption_percent: io,
            network_bytes_ingress: netIngress,
            network_bytes_egress: netEgress
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

        // Mock mode
        if (isMockTenant(tenantId) || tenantId.startsWith("mock-")) {
            return NextResponse.json({
                success: true,
                mock: true,
                instances: [
                    {
                        id: "mysql-mock-prod",
                        name: "mysql-prod-eastus",
                        region: "East US",
                        sku: "General Purpose (GP_Gen5_4)",
                        monthlyCostUsd: 420,
                        history: generateMockMysqlHistory(15)
                    },
                    {
                        id: "mysql-mock-dev",
                        name: "mysql-dev-eastus",
                        region: "East US",
                        sku: "Burstable (B_Gen5_1)",
                        monthlyCostUsd: 65,
                        history: generateMockMysqlHistory(88)
                    }
                ]
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
        const subscriptionIds = await getSubscriptionsForTenant(tenantId, credential);
        
        if (subscriptionIds.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existen suscripciones activas para este tenant.",
                instances: []
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
                instances: []
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        // Obtener costos mensuales acumulados
        const { costByType } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            MYSQL_TYPES
        );
        const costPerResource = distributeCostPerResource(resources, costByType);

        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        const headers = { Authorization: `Bearer ${tokenResponse.token}` };

        const instances = await Promise.all(
            resources.map(async (resource) => {
                const monthlyCostUsd = costPerResource.get(resource.id) || 0;
                try {
                    const metricNamesCsv = MYSQL_METRICS.join(",");
                    const metricsUrl = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=${metricNamesCsv}&timespan=PT24H&interval=PT1H&aggregation=Average`;
                    
                    const res = await fetch(metricsUrl, { headers });
                    if (!res.ok) {
                        throw new Error(`Azure Monitor API returned status ${res.status}`);
                    }
                    
                    const data = await res.json();
                    const metricsValue = data.value || [];

                    const sampleTimeseries = metricsValue.find((m: any) => m.timeseries?.[0]?.data?.length > 0);
                    const samplePoints = sampleTimeseries?.timeseries?.[0]?.data || [];
                    const length = samplePoints.length;

                    const history: MetricHistoryPoint[] = [];

                    for (let i = 0; i < length; i++) {
                        const pointDateStr = samplePoints[i].timeStamp;
                        const dateObj = new Date(pointDateStr);
                        const timestamp = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

                        const getMetricValue = (metricName: string): number => {
                            const valueObj = metricsValue.find(
                                (m: any) => m.name?.value?.toLowerCase() === metricName.toLowerCase()
                            );
                            const dataList = valueObj?.timeseries?.[0]?.data || [];
                            return dataList[i]?.average ?? 0;
                        };

                        history.push({
                            timestamp,
                            cpu_percent: getMetricValue("cpu_percent"),
                            memory_percent: getMetricValue("memory_percent"),
                            active_connections: Math.round(getMetricValue("active_connections")),
                            connections_failed: Math.round(getMetricValue("connections_failed")),
                            storage_percent: getMetricValue("storage_percent"),
                            io_consumption_percent: getMetricValue("io_consumption_percent"),
                            network_bytes_ingress: Math.round(getMetricValue("network_bytes_ingress")),
                            network_bytes_egress: Math.round(getMetricValue("network_bytes_egress"))
                        });
                    }

                    return {
                        id: resource.id,
                        name: resource.name,
                        region: resource.location || "unknown",
                        sku: resource.skuName || "Unknown",
                        monthlyCostUsd,
                        history
                    };

                } catch (err: any) {
                    console.error(`Error al consultar métricas MySQL para ${resource.name}:`, err.message);
                    return {
                        id: resource.id,
                        name: resource.name,
                        region: resource.location || "unknown",
                        sku: resource.skuName || "Unknown",
                        monthlyCostUsd,
                        history: []
                    };
                }
            })
        );

        const payload = {
            mock: false,
            resourceExists: true,
            instances
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
            errors: [{ code: "MYSQL_METRICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }]
        });
    }
}
