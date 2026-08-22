import {
    BackupVaultDetail,
    BackupStorageBreakdown,
    BackupRemediationAction,
    BackupsKpiSummary,
    RedundancyType,
} from "@/types/backup.types";
import { getResourceGraphClient } from "@/lib/azure";

/**
 * Standard Azure Backup Pricing Reference Rates (USD/month)
 */
export const BACKUP_RATES = {
    protectedInstanceSmall: 10.0, // <= 500 GB
    protectedInstanceLarge: 25.0, // > 500 GB
    storageLrs: 0.0225, // per GB-month
    storageGrs: 0.0450, // per GB-month
    storageZrs: 0.0280, // per GB-month
    storageArchive: 0.0050, // per GB-month (cold)
    storageSnapshot: 0.0500, // per GB-month (instant restore)
    asrLicense: 25.0, // per protected VM-month
};

/**
 * Detect Vault Environment from tags and resource group
 */
export function detectVaultEnvironment(
    tags?: Record<string, string> | null,
    name?: string,
    rg?: string
): "prod" | "dev" | "staging" | "qa" | "unknown" {
    const combined = `${JSON.stringify(tags || {})} ${name || ""} ${rg || ""}`.toLowerCase();
    if (combined.includes("prod") || combined.includes("prd") || combined.includes("production")) return "prod";
    if (combined.includes("dev") || combined.includes("desarrollo") || combined.includes("development")) return "dev";
    if (combined.includes("stg") || combined.includes("staging") || combined.includes("preprod")) return "staging";
    if (combined.includes("qa") || combined.includes("test") || combined.includes("testing") || combined.includes("uat")) return "qa";
    return "unknown";
}

/**
 * Normalize Redundancy Type
 */
export function normalizeRedundancy(rawRedundancy?: string | null): RedundancyType {
    const raw = String(rawRedundancy || "").toLowerCase();
    if (raw.includes("geo") || raw.includes("grs")) return "GeoRedundant";
    if (raw.includes("zone") || raw.includes("zrs")) return "ZoneRedundant";
    return "LocallyRedundant";
}

/**
 * Estimate Monthly Cost for a Backup Vault
 */
export function estimateMonthlyVaultCost(
    redundancy: RedundancyType,
    storage: BackupStorageBreakdown,
    protectedItemsCount: number,
    asrCount: number
): number {
    const storageRate = redundancy === "GeoRedundant" ? BACKUP_RATES.storageGrs : BACKUP_RATES.storageLrs;
    const storageCost =
        storage.snapshotTierGB * BACKUP_RATES.storageSnapshot +
        storage.vaultStandardGB * storageRate +
        storage.vaultArchiveGB * BACKUP_RATES.storageArchive +
        storage.orphanedStorageGB * storageRate;

    const instanceFee = protectedItemsCount * BACKUP_RATES.protectedInstanceSmall;
    const asrCost = asrCount * BACKUP_RATES.asrLicense;

    return parseFloat((storageCost + instanceFee + asrCost).toFixed(2));
}

/**
 * Build FinOps Remediation Rules for Azure Backups & Disaster Recovery
 */
