import { describe, it, expect } from "vitest";
import {
    detectDataLakeRedundancy,
    detectDataLakeEnvironment,
    buildDataLakeRemediations,
    computeDataLakeKpis,
    aggregateDataLakeStorage,
} from "@/services/azureDataLakeGen2.service";
import { DataLakeAccountDetail } from "@/types/dataLakeGen2.types";
import { esperarQueRindanLasClaves } from "./recomendacionesRinden";

describe("Azure Data Lake Storage Gen2 FinOps Service", () => {
    it("should correctly detect Data Lake redundancy model from SKU", () => {
        expect(detectDataLakeRedundancy("Standard_LRS")).toBe("LRS");
        expect(detectDataLakeRedundancy("Standard_ZRS")).toBe("ZRS");
        expect(detectDataLakeRedundancy("Standard_GRS")).toBe("GRS");
        expect(detectDataLakeRedundancy("Standard_GZRS")).toBe("GZRS");
        expect(detectDataLakeRedundancy(null)).toBe("LRS");
    });

    it("should correctly detect environment tag for data lake accounts", () => {
        expect(detectDataLakeEnvironment({ env: "production" }, "stlakeprod", "rg-prod")).toBe("prod");
        expect(detectDataLakeEnvironment({ env: "dev" }, "stakedev01", "rg-dev")).toBe("dev");
        expect(detectDataLakeEnvironment(null, "stlakestaging", "rg-stg")).toBe("staging");
        expect(detectDataLakeEnvironment(null, "stlakeuat", "rg-qa")).toBe("qa");
        expect(detectDataLakeEnvironment(null, "stlakegeneral", "rg-storage")).toBe("unknown");
    });

    it("should generate Lifecycle Tiering remediation for hot data > 1 TB without policy", () => {
        const mockAccount: DataLakeAccountDetail = {
            id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/stlakeprod",
            name: "stlakeprod",
            resourceGroup: "rg-prod",
            subscriptionId: "sub-1",
            subscriptionName: "Sub 1",
            location: "eastus2",
            skuName: "Standard_LRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "LRS",
            hasLifecyclePolicy: false,
            lifecycleRulesCount: 0,
            privateEndpointsCount: 1,
            publicAccessBlocked: true,
            storageBreakdown: {
                totalStorageBytes: 10 * 1024 * 1024 * 1024 * 1024,
                totalStorageGB: 10 * 1024, // 10,240 GB
                totalStorageTB: 10.0,
                hotTierBytes: 10 * 1024 * 1024 * 1024 * 1024,
                coolTierBytes: 0,
                coldTierBytes: 0,
                archiveTierBytes: 0,
                hotTierGB: 10 * 1024,
                coolTierGB: 0,
                coldTierGB: 0,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 1000000,
                readOpsCount: 600000,
                writeOpsCount: 300000,
                listOpsCount: 100000,
                egressBytes: 1024,
                ingressBytes: 1024,
                storageCostUSD: 188.40,
                transactionsCostUSD: 2.50,
                transactionCostRatio: 0.013,
                hasSmallFilesAnomaly: false,
            },
            monthlyCostUsd: 190.90,
            billedCostUsd: 190.90,
            costPerTb: 19.09,
            environmentTag: "prod",
            tags: {},
            recommendations: [],
        };

        const recs = buildDataLakeRemediations([mockAccount]);
        esperarQueRindanLasClaves(recs, "DataLakeFinops");
        const lifecycleRec = recs.find((r) => r.category === "LIFECYCLE_TIERING");
        expect(lifecycleRec).toBeDefined();
        expect(lifecycleRec?.estimatedSavingsUSD).toBeGreaterThan(0);
        expect(lifecycleRec?.commandPayload.azureCli).toContain("az storage account management-policy create");
        expect(lifecycleRec?.commandPayload.jsonPolicy).toBeDefined();
    });

    it("should generate Redundancy Optimization for non-prod accounts with GRS/ZRS", () => {
        const mockDevAccount: DataLakeAccountDetail = {
            id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/stlakedev",
            name: "stlakedev",
            resourceGroup: "rg-dev",
            subscriptionId: "sub-1",
            subscriptionName: "Sub 1",
            location: "eastus2",
            skuName: "Standard_GRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "GRS",
            hasLifecyclePolicy: true,
            lifecycleRulesCount: 1,
            privateEndpointsCount: 0,
            publicAccessBlocked: false,
            storageBreakdown: {
                totalStorageBytes: 2 * 1024 * 1024 * 1024 * 1024,
                totalStorageGB: 2 * 1024,
                totalStorageTB: 2.0,
                hotTierBytes: 2 * 1024 * 1024 * 1024 * 1024,
                coolTierBytes: 0,
                coldTierBytes: 0,
                archiveTierBytes: 0,
                hotTierGB: 2 * 1024,
                coolTierGB: 0,
                coldTierGB: 0,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 500000,
                readOpsCount: 300000,
                writeOpsCount: 200000,
                listOpsCount: 0,
                egressBytes: 500,
                ingressBytes: 500,
                storageCostUSD: 75.00,
                transactionsCostUSD: 1.00,
                transactionCostRatio: 0.013,
                hasSmallFilesAnomaly: false,
            },
            monthlyCostUsd: 76.00,
            billedCostUsd: 76.00,
            costPerTb: 38.00,
            environmentTag: "dev",
            tags: { env: "dev" },
            recommendations: [],
        };

        const recs = buildDataLakeRemediations([mockDevAccount]);
        esperarQueRindanLasClaves(recs, "DataLakeFinops");
        const redRec = recs.find((r) => r.category === "REDUNDANCY_OPTIMIZATION");
        expect(redRec).toBeDefined();
        expect(redRec?.estimatedSavingsUSD).toBe(38.00); // 50% of $76
        expect(redRec?.commandPayload.azureCli).toContain("--sku Standard_LRS");
    });

    it("should generate Storage Reserved Capacity recommendation if prod storage >= 100 TB", () => {
        const mockProdFleet: DataLakeAccountDetail = {
            id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/stlakeprodlarge",
            name: "stlakeprodlarge",
            resourceGroup: "rg-prod",
            subscriptionId: "sub-1",
            subscriptionName: "Sub 1",
            location: "eastus2",
            skuName: "Standard_LRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "LRS",
            hasLifecyclePolicy: true,
            lifecycleRulesCount: 1,
            privateEndpointsCount: 2,
            publicAccessBlocked: true,
            storageBreakdown: {
                totalStorageBytes: 120 * 1024 * 1024 * 1024 * 1024, // 120 TB
                totalStorageGB: 120 * 1024,
                totalStorageTB: 120.0,
                hotTierBytes: 120 * 1024 * 1024 * 1024 * 1024,
                coolTierBytes: 0,
                coldTierBytes: 0,
                archiveTierBytes: 0,
                hotTierGB: 120 * 1024,
                coolTierGB: 0,
                coldTierGB: 0,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 10000000,
                readOpsCount: 5000000,
                writeOpsCount: 5000000,
                listOpsCount: 0,
                egressBytes: 0,
                ingressBytes: 0,
                storageCostUSD: 2260.00,
                transactionsCostUSD: 20.00,
                transactionCostRatio: 0.008,
                hasSmallFilesAnomaly: false,
            },
            monthlyCostUsd: 2280.00,
            billedCostUsd: 2280.00,
            costPerTb: 19.00,
            environmentTag: "prod",
            tags: { env: "prod" },
            recommendations: [],
        };

        const recs = buildDataLakeRemediations([mockProdFleet]);
        esperarQueRindanLasClaves(recs, "DataLakeFinops");
        const resRec = recs.find((r) => r.category === "STORAGE_RESERVATION");
        expect(resRec).toBeDefined();
        expect(resRec?.estimatedSavingsUSD).toBeCloseTo(2280.00 * 0.35, 1);
    });

    it("should compute KPIs and aggregate storage breakdown correctly", () => {
        const account: DataLakeAccountDetail = {
            id: "a1",
            name: "a1",
            resourceGroup: "rg1",
            subscriptionId: "sub1",
            subscriptionName: "sub1",
            location: "eastus",
            skuName: "Standard_LRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "LRS",
            hasLifecyclePolicy: true,
            lifecycleRulesCount: 1,
            privateEndpointsCount: 1,
            publicAccessBlocked: true,
            storageBreakdown: {
                totalStorageBytes: 10 * 1024 * 1024 * 1024 * 1024, // 10 TB
                totalStorageGB: 10 * 1024,
                totalStorageTB: 10.0,
                hotTierBytes: 6 * 1024 * 1024 * 1024 * 1024,
                coolTierBytes: 4 * 1024 * 1024 * 1024 * 1024,
                coldTierBytes: 0,
                archiveTierBytes: 0,
                hotTierGB: 6 * 1024,
                coolTierGB: 4 * 1024,
                coldTierGB: 0,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 1000,
                readOpsCount: 500,
                writeOpsCount: 500,
                listOpsCount: 0,
                egressBytes: 0,
                ingressBytes: 0,
                storageCostUSD: 150.00,
                transactionsCostUSD: 10.00,
                transactionCostRatio: 0.062,
                hasSmallFilesAnomaly: false,
            },
            monthlyCostUsd: 160.00,
            billedCostUsd: 160.00,
            costPerTb: 16.00,
            environmentTag: "prod",
            tags: {},
            recommendations: [],
        };

        const breakdown = aggregateDataLakeStorage([account]);
        expect(breakdown.totalStorageTB).toBe(10.0);
        expect(breakdown.hotTierGB).toBe(6144);
        expect(breakdown.coolTierGB).toBe(4096);

        const kpis = computeDataLakeKpis([account], []);
        expect(kpis.totalAccountsCount).toBe(1);
        expect(kpis.totalMtdCost).toBe(160.00);
        expect(kpis.totalStorageTB).toBe(10.0);
        expect(kpis.costPerTbManaged).toBe(16.00);
        expect(kpis.healthScore).toBe(100);
    });
});
