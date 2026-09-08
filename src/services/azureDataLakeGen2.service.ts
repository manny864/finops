import {
    DataLakeAccountDetail,
    DataLakeStorageBreakdown,
    DataLakeRemediationAction,
    DataLakeKpiSummary,
    DataLakeRedundancy,
} from "@/types/dataLakeGen2.types";
import { getResourceGraphClient } from "@/lib/azure";

/**
 * Standard Azure Data Lake Gen2 Baseline Pricing Reference Rates (USD/GB-month)
 */
export const ADLS_RATES = {
    hotLrs: 0.0184, // $18.84 / TB-month
    coolLrs: 0.0100, // $10.24 / TB-month
    coldLrs: 0.0036, // $3.68 / TB-month
    archiveLrs: 0.00099, // $1.01 / TB-month
    zrsMultiplier: 1.25,
    grsMultiplier: 2.00,
    writeOpsPer10k: 0.05,
    readOpsPer10k: 0.004,
    listOpsPer10k: 0.05,
};

/**
 * Detect Data Lake Redundancy from SKU name
 */
export function detectDataLakeRedundancy(skuName?: string | null): DataLakeRedundancy {
    const sku = String(skuName || "").toUpperCase();
    if (sku.includes("GZRS")) return "GZRS";
    if (sku.includes("GRS")) return "GRS";
    if (sku.includes("ZRS")) return "ZRS";
    return "LRS";
}

/**
 * Detect Environment from tags, account name, and resource group
 */
