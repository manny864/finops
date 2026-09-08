import {
    StorageAccountDetail,
    StorageRemediationAction,
} from "@/types/storage.types";

export const TIER_RATES: Record<string, number> = {
    hot: 0.0184,
    cool: 0.0100,
    cold: 0.0036,
    archive: 0.00099,
};

export const BENCHMARK_LRS_RATE = 0.0184;

export function detectRedundancyType(skuName?: string): string {
    const sku = String(skuName || "").toUpperCase();
    if (sku.includes("RA-GZRS") || sku.includes("RAGZRS")) return "RA-GZRS";
    if (sku.includes("GZRS")) return "GZRS";
    if (sku.includes("RA-GRS") || sku.includes("RAGRS")) return "RA-GRS";
    if (sku.includes("GRS")) return "GRS";
    if (sku.includes("ZRS")) return "ZRS";
    if (sku.includes("LRS")) return "LRS";
    return "LRS";
}

export function detectEnvironment(tags?: Record<string, string>, name?: string, rg?: string): string {
    const checkStr = `${JSON.stringify(tags || {})} ${name || ""} ${rg || ""}`.toLowerCase();
    if (checkStr.includes("prod") || checkStr.includes("production")) return "prod";
    if (checkStr.includes("stg") || checkStr.includes("staging")) return "staging";
    if (checkStr.includes("dev") || checkStr.includes("development")) return "dev";
    if (checkStr.includes("test") || checkStr.includes("testing")) return "test";
    if (checkStr.includes("qa") || checkStr.includes("uat")) return "qa";
    return "prod";
}

export function generateLifecyclePolicyJson(accountName: string, moveDaysToCool = 60, deleteDays = 365): string {
    const policy = {
        rules: [
            {
                enabled: true,
                name: `FinOps-Lifecycle-Optimization-${accountName}`,
                type: "Lifecycle",
                definition: {
                    actions: {
                        baseBlob: {
                            tierToCool: {
                                daysAfterModificationGreaterThan: moveDaysToCool,
                            },
                            tierToArchive: {
                                daysAfterModificationGreaterThan: 180,
                            },
                            delete: {
                                daysAfterModificationGreaterThan: deleteDays,
                            },
                        },
                        snapshot: {
                            delete: {
                                daysAfterCreationGreaterThan: 90,
                            },
                        },
                        version: {
                            delete: {
                                daysAfterCreationGreaterThan: 90,
                            },
                        },
                    },
                    filters: {
                        blobTypes: ["blockBlob"],
                        prefixMatch: [],
                    },
                },
            },
        ],
    };
    return JSON.stringify(policy, null, 2);
}