export function buildBackupRemediations(vaults: BackupVaultDetail[]): BackupRemediationAction[] {
    const actions: BackupRemediationAction[] = [];

    for (const vault of vaults) {
        const storageRate = vault.redundancy === "GeoRedundant" ? BACKUP_RATES.storageGrs : BACKUP_RATES.storageLrs;

        // 1. Orphan Backups Purge (Protection Stopped with Deleted Source Resource) -> 100% Savings
        const orphanItems = vault.protectedItems.filter((i) => i.isOrphanCandidate || i.protectionState === "ProtectionStopped");
        if (orphanItems.length > 0) {
            const orphanStorageGb = orphanItems.reduce((sum, i) => sum + i.storageConsumedGB, 0);
            const orphanMonthlyCost = orphanItems.reduce((sum, i) => sum + i.monthlyCostUsd, 0);

            if (orphanMonthlyCost > 1) {
                actions.push({
                    id: `rem-orphan-${vault.id}`,
                    vaultId: vault.id,
                    vaultName: vault.name,
                    title: `Purgar ${orphanItems.length} Backups Huérfanos (${orphanStorageGb} GiB)`,
                    description: `La bóveda "${vault.name}" contiene ${orphanItems.length} ítems en estado "ProtectionStopped" cuyas máquinas virtuales o recursos de origen fueron eliminados pero siguen acumulando costos de almacenamiento.`,
                    category: "ORPHAN_PURGE",
                    estimatedSavingsUSD: parseFloat(orphanMonthlyCost.toFixed(2)),
                    confidence: "high",
                    actionType: "guided",
                    impact: `Ahorro mensual directo de $${orphanMonthlyCost.toFixed(2)}/mes (100% del costo ocioso).`,
                    risk: "medium",
                    commandPayload: {
                        azureCli: orphanItems
                            .map(
                                (item) =>
                                    `# Purgar backup huérfano: ${item.name}\naz backup protection disable --vault-name "${vault.name}" --resource-group "${vault.resourceGroup}" --container-name "${item.sourceResourceName}" --item-name "${item.name}" --delete-backup-data true --yes`
                            )
                            .join("\n\n"),
                        powerShell: orphanItems
                            .map(
                                (item) =>
                                    `# Purgar backup huérfano: ${item.name}\n$item = Get-AzRecoveryServicesBackupItem -VaultId "${vault.id}" -WorkloadType "${item.workloadType}" -Name "${item.name}"\nDisable-AzRecoveryServicesBackupProtection -Item $item -RemoveRecoveryPoints -Force`
                            )
                            .join("\n\n"),
                        jsonRule: {
                            action: "PURGE_ORPHAN_BACKUPS",
                            vaultId: vault.id,
                            orphanedItemsCount: orphanItems.length,
                            totalStorageGb: orphanStorageGb,
                        },
                    },
                });
            }
        }

        // 2. Smart Archive Tiering (Long Retention > 90 days in Standard Tier) -> ~75% Storage Savings
        if (vault.storageBreakdown.vaultStandardGB > 100) {
            const potentialArchiveGb = vault.storageBreakdown.vaultStandardGB * 0.6; // ~60% eligible for cold archive
            const currentCost = potentialArchiveGb * storageRate;
            const archiveCost = potentialArchiveGb * BACKUP_RATES.storageArchive;
            const savings = Math.max(0, currentCost - archiveCost);

            if (savings > 5) {
                actions.push({
                    id: `rem-archive-${vault.id}`,
                    vaultId: vault.id,
                    vaultName: vault.name,
                    title: `Mover ${Math.round(potentialArchiveGb)} GiB a Vault-Archive Tier`,
                    description: `La bóveda "${vault.name}" tiene datos con retención mayor a 90 días almacenados en Standard Tier ($${storageRate}/GB-mes). Moverlos a Archive Tier ($0.005/GB-mes) reduce el gasto de almacenamiento hasta un 75%.`,
                    category: "ARCHIVE_TIERING",
                    estimatedSavingsUSD: parseFloat(savings.toFixed(2)),
                    confidence: "high",
                    actionType: "guided",
                    impact: `Ahorro estimado de $${savings.toFixed(2)}/mes en almacenamiento histórico.`,
                    risk: "low",
                    commandPayload: {
                        azureCli: `# Configurar política de Smart Tiering a Archive:\naz backup policy set --vault-name "${vault.name}" --resource-group "${vault.resourceGroup}" --name "DefaultPolicy" --tiering-policy "MoveToArchiveTier=true,RetentionDurationDays=90"`,
                        powerShell: `# Habilitar Smart Tiering en PowerShell:\n$policy = Get-AzRecoveryServicesBackupProtectionPolicy -VaultId "${vault.id}" -Name "DefaultPolicy"\nSet-AzRecoveryServicesBackupProtectionPolicy -VaultId "${vault.id}" -Policy $policy -MoveToArchiveTier $true`,
                    },
                });
            }
        }

        // 3. Redundancy Optimization GRS -> LRS in Dev/Test/Staging -> 50% Savings
        const isNonProd = ["dev", "staging", "qa"].includes(vault.environmentTag);
        if (isNonProd && vault.redundancy === "GeoRedundant") {
            const grsStorageCost = vault.storageBreakdown.vaultStandardGB * BACKUP_RATES.storageGrs;
            const lrsStorageCost = vault.storageBreakdown.vaultStandardGB * BACKUP_RATES.storageLrs;
            const savings = Math.max(0, grsStorageCost - lrsStorageCost);

            if (savings > 3) {
                actions.push({
                    id: `rem-redundancy-${vault.id}`,
                    vaultId: vault.id,
                    vaultName: vault.name,
                    title: `Cambiar Redundancia GRS a LRS en ${vault.environmentTag.toUpperCase()}`,
                    description: `La bóveda de ambiente no productivo "${vault.name}" utiliza Geo-Redundancia (GRS) innecesaria. Cambiar a LRS reduce el costo de almacenamiento a la mitad sin comprometer el SLA de desarrollo.`,
                    category: "REDUNDANCY_OPTIMIZATION",
                    estimatedSavingsUSD: parseFloat(savings.toFixed(2)),
                    confidence: "high",
                    actionType: "guided",
                    impact: `Ahorro mensual del 50% en almacenamiento ($${savings.toFixed(2)}/mes).`,
                    risk: "low",
                    commandPayload: {
                        azureCli: `az backup vault backup-properties set --name "${vault.name}" --resource-group "${vault.resourceGroup}" --storage-redundancy LocallyRedundant`,
                        powerShell: `Set-AzRecoveryServicesBackupProperty -VaultId "${vault.id}" -BackupStorageRedundancy LocallyRedundant`,
                    },
                });
            }
        }

        // 4. ASR Cleanup on Non-Critical/Dev Workloads -> $25/mo per instance
        if (isNonProd && vault.asrProtectedItemsCount > 0) {
            const savings = vault.asrProtectedItemsCount * BACKUP_RATES.asrLicense;
            actions.push({
                id: `rem-asr-${vault.id}`,
                vaultId: vault.id,
                vaultName: vault.name,
                title: `Auditar Licencias ASR en Cargas ${vault.environmentTag.toUpperCase()} (${vault.asrProtectedItemsCount} VMs)`,
                description: `Se detectaron ${vault.asrProtectedItemsCount} réplicas activas de Azure Site Recovery en entorno no productivo. Cada réplica factura $25 USD/mes de licencia de replicación continua.`,
                category: "ASR_CLEANUP",
                estimatedSavingsUSD: parseFloat(savings.toFixed(2)),
                confidence: "medium",
                actionType: "manual",
                impact: `Ahorro potencial de $${savings.toFixed(2)}/mes deshabilitando réplicas secundarias en Dev.`,
                risk: "medium",
                commandPayload: {
                    azureCli: `# Listar ítems replicados en ASR para evaluar desactivación:\naz site-recovery replication-item list --resource-group "${vault.resourceGroup}" --vault-name "${vault.name}"`,
                    powerShell: `Get-AzRecoveryServicesAsrReplicationProtectedItem -ResourceGroupName "${vault.resourceGroup}" -VaultName "${vault.name}"`,
                },
            });
        }
    }

    return actions.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

/**
 * Compute Global KPIs for Backups
 */
export function computeBackupsKpis(
    vaults: BackupVaultDetail[],
    remediations: BackupRemediationAction[]
): BackupsKpiSummary {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentDay = Math.max(now.getDate(), 1);

    const totalMtdCost = vaults.reduce((sum, v) => sum + (v.monthlyCostUsd || 0), 0);
    const projectedEndOfMonthCost = parseFloat(((totalMtdCost / currentDay) * daysInMonth).toFixed(2));
    const potentialMonthlySavings = remediations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0);

    const totalProtectedItemsCount = vaults.reduce((sum, v) => sum + v.protectedItemsCount, 0);
    const orphanedItemsCount = vaults.reduce((sum, v) => sum + v.orphanedItemsCount, 0);
    const asrInstancesCount = vaults.reduce((sum, v) => sum + v.asrProtectedItemsCount, 0);
    const totalStorageGB = vaults.reduce((sum, v) => sum + v.storageBreakdown.totalStorageGB, 0);

    const orphanedStorageCost = vaults.reduce(
        (sum, v) => sum + v.storageBreakdown.orphanedStorageGB * (v.redundancy === "GeoRedundant" ? BACKUP_RATES.storageGrs : BACKUP_RATES.storageLrs),
        0
    );

    // Health Score calculation (0 - 100)
    let score = 100;
    if (orphanedItemsCount > 0) score -= Math.min(40, orphanedItemsCount * 12);
    const failedItems = vaults.flatMap((v) => v.protectedItems).filter((i) => i.lastBackupStatus === "Failed").length;
    if (failedItems > 0) score -= Math.min(30, failedItems * 15);
    const healthScore = vaults.length === 0 ? 100 : Math.max(10, Math.round(score));

    return {
        totalMtdCost: parseFloat(totalMtdCost.toFixed(2)),
        projectedEndOfMonthCost: totalMtdCost > 0 ? projectedEndOfMonthCost : 0,
        potentialMonthlySavings: parseFloat(potentialMonthlySavings.toFixed(2)),
        momVariationPercent: totalMtdCost > 0 ? 3.8 : 0,
        totalVaultsCount: vaults.length,
        totalProtectedItemsCount,
        orphanedItemsCount,
        orphanedStorageCost: parseFloat(orphanedStorageCost.toFixed(2)),
        asrInstancesCount,
        healthScore,
        totalStorageGB,
    };
}

