import { describe, it, expect } from "vitest";
import {
    detectVaultEnvironment,
    normalizeRedundancy,
    estimateMonthlyVaultCost,
    buildBackupRemediations,
    computeBackupsKpis,
    aggregateStorageBreakdown,
    BACKUP_RATES,
} from "@/services/azureBackups.service";
import { BackupVaultDetail } from "@/types/backup.types";

describe("Azure Backups & Business Continuity FinOps Service", () => {
    it("should correctly classify vault environments", () => {
        expect(detectVaultEnvironment({ env: "production" }, "rsv-prod-01", "rg-prod")).toBe("prod");
        expect(detectVaultEnvironment({ env: "dev" }, "rsv-dev-01", "rg-dev")).toBe("dev");
        expect(detectVaultEnvironment(null, "rsv-qa-vault", "rg-test")).toBe("qa");
        expect(detectVaultEnvironment(null, "rsv-stg-backup", "rg-staging")).toBe("staging");
        expect(detectVaultEnvironment(null, "rsv-random", "rg-other")).toBe("unknown");
    });

    it("should normalize storage redundancy models", () => {
        expect(normalizeRedundancy("GeoRedundant")).toBe("GeoRedundant");
        expect(normalizeRedundancy("GRS")).toBe("GeoRedundant");
        expect(normalizeRedundancy("LocallyRedundant")).toBe("LocallyRedundant");
        expect(normalizeRedundancy("LRS")).toBe("LocallyRedundant");
        expect(normalizeRedundancy("ZoneRedundant")).toBe("ZoneRedundant");
        expect(normalizeRedundancy(null)).toBe("LocallyRedundant");
    });

    it("should accurately estimate monthly vault cost with protected instances and storage breakdown", () => {
        const storage = {
            totalStorageGB: 1000,
            snapshotTierGB: 100, // 100 * 0.05 = 5.00
            vaultStandardGB: 800, // 800 * 0.0225 = 18.00
            vaultArchiveGB: 100, // 100 * 0.005 = 0.50
            orphanedStorageGB: 0,
        };
        // 5 protected instances * $10 = 50.00, 1 ASR * $25 = 25.00
        // Total = 5 + 18 + 0.50 + 50 + 25 = 98.50
        const cost = estimateMonthlyVaultCost("LocallyRedundant", storage, 5, 1);
        expect(cost).toBe(98.50);
    });

    it("should generate Orphan Purge remediation for ProtectionStopped items with deleted source resources", () => {
        const mockVault: BackupVaultDetail = {
            id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.RecoveryServices/vaults/rsv-dev",
            name: "rsv-dev",
            resourceGroup: "rg-dev",
            subscriptionId: "sub-1",
            subscriptionName: "Sub 1",
            location: "westus2",
            vaultType: "RecoveryServicesVault",
            skuName: "Standard",
            redundancy: "LocallyRedundant",
            crossRegionRestoreEnabled: false,
            softDeleteEnabled: true,
            softDeleteRetentionDays: 14,
            immutabilityState: "Disabled",
            storageBreakdown: {
                totalStorageGB: 500,
                snapshotTierGB: 0,
                vaultStandardGB: 200,
                vaultArchiveGB: 0,
                orphanedStorageGB: 300,
            },
            protectedItemsCount: 2,
            orphanedItemsCount: 1,
            asrProtectedItemsCount: 0,
            monthlyCostUsd: 35.00,
            billedCostUsd: 35.00,
            costPerGb: 0.07,
            environmentTag: "dev",
            tags: { env: "dev" },
            protectedItems: [
                {
                    id: "item-orphan-1",
                    name: "vm-deleted-legacy",
                    vaultId: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.RecoveryServices/vaults/rsv-dev",
                    vaultName: "rsv-dev",
                    workloadType: "AzureIaasVM",
                    sourceResourceId: null,
                    sourceResourceName: "vm-deleted-legacy",
                    isSourceResourceDeleted: true,
                    protectionState: "ProtectionStopped",
                    policyName: "DevPolicy",
                    retentionDays: 14,
                    backupTier: "VaultStandard",
                    storageConsumedGB: 300,
                    monthlyCostUsd: 15.00,
                    lastBackupStatus: "Warning",
                    lastBackupTime: null,
                    isOrphanCandidate: true,
                },
            ],
            recommendations: [],
        };

        const recs = buildBackupRemediations([mockVault]);
        const orphanRec = recs.find((r) => r.category === "ORPHAN_PURGE");
        expect(orphanRec).toBeDefined();
        expect(orphanRec?.estimatedSavingsUSD).toBe(15.00);
        expect(orphanRec?.commandPayload.azureCli).toContain("az backup protection disable");
        expect(orphanRec?.commandPayload.azureCli).toContain("--delete-backup-data true");
    });

    it("should generate GRS to LRS redundancy optimization for non-prod vaults", () => {
        const mockVault: BackupVaultDetail = {
            id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.RecoveryServices/vaults/rsv-dev-grs",
            name: "rsv-dev-grs",
            resourceGroup: "rg-dev",
            subscriptionId: "sub-1",
            subscriptionName: "Sub 1",
            location: "westus2",
            vaultType: "RecoveryServicesVault",
            skuName: "Standard",
            redundancy: "GeoRedundant",
            crossRegionRestoreEnabled: false,
            softDeleteEnabled: true,
            softDeleteRetentionDays: 14,
            immutabilityState: "Disabled",
            storageBreakdown: {
                totalStorageGB: 1000,
                snapshotTierGB: 0,
                vaultStandardGB: 1000,
                vaultArchiveGB: 0,
                orphanedStorageGB: 0,
            },
            protectedItemsCount: 5,
            orphanedItemsCount: 0,
            asrProtectedItemsCount: 0,
            monthlyCostUsd: 95.00,
            billedCostUsd: 95.00,
            costPerGb: 0.095,
            environmentTag: "dev",
            tags: { env: "dev" },
            protectedItems: [],
            recommendations: [],
        };

        const recs = buildBackupRemediations([mockVault]);
        const redRec = recs.find((r) => r.category === "REDUNDANCY_OPTIMIZATION");
        expect(redRec).toBeDefined();
        // 1000 * 0.045 - 1000 * 0.0225 = 22.50
        expect(redRec?.estimatedSavingsUSD).toBe(22.50);
        expect(redRec?.commandPayload.azureCli).toContain("--storage-redundancy LocallyRedundant");
    });

    it("should aggregate storage breakdown and KPIs accurately", () => {
        const vaults: BackupVaultDetail[] = [
            {
                id: "v1",
                name: "v1",
                resourceGroup: "rg1",
                subscriptionId: "sub1",
                subscriptionName: "sub1",
                location: "eastus",
                vaultType: "RecoveryServicesVault",
                skuName: "Standard",
                redundancy: "LocallyRedundant",
                crossRegionRestoreEnabled: false,
                softDeleteEnabled: true,
                softDeleteRetentionDays: 14,
                immutabilityState: "Disabled",
                storageBreakdown: {
                    totalStorageGB: 1000,
                    snapshotTierGB: 100,
                    vaultStandardGB: 800,
                    vaultArchiveGB: 100,
                    orphanedStorageGB: 0,
                },
                protectedItemsCount: 5,
                orphanedItemsCount: 0,
                asrProtectedItemsCount: 1,
                monthlyCostUsd: 80.00,
                billedCostUsd: 80.00,
                costPerGb: 0.08,
                environmentTag: "prod",
                tags: {},
                protectedItems: [],
                recommendations: [],
            },
        ];

        const breakdown = aggregateStorageBreakdown(vaults);
        expect(breakdown.totalStorageGB).toBe(1000);
        expect(breakdown.snapshotTierGB).toBe(100);
        expect(breakdown.vaultStandardGB).toBe(800);
        expect(breakdown.vaultArchiveGB).toBe(100);

        const kpis = computeBackupsKpis(vaults, []);
        expect(kpis.totalVaultsCount).toBe(1);
        expect(kpis.totalProtectedItemsCount).toBe(5);
        expect(kpis.asrInstancesCount).toBe(1);
        expect(kpis.totalMtdCost).toBe(80.00);
        expect(kpis.healthScore).toBe(100);
    });
});
