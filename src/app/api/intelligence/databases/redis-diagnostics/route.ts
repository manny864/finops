/**
 * GET /api/intelligence/databases/redis-diagnostics
 * Azure Cache for Redis Diagnostics.
 * Metrics: Memory usage, evictions, cache hits/misses, CPU, throughput, connections, persistence.
 * RBAC: requireTenantAccess
 */

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
    distributeCostPerResource,
    getDiagnosticsCacheKey,
    getMonthlyCostByType,
    getMtdCostByResourceId,
    listResourcesByTypes,
    readDiagnosticsCache,
    writeDiagnosticsCache,
} from "../diagnosticsShared";
import { redis } from "@/lib/redis";
import { estimateRedisMonthlyCost } from "../redis-metrics/route";

const REDIS_TYPES = ["microsoft.cache/redis", "microsoft.cache/redisenterprise"];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json(
                { error: "tenantId parameter is required" },
                { status: 400 },
            );
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockRedisData());
        }

        const cacheKey = getDiagnosticsCacheKey("redis", tenantId);
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
                instances: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const resources = await listResourcesByTypes(tenantId, REDIS_TYPES, subscriptionIds, credential);
        if (resources.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existe Azure Cache for Redis en este tenant.",
                instances: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            REDIS_TYPES,
        );
        // Costo exacto por ResourceId; el reparto por tipo queda de respaldo
        // para los recursos que aún no tienen facturación propia.
        const exactCostById = await getMtdCostByResourceId(tenantId, credential, resources);
        const costPerResource = distributeCostPerResource(resources, costByType, exactCostById);

        const instances = resources.map((resource) => ({
            id: resource.id,
            name: resource.name,
            region: resource.location || "unknown",
            sku: resource.skuName || "Unknown",
            size: resource.skuName || "Unknown",
            maxMemoryMB: null,
            usedMemoryMB: null,
            usedMemoryRssPercent: null,
            memoryFragmentationRatio: null,
            evictedKeys: null,
            expiredKeys: null,
            cacheHitRate: null,
            cacheHits: null,
            cacheMisses: null,
            cpuPercent: null,
            connectedClients: null,
            rejectedConnections: null,
            totalCommandsProcessed: null,
            operationsPerSecond: null,
            networkReadMBps: null,
            networkWriteMBps: null,
            clustering: null,
            persistence: null,
            replication: null,
            modules: null,
            security: null,
            slowQueries: null,
            telemetry: {
                available: false,
                source: "not_collected",
                message: "Las métricas operativas requieren una consulta a Azure Monitor.",
            },
            monthlyCostUsd:
                costPerResource.get(resource.id) ||
                estimateRedisMonthlyCost(
                    String(resource.skuName || "Standard_C1"),
                    String((resource.properties as any)?.sku?.family || "C"),
                    Number((resource.properties as any)?.sku?.capacity || 1),
                    String(resource.type).toLowerCase().includes("enterprise")
                ),
        }));

        const payload = {
            mock: false,
            resourceExists: true,
            dataAvailable,
            instances,
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
            dataAvailable: false,
            message: "No se pudieron consultar instancias Azure Cache for Redis en este momento.",
            instances: [],
            errors: [{ code: "REDIS_DIAGNOSTICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
        });
    }
}

function getMockRedisData() {
    return {
        mock: true,
        instances: [
            {
                id: "redis-prod-001",
                name: "redis-prod-eastus",
                region: "East US",
                sku: "Premium",
                size: "P1",
                maxMemoryMB: 6144,
                usedMemoryMB: 4251,
                usedMemoryRssPercent: 68,
                memoryFragmentationRatio: 1.15,
                evictedKeys: 245,
                expiredKeys: 1842,
                cacheHitRate: 0.94,
                cacheHits: 1245823,
                cacheMisses: 74177,
                cpuPercent: 28,
                connectedClients: 128,
                rejectedConnections: 0,
                totalCommandsProcessed: 15428456,
                operationsPerSecond: 8425,
                networkReadMBps: 12.3,
                networkWriteMBps: 8.7,
                clustering: {
                    enabled: false,
                    shards: 0,
                },
                persistence: {
                    rdbSnapshotEnabled: true,
                    rdbSnapshotIntervalSeconds: 3600,
                    aofEnabled: false,
                    lastBackupStatus: "Success",
                },
                replication: {
                    geoReplicationLinked: true,
                    primaryRegion: "East US",
                    secondaryRegion: "West US",
                    replicationStatus: "Syncing",
                },
                modules: [
                    {
                        name: "RediSearch",
                        version: "2.6.0",
                    },
                    {
                        name: "RedisJSON",
                        version: "2.4.0",
                    },
                ],
                security: {
                    tlsVersion: "1.2+",
                    minTlsVersion: "1.2",
                    nonSslPortEnabled: false,
                    aadAuthEnabled: true,
                },
                slowQueries: [
                    {
                        command: "KEYS *",
                        durationMs: 1250,
                        executionCount: 3,
                    },
                ],
                monthlyCostUsd: 1450,
            },
            {
                id: "redis-cache-dev",
                name: "redis-dev-eastus",
                region: "East US",
                sku: "Standard",
                size: "C2",
                maxMemoryMB: 2560,
                usedMemoryMB: 1842,
                usedMemoryRssPercent: 75,
                memoryFragmentationRatio: 1.22,
                evictedKeys: 84,
                expiredKeys: 542,
                cacheHitRate: 0.89,
                cacheHits: 425168,
                cacheMisses: 52384,
                cpuPercent: 15,
                connectedClients: 32,
                rejectedConnections: 0,
                totalCommandsProcessed: 3245612,
                operationsPerSecond: 2148,
                networkReadMBps: 3.2,
                networkWriteMBps: 2.1,
                clustering: {
                    enabled: false,
                    shards: 0,
                },
                persistence: {
                    rdbSnapshotEnabled: true,
                    rdbSnapshotIntervalSeconds: 7200,
                    aofEnabled: false,
                    lastBackupStatus: "Success",
                },
                replication: {
                    geoReplicationLinked: false,
                },
                modules: [],
                security: {
                    tlsVersion: "1.2+",
                    minTlsVersion: "1.2",
                    nonSslPortEnabled: false,
                    aadAuthEnabled: false,
                },
                monthlyCostUsd: 280,
            },
        ],
    };
}
