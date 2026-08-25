/**
 * GET /api/intelligence/databases/sql-diagnostics
 * Azure SQL Database & SQL Managed Instance Diagnostics.
 * Metrics: CPU usage, DTU/vCore consumption, storage, memory, I/O, failover groups, TDE, AHB.
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
import { estimateAzureSqlMonthlyCost } from "../sql-metrics/route";

const SQL_TYPES = [
    "microsoft.sql/servers",
    "microsoft.sql/servers/databases",
    "microsoft.sql/servers/elasticpools",
    "microsoft.sql/managedinstances",
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
            return NextResponse.json(getMockSqlData());
        }

        const cacheKey = getDiagnosticsCacheKey("sql", tenantId);
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
                managedInstances: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const resources = await listResourcesByTypes(tenantId, SQL_TYPES, subscriptionIds, credential);
        if (resources.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existe Azure SQL Database ni Azure SQL Managed Instance en este tenant.",
                servers: [],
                managedInstances: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            SQL_TYPES,
        );
        const costPerResource = distributeCostPerResource(resources, costByType);

        const dbByServer = new Map<string, any[]>();
        const serverRegionByName = new Map<string, string>();
        const managedInstances: any[] = [];

        for (const resource of resources) {
            if (resource.type === "microsoft.sql/servers") {
                serverRegionByName.set(resource.name, resource.location || "unknown");
                if (!dbByServer.has(resource.name)) {
                    dbByServer.set(resource.name, []);
                }
                continue;
            }

            if (resource.type === "microsoft.sql/servers/databases") {
                const match = resource.id.match(
                    /\/providers\/microsoft\.sql\/servers\/([^/]+)\/databases\/([^/]+)/i,
                );
                const serverName = match?.[1] || "unknown-server";
                const dbName = match?.[2] || resource.name || "unknown-db";
                const list = dbByServer.get(serverName) || [];
                list.push({
                    id: resource.id,
                    name: dbName,
                    location: resource.location || "unknown",
                    edition: "Unknown",
                    serviceObjective: "Unknown",
                    vCores: 0,
                    maxStorageGB: 0,
                    usedStorageGB: 0,
                    cpuPercent: 0,
                    memoryPercent: 0,
                    ioPercent: 0,
                    logWritePercent: 0,
                    dtuUsagePercent: 0,
                    elasticPoolName: null,
                    ahbEnabled: false,
                    tdeEnabled: false,
                    tdeKeyType: "Unknown",
                });
                dbByServer.set(serverName, list);
                continue;
            }

            if (resource.type === "microsoft.sql/managedinstances") {
                managedInstances.push({
                    id: resource.id,
                    name: resource.name,
                    region: resource.location || "unknown",
                    tier: resource.skuName || "Unknown",
                    hardwareGen: "Unknown",
                    vCores: 0,
                    maxStorageGB: 0,
                    usedStorageGB: 0,
                    cpuPercent: 0,
                    memoryPercent: 0,
                    ioLatencyMs: 0,
                    maxIops: 0,
                    usedIops: 0,
                    ahbEnabled: false,
                    tdeEnabled: false,
                    databases: 0,
                    monthlyCostUsd:
                        costPerResource.get(resource.id) ||
                        estimateAzureSqlMonthlyCost(
                            false,
                            "managed-instance",
                            String(resource.skuName || "GP_Gen5_4"),
                            "vcore-provisioned",
                            32,
                            "LicenseIncluded"
                        ),
                });
            }
        }

        const servers = Array.from(dbByServer.entries()).map(([name, databases]) => ({
            id: name,
            name,
            type: "SQL Database Server",
            region: serverRegionByName.get(name) || databases[0]?.location || "unknown",
            databases,
            elasticPools: [],
            failoverGroups: [],
            monthlyCostUsd: Number(
                databases
                    .reduce(
                        (sum, db) =>
                            sum +
                            (costPerResource.get(db.id) ||
                                estimateAzureSqlMonthlyCost(
                                    db.name.toLowerCase() === "master",
                                    "single-database",
                                    "Standard S2",
                                    "dtu",
                                    32,
                                    "LicenseIncluded"
                                )),
                        0
                    )
                    .toFixed(2),
            ),
        }));

        const payload = {
            mock: false,
            resourceExists: true,
            dataAvailable,
            servers,
            managedInstances,
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
            message: "No se pudieron consultar recursos Azure SQL en este momento.",
            servers: [],
            managedInstances: [],
            errors: [{ code: "SQL_DIAGNOSTICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
        });
    }
}

function getMockSqlData() {
    return {
        mock: true,
        servers: [
            {
                id: "sql-srv-prod-01",
                name: "sql-prod-eastus",
                type: "SQL Database Server",
                region: "East US",
                databases: [
                    {
                        id: "db-app-prod",
                        name: "AppDatabase",
                        edition: "Premium",
                        serviceObjective: "P2",
                        vCores: 4,
                        maxStorageGB: 500,
                        usedStorageGB: 185.3,
                        cpuPercent: 42,
                        memoryPercent: 68,
                        ioPercent: 35,
                        logWritePercent: 28,
                        dtuUsagePercent: 45,
                        elasticPoolName: null,
                        ahbEnabled: true,
                        tdeEnabled: true,
                        tdeKeyType: "Service-managed",
                    },
                    {
                        id: "db-analytics",
                        name: "AnalyticsDB",
                        edition: "Premium",
                        serviceObjective: "P4",
                        vCores: 8,
                        maxStorageGB: 1000,
                        usedStorageGB: 542.7,
                        cpuPercent: 28,
                        memoryPercent: 52,
                        ioPercent: 62,
                        logWritePercent: 15,
                        dtuUsagePercent: 35,
                        elasticPoolName: null,
                        ahbEnabled: true,
                        tdeEnabled: true,
                        tdeKeyType: "Customer-managed (Key Vault)",
                    },
                ],
                elasticPools: [
                    {
                        id: "ep-dev-pool",
                        name: "DevelopmentPool",
                        edition: "Standard",
                        dtuCapacity: 100,
                        dtuUsed: 65,
                        storageGB: 102.1,
                        maxStorageGB: 400,
                        minDtuPerDb: 10,
                        maxDtuPerDb: 50,
                        databaseCount: 8,
                    },
                ],
                failoverGroups: [
                    {
                        id: "fg-primary",
                        name: "ProductionFailover",
                        primaryServer: "sql-prod-eastus",
                        secondaryServer: "sql-prod-westus",
                        readOnlyEndpoint: "prod-ro.database.windows.net",
                    },
                ],
                monthlyCostUsd: 3500,
            },
        ],
        managedInstances: [
            {
                id: "mi-prod-001",
                name: "sqlmi-prod-eastus",
                region: "East US",
                tier: "Premium",
                hardwareGen: "Gen5",
                vCores: 16,
                maxStorageGB: 8192,
                usedStorageGB: 2104.5,
                cpuPercent: 38,
                memoryPercent: 71,
                ioLatencyMs: 4.2,
                maxIops: 4000,
                usedIops: 2842,
                ahbEnabled: true,
                tdeEnabled: true,
                databases: 12,
                monthlyCostUsd: 5200,
            },
        ],
    };
}
