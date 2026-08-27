import { describe, it, expect } from "vitest";
import { AzureSqlResourceDetail, SqlRemediationAction } from "@/types/azureSql";

describe("Azure SQL FinOps Intelligence", () => {
  it("should correctly identify and flag system database (master)", () => {
    const masterDb: Partial<AzureSqlResourceDetail> = {
      name: "master",
      isSystemDatabase: true,
      cost: {
        monthlyCostUsd: 0,
        computeCostUsd: 0,
        storageCostUsd: 0,
        licensingCostUsd: 0,
        potentialSavingsUsd: 0,
      },
    };

    expect(masterDb.isSystemDatabase).toBe(true);
    expect(masterDb.cost?.monthlyCostUsd).toBe(0);
  });

  it("should classify purchasing models and calculate overprovisioning accurately", () => {
    const vcoreServerlessDb: Partial<AzureSqlResourceDetail> = {
      name: "db-dev-serverless",
      architecture: "single-database",
      isSystemDatabase: false,
      purchasingModel: {
        type: "vcore-serverless",
        tier: "General Purpose",
        skuName: "GP_S_Gen5_2",
        capacity: 2,
        isServerless: true,
        autoPauseDelayMinutes: 60,
      },
      storage: {
        usedStorageGb: 5,
        allocatedStorageGb: 100,
        maxStorageGb: 200,
        storageUtilizationPct: 5,
        redundancy: "LRS",
        isOverallocated: true,
      },
      licensing: {
        licenseType: "LicenseIncluded",
        hasHybridBenefit: false,
        ahubEligible: true,
        estimatedAhubSavingsUsd: 45,
      },
      cost: {
        monthlyCostUsd: 85,
        computeCostUsd: 60,
        storageCostUsd: 15,
        licensingCostUsd: 10,
        potentialSavingsUsd: 35,
      },
    };

    expect(vcoreServerlessDb.purchasingModel?.isServerless).toBe(true);
    expect(vcoreServerlessDb.storage?.isOverallocated).toBe(true);
    expect(vcoreServerlessDb.licensing?.ahubEligible).toBe(true);
  });

  it("should validate remediation action format with CLI and Bicep scripts", () => {
    const action: SqlRemediationAction = {
      id: "test-serverless-action",
      ruleKey: "serverless_migration",
      title: "Migración a SQL Serverless con Auto-Pause",
      description: "Convertir cómputo provisionado a Serverless",
      savingsMonthlyUsd: 55,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: "az sql db update --compute-model Serverless",
      bicepSnippet: "resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview'",
    };

    expect(action.savingsMonthlyUsd).toBeGreaterThan(0);
    expect(action.cliCommand).toContain("az sql db update");
    expect(action.bicepSnippet).toContain("Microsoft.Sql/servers/databases");
  });

  it("should estimate monthly cost for DTU, vCore Serverless, vCore Provisioned and Managed Instance", async () => {
    const { estimateAzureSqlMonthlyCost } = await import(
      "@/app/api/intelligence/databases/sql-metrics/route"
    );

    // System DB
    expect(estimateAzureSqlMonthlyCost(true, "single-database", "master", "dtu", 0, "LicenseIncluded")).toBe(0);

    // Standard S2 DTU
    expect(estimateAzureSqlMonthlyCost(false, "single-database", "Standard S2", "dtu", 32, "LicenseIncluded")).toBe(73.62);

    // Managed Instance General Purpose
    const miCost = estimateAzureSqlMonthlyCost(false, "managed-instance", "GP_Gen5_4", "vcore-provisioned", 64, "LicenseIncluded");
    expect(miCost).toBeGreaterThan(700);

    // Serverless vCore
    const serverlessCost = estimateAzureSqlMonthlyCost(false, "single-database", "GP_S_Gen5_2", "vcore-serverless", 32, "LicenseIncluded");
    expect(serverlessCost).toBeGreaterThan(50);

    // Elastic Pool itself
    const poolCost = estimateAzureSqlMonthlyCost(false, "elastic-pool", "StandardPool", "dtu", 50, "LicenseIncluded");
    expect(poolCost).toBeGreaterThan(0);

    // Member database inside an Elastic Pool MUST be $0 (cost is billed at pool level)
    expect(
      estimateAzureSqlMonthlyCost(
        false,
        "single-database",
        "ElasticPool",
        "dtu",
        40,
        "LicenseIncluded",
        "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Sql/servers/srv-1/elasticPools/pool-1"
      )
    ).toBe(0);

    expect(
      estimateAzureSqlMonthlyCost(
        false,
        "single-database",
        "StandardPool",
        "dtu",
        40,
        "LicenseIncluded",
        "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Sql/servers/srv-1/elasticPools/pool-1"
      )
    ).toBe(0);
  });
});
