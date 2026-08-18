import { describe, it, expect } from "vitest";
import {
    extractVmNameFromManagedBy,
    detectDiskRedundancy,
    detectDiskEnvironment,
    resolveDiskTierCode,
    estimateMonthlyDiskCost,
    buildDiskRemediations,
    computeDisksKpis,
    computeSkuDistribution,
} from "@/services/managedDisks.service";
import { ManagedDiskDetail } from "@/types/managedDisk.types";

describe("Managed Disks Service & FinOps Rules", () => {
    it("should correctly extract VM name and Resource ID from managedBy", () => {
        const managedBy = "/subscriptions/demo-sub-01/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-sql-prod-01";
        const res = extractVmNameFromManagedBy(managedBy);
        expect(res.vmName).toBe("vm-sql-prod-01");
        expect(res.vmId).toBe(managedBy);

        expect(extractVmNameFromManagedBy(null)).toEqual({ vmName: null, vmId: null });
        expect(extractVmNameFromManagedBy(undefined)).toEqual({ vmName: null, vmId: null });
    });

    it("should accurately detect redundancy (LRS vs ZRS)", () => {
        expect(detectDiskRedundancy("Premium_LRS")).toBe("LRS");
        expect(detectDiskRedundancy("StandardSSD_ZRS")).toBe("ZRS");
        expect(detectDiskRedundancy("Premium_ZRS")).toBe("ZRS");
        expect(detectDiskRedundancy("Standard_LRS")).toBe("LRS");
    });

    it("should classify environment tags", () => {
        expect(detectDiskEnvironment({ env: "production" }, "disk-01", "rg-core")).toBe("prod");
        expect(detectDiskEnvironment({ environment: "dev" }, "disk-dev-01", "rg-dev")).toBe("dev");
        expect(detectDiskEnvironment(null, "disk-qa-data", "rg-test")).toBe("qa");
        expect(detectDiskEnvironment(null, "disk-stg-app", "rg-staging")).toBe("staging");
        expect(detectDiskEnvironment(null, "disk-unknown", "rg-random")).toBe("unknown");
    });

    it("should map SKU and size to official Azure tier codes", () => {
        expect(resolveDiskTierCode("Premium_LRS", 128)).toBe("P10");
        expect(resolveDiskTierCode("Premium_LRS", 512)).toBe("P20");
        expect(resolveDiskTierCode("StandardSSD_LRS", 128)).toBe("E10");
        expect(resolveDiskTierCode("Standard_LRS", 128)).toBe("S10");
        expect(resolveDiskTierCode("Premium_LRS", 32)).toBe("P4");
    });

    it("should estimate monthly costs by tier benchmark", () => {
        expect(estimateMonthlyDiskCost("Premium_LRS", 128)).toBe(19.71);
        expect(estimateMonthlyDiskCost("StandardSSD_LRS", 128)).toBe(9.60);
        expect(estimateMonthlyDiskCost("Standard_LRS", 128)).toBe(5.89);
        expect(estimateMonthlyDiskCost("Premium_LRS", 512)).toBe(73.22);
    });

    it("should generate 100% savings remediation for Orphan (Unattached) disks", () => {
        const orphanDisk: ManagedDiskDetail = {
            id: "/subscriptions/sub-1/resourceGroups/rg-test/providers/Microsoft.Compute/disks/disk-orphan",
            name: "disk-orphan",
            resourceGroup: "rg-test",
            subscriptionId: "sub-1",
            subscriptionName: "Sub 1",
            location: "eastus",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P10",
            diskSizeGB: 128,
            diskSizeBytes: 128 * 1024 * 1024 * 1024,
            diskState: "Unattached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: null,
            managedByVmId: null,
            osType: null,
            encryptionType: "PMK",
            burstingEnabled: false,
            monthlyCostUsd: 19.71,
            billedCostUsd: 19.71,
            costPerGb: 0.154,
            environmentTag: "unknown",
            tags: {},
            metrics: {
                avgIops: 0,
                peakIops: 0,
                avgThroughputMbps: 0,
                peakThroughputMbps: 0,
                readOpsCount: 0,
                writeOpsCount: 0,
                isInactive: true,
                telemetryPeriodDays: 14,
                lastTelemetryDate: null,
            },
            recommendations: [],
            isZombieCandidate: true,
        };

        const recs = buildDiskRemediations([orphanDisk]);
        expect(recs.length).toBe(1);
        expect(recs[0].category).toBe("ORPHAN");
        expect(recs[0].estimatedSavingsUSD).toBe(19.71);
        expect(recs[0].commandPayload.azureCli).toContain("az snapshot create");
        expect(recs[0].commandPayload.azureCli).toContain("az disk delete");
    });

    it("should generate Tier Downgrade remediation for Premium SSD in Dev environment with low IOPS", () => {
        const devDisk: ManagedDiskDetail = {
            id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.Compute/disks/disk-dev-premium",
            name: "disk-dev-premium",
            resourceGroup: "rg-dev",
            subscriptionId: "sub-1",
            subscriptionName: "Sub 1",
            location: "eastus",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P10",
            diskSizeGB: 128,
            diskSizeBytes: 128 * 1024 * 1024 * 1024,
            diskState: "Attached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: "vm-dev-01",
            managedByVmId: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-dev-01",
            vmPowerState: "running",
            osType: "Linux",
            encryptionType: "PMK",
            burstingEnabled: false,
            monthlyCostUsd: 19.71,
            billedCostUsd: 19.71,
            costPerGb: 0.154,
            environmentTag: "dev",
            tags: { env: "dev" },
            metrics: {
                avgIops: 12,
                peakIops: 35,
                avgThroughputMbps: 0.5,
                peakThroughputMbps: 2.0,
                readOpsCount: 100000,
                writeOpsCount: 50000,
                isInactive: false,
                telemetryPeriodDays: 14,
                lastTelemetryDate: null,
            },
            recommendations: [],
            isZombieCandidate: false,
        };

        const recs = buildDiskRemediations([devDisk]);
        expect(recs.length).toBe(1);
        expect(recs[0].category).toBe("TIER_DOWNGRADE");
        expect(recs[0].estimatedSavingsUSD).toBe(10.11); // 19.71 - 9.60 = 10.11
        expect(recs[0].commandPayload.azureCli).toContain("--sku StandardSSD_LRS");
    });
});
