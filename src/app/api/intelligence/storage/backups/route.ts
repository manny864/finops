import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getSubscriptionsForTenant } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";
import {
    fetchAllBackupVaultsFromARG,
    fetchAllProtectedItemsFromARG,
    fetchAllAsrItemsFromARG,
    detectVaultEnvironment,
    normalizeRedundancy,
    estimateMonthlyVaultCost,
    buildBackupRemediations,
    computeBackupsKpis,
    aggregateStorageBreakdown,
} from "@/services/azureBackups.service";
import {
    BackupVaultDetail,
    BackupsResponse,
    ProtectedItemDetail,
    VaultType,
    WorkloadType,
    BackupTier,
    ProtectionState,
} from "@/types/backup.types";

function getMockBackupsPayload(multiplier: number = 1): BackupsResponse {
    const mockVaults: BackupVaultDetail[] = [
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.RecoveryServices/vaults/rsv-finops-prod-core",
            name: "rsv-finops-prod-core",
            resourceGroup: "rg-finops-prod",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            vaultType: "RecoveryServicesVault",
            skuName: "Standard",
            redundancy: "GeoRedundant",
            crossRegionRestoreEnabled: true,
            softDeleteEnabled: true,
            softDeleteRetentionDays: 14,
            immutabilityState: "Unlocked",
            storageBreakdown: {
                totalStorageGB: 4280,
                snapshotTierGB: 480,
                vaultStandardGB: 3200,
                vaultArchiveGB: 600,
                orphanedStorageGB: 0,
            },
            protectedItemsCount: 14,
            orphanedItemsCount: 0,
            asrProtectedItemsCount: 2,
            monthlyCostUsd: parseFloat((286.40 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((286.40 * multiplier).toFixed(2)),
            costPerGb: 0.067,
            environmentTag: "prod",
            tags: { env: "prod", role: "business-continuity" },
            protectedItems: [
                {
                    id: "item-prod-sql-01",
                    name: "vm-sql-prod-01",
                    vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.RecoveryServices/vaults/rsv-finops-prod-core",
                    vaultName: "rsv-finops-prod-core",
                    workloadType: "AzureIaasVM",
                    sourceResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Compute/virtualMachines/vm-sql-prod-01",
                    sourceResourceName: "vm-sql-prod-01",
                    isSourceResourceDeleted: false,
                    protectionState: "Protected",
                    policyName: "ProdDailyBackupPolicy",
                    retentionDays: 30,
                    backupTier: "VaultStandard",
                    storageConsumedGB: 1250,
                    monthlyCostUsd: 66.25,
                    lastBackupStatus: "Healthy",
                    lastBackupTime: new Date().toISOString(),
                    isOrphanCandidate: false,
                },
                {
                    id: "item-prod-app-01",
                    name: "vm-app-prod-01",
                    vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.RecoveryServices/vaults/rsv-finops-prod-core",
                    vaultName: "rsv-finops-prod-core",
                    workloadType: "AzureIaasVM",
                    sourceResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Compute/virtualMachines/vm-app-prod-01",
                    sourceResourceName: "vm-app-prod-01",
                    isSourceResourceDeleted: false,
                    protectionState: "Protected",
                    policyName: "ProdDailyBackupPolicy",
                    retentionDays: 30,
                    backupTier: "VaultStandard",
                    storageConsumedGB: 680,
                    monthlyCostUsd: 40.60,
                    lastBackupStatus: "Healthy",
                    lastBackupTime: new Date().toISOString(),
                    isOrphanCandidate: false,
                },
                {
                    id: "item-prod-fileshare-01",
                    name: "afs-finops-documents",
                    vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.RecoveryServices/vaults/rsv-finops-prod-core",
                    vaultName: "rsv-finops-prod-core",
                    workloadType: "AzureFileShare",
                    sourceResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Storage/storageAccounts/stfinopsdocs/fileServices/default/shares/documents",
                    sourceResourceName: "stfinopsdocs",
                    isSourceResourceDeleted: false,
                    protectionState: "Protected",
                    policyName: "FilesDailyRetention",
                    retentionDays: 60,
                    backupTier: "Snapshot",
                    storageConsumedGB: 340,
                    monthlyCostUsd: 17.00,
                    lastBackupStatus: "Healthy",
                    lastBackupTime: new Date().toISOString(),
                    isOrphanCandidate: false,
                },
            ],
            recommendations: [],
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-sandbox/providers/Microsoft.RecoveryServices/vaults/rsv-dev-sandbox-01",
            name: "rsv-dev-sandbox-01",
            resourceGroup: "rg-dev-sandbox",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            vaultType: "RecoveryServicesVault",
            skuName: "Standard",
            redundancy: "GeoRedundant",
            crossRegionRestoreEnabled: false,
            softDeleteEnabled: true,
            softDeleteRetentionDays: 14,
            immutabilityState: "Disabled",
            storageBreakdown: {
                totalStorageGB: 1150,
                snapshotTierGB: 120,
                vaultStandardGB: 480,
                vaultArchiveGB: 0,
                orphanedStorageGB: 550,
            },
            protectedItemsCount: 4,
            orphanedItemsCount: 2,
            asrProtectedItemsCount: 1,
            monthlyCostUsd: parseFloat((88.50 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((88.50 * multiplier).toFixed(2)),
            costPerGb: 0.077,
            environmentTag: "dev",
            tags: { env: "dev", team: "core-dev" },
            protectedItems: [
                {
                    id: "item-dev-legacy-vm-orphan-1",
                    name: "vm-dev-microservice-old",
                    vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-sandbox/providers/Microsoft.RecoveryServices/vaults/rsv-dev-sandbox-01",
                    vaultName: "rsv-dev-sandbox-01",
                    workloadType: "AzureIaasVM",
                    sourceResourceId: null,
                    sourceResourceName: "vm-dev-microservice-old",
                    isSourceResourceDeleted: true,
                    protectionState: "ProtectionStopped",
                    policyName: "DevWeeklyPolicy",
                    retentionDays: 14,
                    backupTier: "VaultStandard",
                    storageConsumedGB: 320,
                    monthlyCostUsd: 14.40,
                    lastBackupStatus: "Warning",
                    lastBackupTime: new Date(Date.now() - 45 * 86400000).toISOString(),
                    isOrphanCandidate: true,
                },
                {
                    id: "item-dev-legacy-vm-orphan-2",
                    name: "vm-dev-qa-tester-scratch",
                    vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-sandbox/providers/Microsoft.RecoveryServices/vaults/rsv-dev-sandbox-01",
                    vaultName: "rsv-dev-sandbox-01",
                    workloadType: "AzureIaasVM",
                    sourceResourceId: null,
                    sourceResourceName: "vm-dev-qa-tester-scratch",
                    isSourceResourceDeleted: true,
                    protectionState: "ProtectionStopped",
                    policyName: "DevWeeklyPolicy",
                    retentionDays: 14,
                    backupTier: "VaultStandard",
                    storageConsumedGB: 230,
                    monthlyCostUsd: 10.35,
                    lastBackupStatus: "Warning",
                    lastBackupTime: new Date(Date.now() - 60 * 86400000).toISOString(),
                    isOrphanCandidate: true,
                },
                {
                    id: "item-dev-active-api",
                    name: "vm-dev-backend-01",
                    vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-sandbox/providers/Microsoft.RecoveryServices/vaults/rsv-dev-sandbox-01",
                    vaultName: "rsv-dev-sandbox-01",
                    workloadType: "AzureIaasVM",
                    sourceResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-sandbox/providers/Microsoft.Compute/virtualMachines/vm-dev-backend-01",
                    sourceResourceName: "vm-dev-backend-01",
                    isSourceResourceDeleted: false,
                    protectionState: "Protected",
                    policyName: "DevWeeklyPolicy",
                    retentionDays: 7,
                    backupTier: "VaultStandard",
                    storageConsumedGB: 280,
                    monthlyCostUsd: 22.60,
                    lastBackupStatus: "Healthy",
                    lastBackupTime: new Date().toISOString(),
                    isOrphanCandidate: false,
                },
            ],
            recommendations: [],
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-database-tier/providers/Microsoft.DataProtection/backupVaults/bv-database-backups-eastus",
            name: "bv-database-backups-eastus",
            resourceGroup: "rg-database-tier",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "eastus",
            vaultType: "BackupVault",
            skuName: "Standard",
            redundancy: "LocallyRedundant",
            crossRegionRestoreEnabled: false,
            softDeleteEnabled: true,
            softDeleteRetentionDays: 14,
            immutabilityState: "Disabled",
            storageBreakdown: {
                totalStorageGB: 2800,
                snapshotTierGB: 200,
                vaultStandardGB: 2400,
                vaultArchiveGB: 200,
                orphanedStorageGB: 0,
            },
            protectedItemsCount: 6,
            orphanedItemsCount: 0,
            asrProtectedItemsCount: 0,
            monthlyCostUsd: parseFloat((95.30 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((95.30 * multiplier).toFixed(2)),
            costPerGb: 0.034,
            environmentTag: "prod",
            tags: { env: "prod", workload: "cloud-databases" },
            protectedItems: [
                {
                    id: "item-mysql-prod-backup",
                    name: "mysql-finops-prod-db",
                    vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-database-tier/providers/Microsoft.DataProtection/backupVaults/bv-database-backups-eastus",
                    vaultName: "bv-database-backups-eastus",
                    workloadType: "SQLDataBase",
                    sourceResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-database-tier/providers/Microsoft.DBforMySQL/flexibleServers/mysql-finops-prod-db",
                    sourceResourceName: "mysql-finops-prod-db",
                    isSourceResourceDeleted: false,
                    protectionState: "Protected",
                    policyName: "DbLongTermPolicy",
                    retentionDays: 180,
                    backupTier: "VaultStandard",
                    storageConsumedGB: 1800,
                    monthlyCostUsd: 50.50,
                    lastBackupStatus: "Healthy",
                    lastBackupTime: new Date().toISOString(),
                    isOrphanCandidate: false,
                },
            ],
            recommendations: [],
        },
    ];

    const remediations = buildBackupRemediations(mockVaults);
    const vaultsWithRecs = mockVaults.map((v) => ({
        ...v,
        recommendations: remediations.filter((r) => r.vaultId === v.id),
    }));

    const kpis = computeBackupsKpis(vaultsWithRecs, remediations);
    const storageBreakdown = aggregateStorageBreakdown(vaultsWithRecs);
    const allProtectedItems = vaultsWithRecs.flatMap((v) => v.protectedItems);

    return {
        success: true,
        mock: true,
        kpis,
        vaults: vaultsWithRecs,
        allProtectedItems,
        storageBreakdown,
        remediations,
    };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        const isMockParam = searchParams.get("mock") === "true";
        if (isMockTenant(tenantId) || tenantId.startsWith("mock-") || isMockParam) {
            return NextResponse.json(getMockBackupsPayload(1));
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        // Live Tenant Real Data Path
        const cacheKey = `azure-backups:v2:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(
            cacheKey,
            async () => {
                const subs = await getSubscriptionsForTenant(tenantId);
                if (!subs || subs.length === 0) {
                    const emptyKpis = computeBackupsKpis([], []);
                    const emptyStorage = aggregateStorageBreakdown([]);
                    return {
                        success: true,
                        mock: false,
                        kpis: emptyKpis,
                        vaults: [],
                        allProtectedItems: [],
                        storageBreakdown: emptyStorage,
                        remediations: [],
                    };
                }

                // 1. Fetch Vaults from ARG
                const rawVaults = await fetchAllBackupVaultsFromARG(tenantId, subs);
                if (!rawVaults || rawVaults.length === 0) {
                    const emptyKpis = computeBackupsKpis([], []);
                    const emptyStorage = aggregateStorageBreakdown([]);
                    return {
                        success: true,
                        mock: false,
                        kpis: emptyKpis,
                        vaults: [],
                        allProtectedItems: [],
                        storageBreakdown: emptyStorage,
                        remediations: [],
                    };
                }

                // 2. Fetch Protected Items and ASR Items from ARG
                const rawProtectedItems = await fetchAllProtectedItemsFromARG(tenantId, subs);
                const rawAsrItems = await fetchAllAsrItemsFromARG(tenantId, subs);

                // Group protected items and ASR counts by Vault
                const protectedItemsByVault = new Map<string, ProtectedItemDetail[]>();
                const asrCountByVault = new Map<string, number>();

                for (const rawItem of rawProtectedItems || []) {
                    const fullId = String(rawItem.id || "");
                    const name = String(rawItem.name || "");
                    const props = rawItem.properties || {};

                    // Extract vault name from resource ID
                    const vaultMatch = fullId.match(/\/(?:vaults|backupVaults)\/([^/]+)/i);
                    const vaultKey = vaultMatch ? vaultMatch[1].toLowerCase() : "";

                    const workloadType = (props.workloadType || props.backupManagementType || "AzureIaasVM") as WorkloadType;
                    const sourceResourceId = props.sourceResourceId || props.dataSourceInfo?.resourceID || null;
                    const sourceResourceName = sourceResourceId ? sourceResourceId.split("/").pop() || name : name;
                    const protectionState = (props.protectionState || props.currentProtectionState || "Protected") as ProtectionState;
                    const policyName = props.policyName || props.policyInfo?.name || "DefaultPolicy";
                    const retentionDays = Number(props.retentionDays || 30);
                    const backupTier = (props.backupTier || "VaultStandard") as BackupTier;
                    const storageConsumedGB = Number(props.storageConsumedInMB ? (props.storageConsumedInMB / 1024).toFixed(2) : 0);
                    const isOrphan = protectionState === "ProtectionStopped" || (!sourceResourceId && protectionState !== "Protected");

                    const itemDetail: ProtectedItemDetail = {
                        id: fullId,
                        name,
                        vaultId: "",
                        vaultName: vaultKey,
                        workloadType,
                        sourceResourceId,
                        sourceResourceName,
                        isSourceResourceDeleted: isOrphan,
                        protectionState,
                        policyName,
                        retentionDays,
                        backupTier,
                        storageConsumedGB,
                        monthlyCostUsd: parseFloat((storageConsumedGB * 0.0225 + 10.0).toFixed(2)),
                        lastBackupStatus: props.lastBackupStatus === "Failed" ? "Failed" : (props.lastBackupStatus === "Warning" ? "Warning" : "Healthy"),
                        lastBackupTime: props.lastBackupTime || null,
                        isOrphanCandidate: isOrphan,
                    };

                    const list = protectedItemsByVault.get(vaultKey) || [];
                    list.push(itemDetail);
                    protectedItemsByVault.set(vaultKey, list);
                }

                for (const rawAsr of rawAsrItems || []) {
                    const fullId = String(rawAsr.id || "");
                    const vaultMatch = fullId.match(/\/vaults\/([^/]+)/i);
                    if (vaultMatch) {
                        const vKey = vaultMatch[1].toLowerCase();
                        asrCountByVault.set(vKey, (asrCountByVault.get(vKey) || 0) + 1);
                    }
                }

                // 3. Query DB Cost Attribution for Backup Vaults
                const [costRows]: any = await pool.query(
                    `SELECT resource_id, LOWER(resource_group) AS rg, SUM(cost_usd) AS cost
                     FROM CostCategorySnapshots
                     WHERE tenant_id = ?
                       AND LOWER(resource_type) IN ('microsoft.recoveryservices/vaults', 'microsoft.dataprotection/backupvaults')
                       AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                     GROUP BY resource_id, LOWER(resource_group)`,
                    [tenantId]
                ).catch(() => [[], []]);

                const costByResourceId = new Map<string, number>();
                const costByRg = new Map<string, number>();
                for (const row of costRows || []) {
                    const cost = parseFloat(row.cost) || 0;
                    if (row.resource_id) costByResourceId.set(String(row.resource_id).toLowerCase(), cost);
                    if (row.rg) costByRg.set(row.rg, (costByRg.get(row.rg) || 0) + cost);
                }

                // 4. Map Vaults with real metrics
                const mappedVaults: BackupVaultDetail[] = rawVaults.map((v: any) => {
                    const id = String(v.id || "");
                    const name = String(v.name || "");
                    const vKey = name.toLowerCase();
                    const rg = String(v.resourceGroup || "");
                    const subId = String(v.subscriptionId || "");
                    const location = String(v.location || "eastus");
                    const typeStr = String(v.type || "").toLowerCase();
                    const vaultType: VaultType = typeStr.includes("dataprotection") ? "BackupVault" : "RecoveryServicesVault";
                    const skuName = String(v.sku?.name || "Standard");

                    const rawRedundancy = v.properties?.redundancySettings?.standardTierStorageRedundancy || v.properties?.storageModelType;
                    const redundancy = normalizeRedundancy(rawRedundancy);
                    const crr = Boolean(v.properties?.redundancySettings?.crossRegionRestore === "Enabled");
                    const softDelete = v.properties?.securitySettings?.softDeleteSettings?.softDeleteState === "Enabled" || true;
                    const env = detectVaultEnvironment(v.tags, name, rg);

                    const normId = id.toLowerCase();
                    const directCost = costByResourceId.get(normId) || 0;
                    const groupCost = costByRg.get(rg.toLowerCase()) || 0;

                    const vaultProtectedItems = (protectedItemsByVault.get(vKey) || []).map((item) => ({
                        ...item,
                        vaultId: id,
                        vaultName: name,
                    }));

                    const asrCount = asrCountByVault.get(vKey) || 0;

                    // Compute real storage breakdown from items
                    let snapshotGb = 0;
                    let standardGb = 0;
                    let archiveGb = 0;
                    let orphanGb = 0;

                    for (const item of vaultProtectedItems) {
                        if (item.isOrphanCandidate) {
                            orphanGb += item.storageConsumedGB;
                        } else if (item.backupTier === "Snapshot") {
                            snapshotGb += item.storageConsumedGB;
                        } else if (item.backupTier === "VaultArchive") {
                            archiveGb += item.storageConsumedGB;
                        } else {
                            standardGb += item.storageConsumedGB;
                        }
                    }

                    const totalStorageGB = parseFloat((snapshotGb + standardGb + archiveGb + orphanGb).toFixed(2));
                    const storageBreakdown = {
                        totalStorageGB,
                        snapshotTierGB: parseFloat(snapshotGb.toFixed(2)),
                        vaultStandardGB: parseFloat(standardGb.toFixed(2)),
                        vaultArchiveGB: parseFloat(archiveGb.toFixed(2)),
                        orphanedStorageGB: parseFloat(orphanGb.toFixed(2)),
                    };

                    const estimatedCost = vaultProtectedItems.length > 0
                        ? estimateMonthlyVaultCost(redundancy, storageBreakdown, vaultProtectedItems.length, asrCount)
                        : 0;

                    const finalCost = directCost > 0 ? directCost : (groupCost > 0 ? groupCost : estimatedCost);

                    return {
                        id,
                        name,
                        resourceGroup: rg,
                        subscriptionId: subId,
                        subscriptionName: subId,
                        location,
                        vaultType,
                        skuName,
                        redundancy,
                        crossRegionRestoreEnabled: crr,
                        softDeleteEnabled: softDelete,
                        softDeleteRetentionDays: 14,
                        immutabilityState: (v.properties?.securitySettings?.immutabilitySettings?.state as any) || "Disabled",
                        storageBreakdown,
                        protectedItemsCount: vaultProtectedItems.length,
                        orphanedItemsCount: vaultProtectedItems.filter((i) => i.isOrphanCandidate).length,
                        asrProtectedItemsCount: asrCount,
                        monthlyCostUsd: parseFloat(finalCost.toFixed(2)),
                        billedCostUsd: parseFloat(finalCost.toFixed(2)),
                        costPerGb: totalStorageGB > 0 ? parseFloat((finalCost / totalStorageGB).toFixed(4)) : 0,
                        environmentTag: env,
                        tags: v.tags || {},
                        protectedItems: vaultProtectedItems,
                        recommendations: [],
                    };
                });

                const remediations = buildBackupRemediations(mappedVaults);
                const vaultsWithRecs = mappedVaults.map((v) => ({
                    ...v,
                    recommendations: remediations.filter((r) => r.vaultId === v.id),
                }));

                const kpis = computeBackupsKpis(vaultsWithRecs, remediations);
                const storageBreakdown = aggregateStorageBreakdown(vaultsWithRecs);
                const allProtectedItems = vaultsWithRecs.flatMap((v) => v.protectedItems);

                return {
                    success: true,
                    mock: false,
                    kpis,
                    vaults: vaultsWithRecs,
                    allProtectedItems,
                    storageBreakdown,
                    remediations,
                };
            },
            1800,
            900
        );

        return NextResponse.json(data);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[backups route] Error:", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
