import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getResourceGraphClient } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

type Family = "managed-disks" | "backups" | "data-lake-gen2";

interface ServiceItem {
    serviceLabel: string;
    monthlyCost: number;
    resourceCount: number;
}

async function queryCostMeterSum(tenantId: string, whereClause: string): Promise<number> {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM CostMeterSnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND (${whereClause})`,
        [tenantId]
    );
    return Number(rows?.[0]?.total || 0);
}

async function queryCostSnapshotsSum(tenantId: string, whereClause: string): Promise<number> {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(SUM(COALESCE(BilledCost, cost_usd, 0)), 0) AS total
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND (${whereClause})`,
        [tenantId]
    );
    return Number(rows?.[0]?.total || 0);
}

async function queryCostCategorySum(tenantId: string, resourceTypes: string[]): Promise<number> {
    if (!resourceTypes.length) return 0;
    const placeholders = resourceTypes.map(() => "?").join(",");
    const [rows]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM CostCategorySnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND LOWER(resource_type) IN (${placeholders})`,
        [tenantId, ...resourceTypes.map((type) => type.toLowerCase())]
    );
    return Number(rows?.[0]?.total || 0);
}

async function queryHybridCost(tenantId: string, meterWhere: string, snapshotWhere: string): Promise<number> {
    const meterCost = await queryCostMeterSum(tenantId, meterWhere);
    if (meterCost > 0) return meterCost;
    return queryCostSnapshotsSum(tenantId, snapshotWhere);
}

async function queryArgCount(tenantId: string, query: string): Promise<number> {
    try {
        const arg = await getResourceGraphClient(tenantId);
        const res: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 1 } });
        return Number((res.data as any[])?.[0]?.resourceCount || 0);
    } catch {
        return 0;
    }
}

async function queryArgCountsByType(tenantId: string, query: string): Promise<Map<string, number>> {
    try {
        const arg = await getResourceGraphClient(tenantId);
        const res: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        const map = new Map<string, number>();
        for (const row of (res.data as any[]) || []) {
            map.set(String(row.resourceType || "").toLowerCase(), Number(row.resourceCount || 0));
        }
        return map;
    } catch {
        return new Map<string, number>();
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const family = searchParams.get("family") as Family | null;

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!family || !["managed-disks", "backups", "data-lake-gen2"].includes(family)) {
            return NextResponse.json({ error: "Parámetro family inválido" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        const data = await getWithStaleWhileRevalidate(
            `storage-service-cost:v3:${tenantId}:${family}`,
            async () => {
                if (isMockTenant(tenantId)) {
                    const mockMap: Record<Family, ServiceItem[]> = {
                        "managed-disks": [{ serviceLabel: "Managed Disk", monthlyCost: 412.4, resourceCount: 38 }],
                        backups: [
                            { serviceLabel: "Recovery Services Vault", monthlyCost: 84.2, resourceCount: 3 },
                            { serviceLabel: "Azure Backup", monthlyCost: 126.8, resourceCount: 2 },
                            { serviceLabel: "Azure Site Recovery", monthlyCost: 96.4, resourceCount: 1 },
                        ],
                        "data-lake-gen2": [{ serviceLabel: "Azure Data Lake Storage Gen2", monthlyCost: 678.35, resourceCount: 4 }],
                    };
                    const items = mockMap[family];
                    return {
                        success: true,
                        mock: true,
                        family,
                        items,
                        totalMonthlyCost: Number(items.reduce((sum, i) => sum + i.monthlyCost, 0).toFixed(2)),
                        dataAvailable: true,
                    };
                }

                let items: ServiceItem[] = [];

                if (family === "managed-disks") {
                    const resourceCount = await queryArgCount(
                        tenantId,
                        "Resources | where type =~ 'microsoft.compute/disks' | summarize resourceCount = count()"
                    );
                    const categoryCost = await queryCostCategorySum(tenantId, ["microsoft.compute/disks"]);
                    const monthlyCost = categoryCost > 0
                        ? categoryCost
                        : await queryHybridCost(
                            tenantId,
                            "(LOWER(COALESCE(MeterCategory,'')) IN ('disks','disk storage') OR LOWER(COALESCE(service_name,'')) LIKE '%disk%')",
                            "(LOWER(COALESCE(MeterCategory,'')) IN ('disks','disk storage') OR LOWER(COALESCE(service_name,'')) LIKE '%disk%')"
                        );
                    items = [{ serviceLabel: "Managed Disk", monthlyCost: Number(monthlyCost.toFixed(2)), resourceCount }];
                }

                if (family === "backups") {
                    const countsByType = await queryArgCountsByType(
                        tenantId,
                        `
                        Resources
                        | where type in~ (
                            'microsoft.recoveryservices/vaults',
                            'microsoft.dataprotection/backupvaults',
                            'microsoft.recoveryservices/vaults/replicationfabrics'
                          )
                        | summarize resourceCount = count() by resourceType = tolower(type)
                        `
                    );

                    const recoveryVaultCount = Number(countsByType.get("microsoft.recoveryservices/vaults") || 0);
                    const backupVaultCount = Number(countsByType.get("microsoft.dataprotection/backupvaults") || 0);
                    const siteRecoveryCount = Number(countsByType.get("microsoft.recoveryservices/vaults/replicationfabrics") || 0);

                    const recoveryVaultCategoryCost = await queryCostCategorySum(tenantId, ["microsoft.recoveryservices/vaults"]);
                    const backupVaultCategoryCost = await queryCostCategorySum(tenantId, ["microsoft.dataprotection/backupvaults"]);
                    const siteRecoveryCategoryCost = await queryCostCategorySum(tenantId, ["microsoft.recoveryservices/vaults/replicationfabrics"]);

                    const recoveryVaultCost = recoveryVaultCategoryCost > 0
                        ? recoveryVaultCategoryCost
                        : await queryHybridCost(
                            tenantId,
                            "LOWER(COALESCE(service_name,'')) LIKE '%recovery services%'",
                            "LOWER(COALESCE(service_name,'')) LIKE '%recovery services%'"
                        );
                    const backupCost = backupVaultCategoryCost > 0
                        ? backupVaultCategoryCost
                        : await queryHybridCost(
                            tenantId,
                            "LOWER(COALESCE(service_name,'')) LIKE '%backup%'",
                            "LOWER(COALESCE(service_name,'')) LIKE '%backup%'"
                        );
                    const siteRecoveryCost = siteRecoveryCategoryCost > 0
                        ? siteRecoveryCategoryCost
                        : await queryHybridCost(
                            tenantId,
                            "LOWER(COALESCE(service_name,'')) LIKE '%site recovery%'",
                            "LOWER(COALESCE(service_name,'')) LIKE '%site recovery%'"
                        );

                    items = [
                        {
                            serviceLabel: "Recovery Services Vault",
                            monthlyCost: Number(recoveryVaultCost.toFixed(2)),
                            resourceCount: recoveryVaultCount,
                        },
                        {
                            serviceLabel: "Azure Backup",
                            monthlyCost: Number(backupCost.toFixed(2)),
                            resourceCount: backupVaultCount,
                        },
                        {
                            serviceLabel: "Azure Site Recovery",
                            monthlyCost: Number(siteRecoveryCost.toFixed(2)),
                            resourceCount: siteRecoveryCount,
                        },
                    ];
                }

                if (family === "data-lake-gen2") {
                    const resourceCount = await queryArgCount(
                        tenantId,
                        `
                        Resources
                        | where type =~ 'microsoft.storage/storageaccounts'
                        | where tobool(properties.isHnsEnabled) == true
                        | summarize resourceCount = count()
                        `
                    );
                    const monthlyCost = await queryHybridCost(
                        tenantId,
                        "(LOWER(COALESCE(MeterName,'')) LIKE '%data lake%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%data lake%' OR LOWER(COALESCE(service_name,'')) LIKE '%data lake%')",
                        "(LOWER(COALESCE(MeterName,'')) LIKE '%data lake%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%data lake%' OR LOWER(COALESCE(service_name,'')) LIKE '%data lake%')"
                    );
                    items = [{
                        serviceLabel: "Azure Data Lake Storage Gen2",
                        monthlyCost: Number(monthlyCost.toFixed(2)),
                        resourceCount,
                    }];
                }

                return {
                    success: true,
                    mock: false,
                    family,
                    items,
                    totalMonthlyCost: Number(items.reduce((sum, i) => sum + i.monthlyCost, 0).toFixed(2)),
                    dataAvailable: true,
                };
            },
            1800,
            600
        );

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[storage/service-cost] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
