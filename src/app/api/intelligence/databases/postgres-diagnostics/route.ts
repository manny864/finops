/**
 * GET /api/intelligence/databases/postgres-diagnostics
 * Azure Database for PostgreSQL Flexible Server Diagnostics.
 * Metrics: CPU%, memory, storage, IOPS, connections, replication lag, WAL, query performance.
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

const POSTGRES_TYPES = [
    "microsoft.dbforpostgresql/flexibleservers",
    "microsoft.dbforpostgresql/servers",
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
            return NextResponse.json(getMockPostgresData());
        }

        const cacheKey = getDiagnosticsCacheKey("postgres", tenantId);
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

        const resources = await listResourcesByTypes(tenantId, POSTGRES_TYPES, subscriptionIds, credential);
        if (resources.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existe Azure Database for PostgreSQL en este tenant.",
                servers: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            POSTGRES_TYPES,
        );
        // Costo exacto por ResourceId; el reparto por tipo queda de respaldo
        // para los recursos que aún no tienen facturación propia.
        const exactCostById = await getMtdCostByResourceId(tenantId, credential, resources);
        const costPerResource = distributeCostPerResource(resources, costByType, exactCostById);

        const servers = resources.map((resource) => ({
            id: resource.id,
            name: resource.name,
            region: resource.location || "unknown",
            version: "Unknown",
            tier: resource.skuName || "Unknown",
            computeTier: "Unknown",
            vCores: 0,
            maxMemoryMB: 0,
            maxStorageGB: 0,
            usedStorageGB: 0,
            storageAutoGrowEnabled: false,
            haEnabled: false,
            haMode: "Unknown",
            cpuPercent: 0,
            memoryPercent: 0,
            storagePercent: 0,
            ioPercent: 0,
            activeConnections: 0,
            maxConnections: 0,
            connectionsFailed: 0,
            walStorageGB: 0,
            replicationLagSeconds: 0,
            readReplicas: [],
            backupRetentionDays: 0,
            backupRedundancy: "Unknown",
            tlsVersion: "Unknown",
            privateEndpointEnabled: false,
            parameters: {},
            topQueriesByDuration: [],
            cacheHitRatio: 0,
            deadTuplesCount: 0,
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
            message: "No se pudieron consultar servidores PostgreSQL en este momento.",
            servers: [],
            errors: [{ code: "POSTGRES_DIAGNOSTICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
        });
    }
}

function getMockPostgresData() {
    return {
        mock: true,
        servers: [
            {
                id: "postgres-srv-001",
                name: "postgres-prod-eastus",
                region: "East US",
                version: "13.7",
                tier: "General Purpose",
                computeTier: "Burstable",
                vCores: 2,
                maxMemoryMB: 8192,
                maxStorageGB: 32,
                usedStorageGB: 18.4,
                storageAutoGrowEnabled: true,
                haEnabled: true,
                haMode: "Zone Redundant",
                cpuPercent: 35,
                memoryPercent: 62,
                storagePercent: 57.5,
                ioPercent: 42,
                activeConnections: 24,
                maxConnections: 100,
                connectionsFailed: 3,
                walStorageGB: 4.2,
                replicationLagSeconds: 0.8,
                readReplicas: [
                    {
                        id: "postgres-replica-01",
                        region: "West US",
                        replicationLagSeconds: 1.2,
                    },
                ],
                backupRetentionDays: 35,
                backupRedundancy: "GRS",
                tlsVersion: "1.2+",
                privateEndpointEnabled: true,
                parameters: {
                    shared_buffers: "1MB",
                    effective_cache_size: "4000MB",
                    work_mem: "4MB",
                    autovacuum: "on",
                    log_statement: "all",
                },
                topQueriesByDuration: [
                    {
                        query: "SELECT * FROM orders WHERE status = $1",
                        avgDurationMs: 245,
                        executionCount: 12450,
                        totalTimeMs: 3045450,
                    },
                ],
                cacheHitRatio: 0.96,
                deadTuplesCount: 2847,
                monthlyCostUsd: 280,
            },
        ],
    };
}
