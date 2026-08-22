import { describe, it, expect } from "vitest";
import {
  evaluateResourceMissingTags,
  suggestTagsForResource,
  formatResourceTypeDisplay,
  getMockTagGovernanceSummary,
  DEFAULT_MANDATORY_TAG_POLICIES,
} from "@/services/azureTagGovernance.service";

describe("Azure Tag Governance Service", () => {
  it("formatResourceTypeDisplay extracts clean upper-case type name", () => {
    expect(formatResourceTypeDisplay("Microsoft.Compute/virtualMachines")).toBe("VIRTUALMACHINES");
    expect(formatResourceTypeDisplay("Microsoft.Storage/storageAccounts")).toBe("STORAGEACCOUNTS");
    expect(formatResourceTypeDisplay("Microsoft.Compute/disks")).toBe("DISKS");
  });

  it("evaluateResourceMissingTags correctly identifies missing mandatory tags", () => {
    // Caso 1: Tiene las 4 tags obligatorias
    const completeTags = {
      Environment: "prod",
      Role: "database",
      CostCenter: "CorePlatform",
      Department: "CloudOps",
    };
    const missingNone = evaluateResourceMissingTags(completeTags, DEFAULT_MANDATORY_TAG_POLICIES);
    expect(missingNone).toHaveLength(0);

    // Caso 2: Falta Role y CostCenter (case insensitive test)
    const partialTags = {
      environment: "dev",
      department: "DataTeam",
    };
    const missingTwo = evaluateResourceMissingTags(partialTags, DEFAULT_MANDATORY_TAG_POLICIES);
    expect(missingTwo).toContain("Role");
    expect(missingTwo).toContain("CostCenter");
    expect(missingTwo).not.toContain("Environment");
    expect(missingTwo).not.toContain("Department");

    // Caso 3: Tags vacías o con espacios en blanco
    const emptyTags = {
      Environment: "   ",
      Role: "",
      CostCenter: "FinOps",
      Department: "SecurityOps",
    };
    const missingEmpty = evaluateResourceMissingTags(emptyTags, DEFAULT_MANDATORY_TAG_POLICIES);
    expect(missingEmpty).toContain("Environment");
    expect(missingEmpty).toContain("Role");
    expect(missingEmpty).not.toContain("CostCenter");
    expect(missingEmpty).not.toContain("Department");
  });

  it("suggestTagsForResource infers sensible tags based on naming heuristics", () => {
    // Inferencia de DB de producción
    const dbSug = suggestTagsForResource("vm-prod-mysql-01", "Microsoft.Compute/virtualMachines", "rg-cscs-prod");
    expect(dbSug.Environment).toBe("prod");
    expect(dbSug.Role).toBe("database");
    expect(dbSug.Department).toBe("DataPlatform");

    // Inferencia de API de desarrollo
    const apiSug = suggestTagsForResource("api-gateway-dev", "Microsoft.ApiManagement/service", "rg-dev-sandbox");
    expect(apiSug.Environment).toBe("dev");
    expect(apiSug.Role).toBe("api");
    expect(apiSug.Department).toBe("Engineering");

    // Inferencia de Vault de Backup con RG FinOps
    const backupSug = suggestTagsForResource("rsv-backup-vault", "Microsoft.RecoveryServices/vaults", "rg-finops-core");
    expect(backupSug.Role).toBe("backup");
    expect(backupSug.CostCenter).toBe("FinOps");
    expect(backupSug.Department).toBe("SecurityOps");
  });

  it("getMockTagGovernanceSummary returns a comprehensive, consistent summary for demo tenants", () => {
    const summary = getMockTagGovernanceSummary("demo-tenant");
    expect(summary.totalScannedResources).toBeGreaterThan(0);
    expect(summary.totalScannedResourceGroups).toBeGreaterThan(0);
    expect(summary.overallCompliancePercentage).toBe(83.0);
    expect(summary.resources.length).toBeGreaterThan(0);
    expect(summary.resourceGroups.length).toBeGreaterThan(0);
    expect(summary.mandatoryPolicies).toHaveLength(4);
  });
});