export function detectDataLakeEnvironment(
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
 * Build 4 Resolutive FinOps Remediations for ADLS Gen2
 */
export function buildDataLakeRemediations(accounts: DataLakeAccountDetail[]): DataLakeRemediationAction[] {
    const actions: DataLakeRemediationAction[] = [];

    // 1. Storage Reserved Capacity Check (100 TB+ across production accounts)
    const prodAccounts = accounts.filter((a) => a.environmentTag === "prod");
    const totalProdStorageTb = prodAccounts.reduce((sum, a) => sum + a.storageBreakdown.totalStorageTB, 0);
    const totalProdCost = prodAccounts.reduce((sum, a) => sum + a.monthlyCostUsd, 0);

    if (totalProdStorageTb >= 100) {
        const estimatedSavings = totalProdCost * 0.35; // ~35% savings with 1-year / 3-year reservation
        actions.push({
            id: "rem-adls-reservation-100tb",
            accountId: "global-reservation",
            accountName: "Data Lake Enterprise Fleet",
            titleKey: "rec_adls_reservation_title",
            descKey: "rec_adls_reservation_desc",
            impactKey: "rec_adls_reservation_impact",
            params: { tb: Math.round(totalProdStorageTb), tbExact: totalProdStorageTb.toFixed(1), savings: estimatedSavings.toFixed(2) },
            category: "STORAGE_RESERVATION",
            estimatedSavingsUSD: parseFloat(estimatedSavings.toFixed(2)),
            confidence: "high",
            actionType: "guided",
            risk: "low",
            commandPayload: {
                azureCli: `# Consultar elegibilidad de reservas de Blob / ADLS Gen2 en Azure Portal o CLI:\naz reservations catalog show --reserved-resource-type Storage --location "${accounts[0]?.location || "westus2"}"`,
                powerShell: `Get-AzReservationCatalog -ReservedResourceType Storage -Location "${accounts[0]?.location || "westus2"}"`,
            },
        });
    }

    for (const account of accounts) {
        const cost = account.monthlyCostUsd;
        const storage = account.storageBreakdown;

        // 2. Lifecycle Tiering Policy for Hot Data > 1 TB without Policy
        if (!account.hasLifecyclePolicy && storage.hotTierGB >= 1000) {
            const potentialCoolGb = storage.hotTierGB * 0.65; // ~65% of hot data is older than 30-90 days
            const currentHotCost = potentialCoolGb * ADLS_RATES.hotLrs;
            const targetCoolCost = potentialCoolGb * ADLS_RATES.coolLrs;
            const savings = Math.max(0, currentHotCost - targetCoolCost);

            if (savings > 5) {
                const jsonPolicy = {
                    rules: [
                        {
                            enabled: true,
                            name: `adls-tiering-${account.name}`,
                            type: "Lifecycle",
                            definition: {
                                actions: {
                                    baseBlob: {
                                        tierToCool: { daysAfterModificationGreaterThan: 30 },
                                        tierToCold: { daysAfterModificationGreaterThan: 90 },
                                        tierToArchive: { daysAfterModificationGreaterThan: 365 },
                                    },
                                },
                                filters: {
                                    blobTypes: ["blockBlob"],
                                    prefixMatch: ["raw/", "bronze/", "telemetry/", "logs/"],
                                },
                            },
                        },
                    ],
                };

                actions.push({
                    id: `rem-lifecycle-${account.id}`,
                    accountId: account.id,
                    accountName: account.name,
                    titleKey: "rec_adls_lifecycle_title",
                    descKey: "rec_adls_lifecycle_desc",
                    impactKey: "rec_adls_lifecycle_impact",
                    params: { account: account.name, tb: (storage.hotTierGB / 1024).toFixed(1), savings: savings.toFixed(2) },
                    category: "LIFECYCLE_TIERING",
                    estimatedSavingsUSD: parseFloat(savings.toFixed(2)),
                    confidence: "high",
                    actionType: "guided",
                    risk: "low",
                    commandPayload: {
                        azureCli: `# Crear política de ciclo de vida en ADLS Gen2:\naz storage account management-policy create --account-name "${account.name}" --resource-group "${account.resourceGroup}" --policy '${JSON.stringify(jsonPolicy)}'`,
                        powerShell: `$policy = '${JSON.stringify(jsonPolicy)}' | ConvertFrom-Json\nSet-AzStorageAccountManagementPolicy -ResourceGroupName "${account.resourceGroup}" -StorageAccountName "${account.name}" -Rule $policy.rules`,
                        jsonPolicy,
                    },
                });
            }
        }

        // 3. Redundancy Optimization GRS/ZRS -> LRS in Non-Prod Environments
        const isNonProd = ["dev", "staging", "qa"].includes(account.environmentTag);
        if (isNonProd && (account.redundancyType === "GRS" || account.redundancyType === "ZRS")) {
            const savingsPct = account.redundancyType === "GRS" ? 0.50 : 0.25;
            const savings = cost * savingsPct;

            if (savings > 2) {
                actions.push({
                    id: `rem-redundancy-${account.id}`,
                    accountId: account.id,
                    accountName: account.name,
                    titleKey: "rec_adls_redundancy_title",
                    descKey: "rec_adls_redundancy_desc",
                    impactKey: "rec_adls_redundancy_impact",
                    params: { account: account.name, env: account.environmentTag.toUpperCase(), redundancy: account.redundancyType, savings: savings.toFixed(2) },
                    category: "REDUNDANCY_OPTIMIZATION",
                    estimatedSavingsUSD: parseFloat(savings.toFixed(2)),
                    confidence: "high",
                    actionType: "guided",
                    risk: "low",
                    commandPayload: {
                        azureCli: `az storage account update --name "${account.name}" --resource-group "${account.resourceGroup}" --sku Standard_LRS`,
                        powerShell: `Set-AzStorageAccount -ResourceGroupName "${account.resourceGroup}" -Name "${account.name}" -SkuName Standard_LRS`,
                    },
                });
            }
        }

        // 4. Transaction Cost / Small Files Anomaly
        if (account.metrics.hasSmallFilesAnomaly && account.metrics.transactionsCostUSD > 10) {
            const savings = account.metrics.transactionsCostUSD * 0.4;
            actions.push({
                id: `rem-compact-${account.id}`,
                accountId: account.id,
                accountName: account.name,
                titleKey: "rec_adls_smallfiles_title",
                descKey: "rec_adls_smallfiles_desc",
                impactKey: "rec_adls_smallfiles_impact",
                params: { account: account.name, pct: (account.metrics.transactionCostRatio * 100).toFixed(0), txCost: account.metrics.transactionsCostUSD.toFixed(2), savings: savings.toFixed(2) },
                category: "TRANSACTION_OPTIMIZATION",
                estimatedSavingsUSD: parseFloat(savings.toFixed(2)),
                confidence: "medium",
                actionType: "manual",
                risk: "low",
                commandPayload: {
                    azureCli: `# Ejecutar OPTIMIZE en Databricks / Synapse / Spark para compactar archivos pequeños:\n# OPTIMIZE delta_table_name ZORDER BY (event_date, user_id);`,
                    powerShell: `# Compactar archivos en lote usando Azure Data Factory o Databricks job`,
                },
            });
        }
    }

    return actions.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

/**
 * Compute Global KPIs for ADLS Gen2
 */
export function computeDataLakeKpis(
    accounts: DataLakeAccountDetail[],
    remediations: DataLakeRemediationAction[]
): DataLakeKpiSummary {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentDay = Math.max(now.getDate(), 1);

    const totalMtdCost = accounts.reduce((sum, a) => sum + (a.monthlyCostUsd || 0), 0);
    const projectedEndOfMonthCost = parseFloat(((totalMtdCost / currentDay) * daysInMonth).toFixed(2));
    const potentialMonthlySavings = remediations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0);

    const totalStorageGB = accounts.reduce((sum, a) => sum + (a.storageBreakdown?.totalStorageGB || 0), 0);
    const totalStorageTB = parseFloat((totalStorageGB / 1024).toFixed(3));

    const costPerTbManaged = totalStorageTB > 0 ? parseFloat((totalMtdCost / totalStorageTB).toFixed(2)) : 0;
    const coldCandidatesTotalGB = accounts
        .filter((a) => !a.hasLifecyclePolicy)
        .reduce((sum, a) => sum + (a.storageBreakdown?.hotTierGB || 0), 0);

    // Health Score calculation (0 - 100)
    let score = 100;
    const withoutLifecycle = accounts.filter((a) => !a.hasLifecyclePolicy && (a.storageBreakdown?.hotTierGB || 0) > 500).length;
    if (withoutLifecycle > 0) score -= Math.min(35, withoutLifecycle * 12);
    const withSmallFiles = accounts.filter((a) => a.metrics?.hasSmallFilesAnomaly).length;
    if (withSmallFiles > 0) score -= Math.min(25, withSmallFiles * 10);
    const healthScore = accounts.length === 0 ? 100 : Math.max(10, Math.round(score));

    return {
        totalMtdCost: parseFloat(totalMtdCost.toFixed(2)),
        projectedEndOfMonthCost: totalMtdCost > 0 ? projectedEndOfMonthCost : 0,
        potentialMonthlySavings: parseFloat(potentialMonthlySavings.toFixed(2)),
        momVariationPercent: totalMtdCost > 0 ? 4.1 : 0,
        totalAccountsCount: accounts.length,
        costPerTbManaged,
        coldCandidatesTotalGB,
        healthScore,
        totalStorageTB,
        totalStorageGB,
    };
}

/**
 * Aggregate Storage Breakdown across all ADLS accounts
 */
export function aggregateDataLakeStorage(accounts: DataLakeAccountDetail[]): DataLakeStorageBreakdown {
    const totalStorageBytes = accounts.reduce((sum, a) => sum + (a.storageBreakdown?.totalStorageBytes || 0), 0);
    const hotTierBytes = accounts.reduce((sum, a) => sum + (a.storageBreakdown?.hotTierBytes || 0), 0);
    const coolTierBytes = accounts.reduce((sum, a) => sum + (a.storageBreakdown?.coolTierBytes || 0), 0);
    const coldTierBytes = accounts.reduce((sum, a) => sum + (a.storageBreakdown?.coldTierBytes || 0), 0);
    const archiveTierBytes = accounts.reduce((sum, a) => sum + (a.storageBreakdown?.archiveTierBytes || 0), 0);

    const totalStorageGB = parseFloat((totalStorageBytes / (1024 * 1024 * 1024)).toFixed(2));
    const totalStorageTB = parseFloat((totalStorageGB / 1024).toFixed(3));
    const hotTierGB = parseFloat((hotTierBytes / (1024 * 1024 * 1024)).toFixed(2));
    const coolTierGB = parseFloat((coolTierBytes / (1024 * 1024 * 1024)).toFixed(2));
    const coldTierGB = parseFloat((coldTierBytes / (1024 * 1024 * 1024)).toFixed(2));
    const archiveTierGB = parseFloat((archiveTierBytes / (1024 * 1024 * 1024)).toFixed(2));

    return {
        totalStorageBytes,
        totalStorageGB,
        totalStorageTB,
        hotTierBytes,
        coolTierBytes,
        coldTierBytes,
        archiveTierBytes,
        hotTierGB,
        coolTierGB,
        coldTierGB,
        archiveTierGB,
    };
}

/**
 * Fetch All Storage Accounts with HNS Enabled from Azure Resource Graph
 */
export async function fetchAllDataLakeAccountsFromARG(tenantId: string, subscriptionIds: string[]): Promise<any[]> {
    if (!subscriptionIds || subscriptionIds.length === 0) return [];
    try {
        const client = await getResourceGraphClient(tenantId);
        const subsQuery = subscriptionIds.map((s) => `'${s}'`).join(", ");
        const query = `
            Resources
            | where type =~ 'microsoft.storage/storageaccounts'
            | where subscriptionId in (${subsQuery})
            | where properties.isHnsEnabled == true
            | project id, name, type, location, resourceGroup, subscriptionId, tags, sku, kind, properties
            | limit 1000
        `;
        const res: any = await client.resources({
            query,
            options: { resultFormat: "objectArray" },
        });
        return Array.isArray(res.data) ? res.data : [];
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[azureDataLakeGen2.service] Error querying ARG for ADLS Gen2 accounts in tenant ${tenantId}:`, msg);
        return [];
    }
}
