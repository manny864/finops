import { describe, it, expect } from "vitest";
import {
  calculateBackupMonthlyCost,
  computeOrphanBackupsMetrics,
  getMockOrphanBackupsSummary,
} from "@/services/azureOrphanBackups.service";
import { OrphanBackupItem } from "@/types/azureOrphanBackups.types";

describe("Azure Orphan Backups Service", () => {
  it("calculateBackupMonthlyCost calculates base instance fee + storage rate", () => {
    // AzureIaasVM: base 10.0 + 100GB * 0.0224 = 10.0 + 2.24 = 12.24
    const vmCost = calculateBackupMonthlyCost("AzureIaasVM", 100);
    expect(vmCost).toBe(12.24);

    // AzureWorkload: base 8.0 + 50GB * 0.0224 = 8.0 + 1.12 = 9.12
    const sqlCost = calculateBackupMonthlyCost("AzureWorkload", 50);
    expect(sqlCost).toBe(9.12);

    // AzureStorage: base 5.0 + 200GB * 0.0224 = 5.0 + 4.48 = 9.48
    const storageCost = calculateBackupMonthlyCost("AzureStorage", 200);
    expect(storageCost).toBe(9.48);
  });

  it("computeOrphanBackupsMetrics accurately sums active waste and excludes exempted items", () => {
    const mockBackups: OrphanBackupItem[] = [
      {
        id: "b1",
        name: "vm-orphan-1",
        workloadType: "AzureIaasVM",
        vaultName: "rsv-prod",
        vaultId: "/vaults/rsv-prod",
        location: "eastus",
        resourceGroup: "rg-backups",
        subscriptionId: "sub-1",
        subscriptionName: "Sub 1",
        originalResourceId: "/vms/vm-orphan-1",
        storageConsumedGB: 100,
        recoveryPointsCount: 14,
        isSoftDeleted: false,
        monthlyCostUSD: 12.24,
        isExempted: false,
      },
      {
        id: "b2",
        name: "sql-orphan-2",
        workloadType: "AzureWorkload",
        vaultName: "rsv-prod",
        vaultId: "/vaults/rsv-prod",
        location: "eastus",
        resourceGroup: "rg-backups",
        subscriptionId: "sub-1",
        subscriptionName: "Sub 1",
        originalResourceId: "/sqls/sql-orphan-2",
        storageConsumedGB: 50,
        recoveryPointsCount: 20,
        isSoftDeleted: false,
        monthlyCostUSD: 9.12,
        isExempted: false,
      },
      {
        id: "b3",
        name: "vm-exempted-3",
        workloadType: "AzureIaasVM",
        vaultName: "rsv-prod",
        vaultId: "/vaults/rsv-prod",
        location: "eastus",
        resourceGroup: "rg-backups",
        subscriptionId: "sub-1",
        subscriptionName: "Sub 1",
        originalResourceId: "/vms/vm-exempted-3",
        storageConsumedGB: 300,
        recoveryPointsCount: 60,
        isSoftDeleted: false,
        monthlyCostUSD: 16.72,
        isExempted: true, // Should not count towards active waste
        exemptionReason: "Legal Compliance",
      },
    ];

    const summary = computeOrphanBackupsMetrics(mockBackups);

    expect(summary.orphanItemsCount).toBe(2); // b1 and b2
    expect(summary.exemptedItemsCount).toBe(1); // b3
    expect(summary.totalMonthlyWasteUSD).toBe(21.36); // 12.24 + 9.12
    expect(summary.totalStorageConsumedGB).toBe(150); // 100 + 50
  });

  it("getMockOrphanBackupsSummary returns robust mock summary for demo tenants", () => {
    const summary = getMockOrphanBackupsSummary("demo_tenant");
    expect(summary.backups.length).toBeGreaterThan(0);
    expect(summary.orphanItemsCount).toBeGreaterThan(0);
    expect(summary.totalMonthlyWasteUSD).toBeGreaterThan(0);
    expect(summary.totalStorageConsumedGB).toBeGreaterThan(0);
  });
});
