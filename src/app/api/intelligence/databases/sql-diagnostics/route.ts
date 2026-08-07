/**
 * GET /api/intelligence/databases/sql-diagnostics
 * Azure SQL Database & SQL Managed Instance Diagnostics.
 * Metrics: CPU usage, DTU/vCore consumption, storage, memory, I/O, failover groups, TDE, AHB.
 * RBAC: requireTenantAccess
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    // Auth check
    if (!tenantId) {
        return NextResponse.json(
            { error: "tenantId parameter is required" },
            { status: 400 }
        );
    }

    await requireTenantAccess(request, tenantId);

    if (isMockTenant(tenantId)) {
        return NextResponse.json(getMockSqlData());
    }

    try {
        // TODO: Implement real Azure SQL diagnostics via:
        // 1. ARM API: listDatabases, listServers, elasticPools
        // 2. Azure Monitor Metrics: CPU%, DTU/vCore%, storage, memory
        // 3. Data plane (DMVs): sys.dm_db_resource_stats, Query Store
        return NextResponse.json({
            error: "Azure SQL diagnostics not yet implemented",
            tenantId,
        }, { status: 501 });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 }
        );
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