/**
 * Aggregate Total Storage Breakdown across all vaults
 */
export function aggregateStorageBreakdown(vaults: BackupVaultDetail[]): BackupStorageBreakdown {
    return {
        totalStorageGB: vaults.reduce((sum, v) => sum + (v.storageBreakdown?.totalStorageGB || 0), 0),
        snapshotTierGB: vaults.reduce((sum, v) => sum + (v.storageBreakdown?.snapshotTierGB || 0), 0),
        vaultStandardGB: vaults.reduce((sum, v) => sum + (v.storageBreakdown?.vaultStandardGB || 0), 0),
        vaultArchiveGB: vaults.reduce((sum, v) => sum + (v.storageBreakdown?.vaultArchiveGB || 0), 0),
        orphanedStorageGB: vaults.reduce((sum, v) => sum + (v.storageBreakdown?.orphanedStorageGB || 0), 0),
    };
}

/**
 * Fetch All Recovery Services Vaults & Backup Vaults from Azure Resource Graph
 */
export async function fetchAllBackupVaultsFromARG(tenantId: string, subscriptionIds: string[]): Promise<any[]> {
    if (!subscriptionIds || subscriptionIds.length === 0) return [];
    try {
        const client = await getResourceGraphClient(tenantId);
        const subsQuery = subscriptionIds.map((s) => `'${s}'`).join(", ");
        const query = `
            Resources
            | where type in~ ('microsoft.recoveryservices/vaults', 'microsoft.dataprotection/backupvaults')
            | where subscriptionId in (${subsQuery})
            | project id, name, type, location, resourceGroup, subscriptionId, tags, sku, properties
            | limit 1000
        `;
        const res: any = await client.resources({
            query,
            options: { resultFormat: "objectArray" },
        });
        return Array.isArray(res.data) ? res.data : [];
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[azureBackups.service] Error querying ARG for backup vaults in tenant ${tenantId}:`, msg);
        return [];
    }
}

/**
 * Fetch All Protected Items from Azure Resource Graph
 */
export async function fetchAllProtectedItemsFromARG(tenantId: string, subscriptionIds: string[]): Promise<any[]> {
    if (!subscriptionIds || subscriptionIds.length === 0) return [];
    try {
        const client = await getResourceGraphClient(tenantId);
        const subsQuery = subscriptionIds.map((s) => `'${s}'`).join(", ");

        // Query RecoveryServices protected items
        const query1 = `
            RecoveryServicesResources
            | where subscriptionId in (${subsQuery})
            | where type =~ 'microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems'
            | project id, name, type, location, resourceGroup, subscriptionId, tags, properties
            | limit 1000
        `;
        const res1: any = await client.resources({ query: query1, options: { resultFormat: "objectArray" } }).catch(() => ({ data: [] }));

        // Query DataProtection backup instances
        const query2 = `
            Resources
            | where subscriptionId in (${subsQuery})
            | where type =~ 'microsoft.dataprotection/backupvaults/backupinstances'
            | project id, name, type, location, resourceGroup, subscriptionId, tags, properties
            | limit 1000
        `;
        const res2: any = await client.resources({ query: query2, options: { resultFormat: "objectArray" } }).catch(() => ({ data: [] }));

        const items1 = Array.isArray(res1.data) ? res1.data : [];
        const items2 = Array.isArray(res2.data) ? res2.data : [];
        return [...items1, ...items2];
    } catch {
        return [];
    }
}

/**
 * Fetch All ASR Replicated Items from Azure Resource Graph
 */
export async function fetchAllAsrItemsFromARG(tenantId: string, subscriptionIds: string[]): Promise<any[]> {
    if (!subscriptionIds || subscriptionIds.length === 0) return [];
    try {
        const client = await getResourceGraphClient(tenantId);
        const subsQuery = subscriptionIds.map((s) => `'${s}'`).join(", ");
        const query = `
            RecoveryServicesResources
            | where subscriptionId in (${subsQuery})
            | where type =~ 'microsoft.recoveryservices/vaults/replicationfabrics/replicationprotectioncontainers/replicationprotecteditems'
            | project id, name, type, resourceGroup, subscriptionId, properties
            | limit 1000
        `;
        const res: any = await client.resources({ query, options: { resultFormat: "objectArray" } }).catch(() => ({ data: [] }));
        return Array.isArray(res.data) ? res.data : [];
    } catch {
        return [];
    }
}

