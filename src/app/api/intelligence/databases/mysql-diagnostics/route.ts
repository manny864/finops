/**
 * GET /api/intelligence/databases/mysql-diagnostics
 * Azure Database for MySQL Flexible Server Diagnostics.
 * Metrics: CPU%, memory, storage, IOPS, connections, slow queries, InnoDB buffer pool, replication lag.
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
    listResourcesByTypes,
    readDiagnosticsCache,
    writeDiagnosticsCache,
} from "../diagnosticsShared";
import { redis } from "@/lib/redis";

const MYSQL_TYPES = [
    "microsoft.dbformysql/flexibleservers",
    "microsoft.dbformysql/servers",
];

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
            return NextResponse.json(getMockMysqlData());
        }

        const cacheKey = getDiagnosticsCacheKey("mysql", tenantId);
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
                servers: [],
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
                servers: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            MYSQL_TYPES,
        );
        const costPerResource = distributeCostPerResource(resources, costByType);

        const servers = resources.map((resource) => ({
            id: resource.id,
            name: resource.name,
            region: resource.location || "unknown",
            version: null,
            tier: resource.skuName || "Unknown",
            computeTier: null,
            vCores: null,
            maxMemoryMB: null,
            maxStorageGB: null,
            usedStorageGB: null,
            storageAutoGrowEnabled: null,
            haEnabled: null,
            haMode: null,
            cpuPercent: null,
            memoryPercent: null,
            storagePercent: null,
            ioPercent: null,
            queriesPerSecond: null,
            activeConnections: null,
            maxConnections: null,
            connectionsFailed: null,
            readReplicas: null,
            innodbBufferPoolHitRate: null,
            innodbDirtyPages: null,
            slowQueryLogCount: null,
            backupRetentionDays: null,
            backupRedundancy: null,
            tlsVersion: null,
            privateEndpointEnabled: null,
            parameters: null,
            slowestQueries: null,
            telemetry: {
                available: false,
                source: "not_collected",
                message: "Las métricas operativas requieren una consulta a Azure Monitor.",
            },
            monthlyCostUsd: costPerResource.get(resource.id) || 0,
        }));

        const payload = {
            mock: false,
            resourceExists: true,
            dataAvailable,
            servers,
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
            message: "No se pudieron consultar servidores MySQL en este momento.",
            servers: [],
            errors: [{ code: "MYSQL_DIAGNOSTICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
        });
    }
}

function getMockMysqlData() {
    return {
        mock: true,
        servers: [
            {
                id: "mysql-srv-001",
                name: "mysql-prod-eastus",
                region: "East US",
                version: "8.0.23",
                tier: "General Purpose",
                computeTier: "Burstable",
                vCores: 4,
                maxMemoryMB: 16384,
                maxStorageGB: 64,
                usedStorageGB: 38.7,
                storageAutoGrowEnabled: true,
                haEnabled: true,
                haMode: "Zone Redundant",
                cpuPercent: 48,
                memoryPercent: 71,
                storagePercent: 60.5,
                ioPercent: 55,
                queriesPerSecond: 1842,
                activeConnections: 42,
                maxConnections: 150,
                connectionsFailed: 7,
                readReplicas: [
                    {
                        id: "mysql-replica-01",
                        region: "West US",
                        replicationLagSeconds: 2.3,
                    },
                ],
                innodbBufferPoolHitRate: 0.98,
                innodbDirtyPages: 124,
                slowQueryLogCount: 18,
                backupRetentionDays: 35,
                backupRedundancy: "GRS",
                tlsVersion: "1.2+",
                privateEndpointEnabled: true,
                parameters: {
                    innodb_buffer_pool_size: "12GB",
                    max_connections: "150",
                    slow_query_log: "ON",
                    long_query_time: "1",
                    log_error_verbosity: "2",
                },
                slowestQueries: [
                    {
                        query: "SELECT * FROM users u JOIN orders o ON u.id = o.user_id",
                        avgDurationMs: 1250,
                        executionCount: 342,
                        lockWaitMs: 45,
                    },
                ],
                monthlyCostUsd: 420,
            },
        ],
    };
}