export function buildStorageRemediations(accounts: StorageAccountDetail[]): StorageRemediationAction[] {
    const remediations: StorageRemediationAction[] = [];

    for (const acc of accounts) {
        const env = acc.environmentTag || detectEnvironment(acc.tags, acc.name, acc.resourceGroup);
        const usedGb = acc.usedGb ?? 0;
        const monthlyCost = acc.monthlyCost || 0;
        const redundancy = detectRedundancyType(acc.skuName);

        // 1. Lifecycle Policy Generator
        if (!acc.hasLifecyclePolicy && (acc.tier === "Hot" || acc.tier === "Standard") && usedGb > 0.1) {
            const estimatedSavings = parseFloat((monthlyCost * 0.42).toFixed(2));
            const jsonPayload = generateLifecyclePolicyJson(acc.name, 60, 365);
            const cliCommand = `az storage account management-policy create \\\n  --account-name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --policy '${jsonPayload.replace(/\n/g, "")}'`;
            const powershellCommand = `Set-AzStorageAccountManagementPolicy -ResourceGroupName "${acc.resourceGroup}" -StorageAccountName "${acc.name}" -Policy (ConvertFrom-Json @'\n${jsonPayload}\n'@)`;

            remediations.push({
                id: `remediation-lifecycle-${acc.name}`,
                titleKey: "rec_sto_lifecycle_title",
                descKey: "rec_sto_lifecycle_desc",
                impactKey: "rec_sto_lifecycle_impact",
                stepKeys: ["rec_sto_lifecycle_step1", "rec_sto_lifecycle_step2", "rec_sto_lifecycle_step3", "rec_sto_lifecycle_step4"],
                params: { account: acc.name, savings: estimatedSavings },
                category: "Cost",
                actionType: "LIFECYCLE_POLICY_CREATE",
                severity: "HIGH",
                confidence: "HIGH",
                estimatedSavingsUSD: Math.max(estimatedSavings, 0.5),
                estimatedSavingsPct: 45,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                jsonPayload,
                cliCommand,
                powershellCommand,
            });
        }

        // 2. Redundancy Arbitrage in Non-Prod (ZRS/GRS -> LRS)
        if ((env === "dev" || env === "staging" || env === "test" || env === "qa") && (redundancy === "ZRS" || redundancy === "GRS" || redundancy === "RA-GRS")) {
            const savingsPct = redundancy === "GRS" || redundancy === "RA-GRS" ? 50 : 33;
            const estimatedSavings = parseFloat((monthlyCost * (savingsPct / 100)).toFixed(2));
            const cliCommand = `az storage account update \\\n  --name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --sku Standard_LRS`;
            const powershellCommand = `Set-AzStorageAccount -ResourceGroupName "${acc.resourceGroup}" -Name "${acc.name}" -SkuName "Standard_LRS"`;

            remediations.push({
                id: `remediation-redundancy-${acc.name}`,
                titleKey: "rec_sto_redundancy_title",
                descKey: "rec_sto_redundancy_desc",
                impactKey: "rec_sto_redundancy_impact",
                stepKeys: ["rec_sto_redundancy_step1", "rec_sto_redundancy_step2", "rec_sto_redundancy_step3"],
                params: { account: acc.name, env: env.toUpperCase(), redundancy, pct: savingsPct, savings: estimatedSavings },
                category: "Cost",
                actionType: "REDUNDANCY_OPTIMIZE_LRS",
                severity: "MEDIUM",
                confidence: "HIGH",
                estimatedSavingsUSD: Math.max(estimatedSavings, 1.2),
                estimatedSavingsPct: savingsPct,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
            });
        }

        // 3. Zombie / Empty Account Detection
        if ((acc.isZombieCandidate || (usedGb <= 0.001 && (acc.metrics?.transactionsCount ?? 0) < 10)) && monthlyCost <= 0.5) {
            const cliCommand = `az storage account delete \\\n  --name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --yes`;
            const powershellCommand = `Remove-AzStorageAccount -ResourceGroupName "${acc.resourceGroup}" -Name "${acc.name}" -Force`;

            remediations.push({
                id: `remediation-zombie-${acc.name}`,
                titleKey: "rec_sto_zombie_title",
                descKey: "rec_sto_zombie_desc",
                impactKey: "rec_sto_zombie_impact",
                stepKeys: ["rec_sto_zombie_step1", "rec_sto_zombie_step2", "rec_sto_zombie_step3"],
                params: { account: acc.name },
                category: "Governance",
                actionType: "ZOMBIE_ACCOUNT_PURGE",
                severity: "LOW",
                confidence: "HIGH",
                estimatedSavingsUSD: Math.max(monthlyCost, 0.1),
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
            });
        }

        // 4. Soft Delete Retention Adjustment
        if (acc.deleteRetentionEnabled && acc.deleteRetentionDays > 14) {
            const estimatedSavings = parseFloat((monthlyCost * 0.18).toFixed(2));
            const cliCommand = `az storage account blob-service-properties update \\\n  --account-name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --enable-delete-retention true \\\n  --delete-retention-days 7`;
            const powershellCommand = `Enable-AzStorageBlobDeleteRetentionPolicy -ResourceGroupName "${acc.resourceGroup}" -StorageAccountName "${acc.name}" -RetentionDays 7`;

            remediations.push({
                id: `remediation-softdelete-${acc.name}`,
                titleKey: "rec_sto_softdelete_title",
                descKey: "rec_sto_softdelete_desc",
                impactKey: "rec_sto_softdelete_impact",
                stepKeys: ["rec_sto_softdelete_step1", "rec_sto_softdelete_step2", "rec_sto_softdelete_step3"],
                params: { days: acc.deleteRetentionDays },
                category: "Cost",
                actionType: "SOFT_DELETE_RETENTION_ADJUST",
                severity: "MEDIUM",
                confidence: "MEDIUM",
                estimatedSavingsUSD: Math.max(estimatedSavings, 0.5),
                estimatedSavingsPct: 18,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
            });
        }

        // 5. Security Hardening (Public Access & TLS)
        if (acc.publicAccessAllowed || acc.minimumTlsVersion !== "TLS1_2") {
            const cliCommand = `az storage account update \\\n  --name ${acc.name} \\\n  --resource-group ${acc.resourceGroup} \\\n  --allow-blob-public-access false \\\n  --min-tls-version TLS1_2`;
            const powershellCommand = `Set-AzStorageAccount -ResourceGroupName "${acc.resourceGroup}" -Name "${acc.name}" -AllowBlobPublicAccess $false -MinimumTlsVersion "TLS1_2"`;

            remediations.push({
                id: `remediation-security-${acc.name}`,
                titleKey: "rec_sto_security_title",
                // Dos causas, dos frases: la clave se elige por instancia, no por actionType.
                descKey: acc.publicAccessAllowed ? "rec_sto_security_desc_public" : "rec_sto_security_desc_tls",
                impactKey: "rec_sto_security_impact",
                stepKeys: ["rec_sto_security_step1", "rec_sto_security_step2", "rec_sto_security_step3"],
                params: { account: acc.name },
                category: "Security",
                actionType: "SECURITY_HARDENING_PUBLIC_ACCESS",
                severity: "HIGH",
                confidence: "HIGH",
                estimatedSavingsUSD: 0,
                targetAccountId: acc.id,
                targetAccountName: acc.name,
                targetResourceGroup: acc.resourceGroup,
                cliCommand,
                powershellCommand,
            });
        }
    }

    // Sort: Cost savings highest first, then severity
    return remediations.sort((a, b) => (b.estimatedSavingsUSD || 0) - (a.estimatedSavingsUSD || 0));
}
