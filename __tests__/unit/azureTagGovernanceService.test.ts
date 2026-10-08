import { describe, it, expect } from "vitest";
import {
  evaluateResourceMissingTags,
  inferTagsFromNaming,
  suggestTagValues,
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

  it("inferTagsFromNaming sugiere sólo con indicios y dice en qué se basa", () => {
    expect(inferTagsFromNaming("vm-prod-mysql-01", "Microsoft.Compute/virtualMachines", "rg-cscs-prod")).toEqual({
      Environment: { value: "prod", basis: "name" },
      Role: { value: "database", basis: "name" },
      Department: { value: "DataPlatform", basis: "role" },
    });
    expect(inferTagsFromNaming("api-gateway-dev", "Microsoft.ApiManagement/service", "rg-dev-sandbox")).toEqual({
      Environment: { value: "dev", basis: "name" },
      Role: { value: "api", basis: "name" },
      Department: { value: "Engineering", basis: "role" },
    });
    expect(inferTagsFromNaming("rsv-backup-vault", "Microsoft.RecoveryServices/vaults", "rg-finops-core")).toEqual({
      Role: { value: "backup", basis: "name" },
      CostCenter: { value: "FinOps", basis: "resource_group" },
      Department: { value: "SecurityOps", basis: "role" },
    });
    // Un disco es "storage", un valor permitido (antes "database-disk", que no lo era).
    expect(inferTagsFromNaming("osdisk-01", "Microsoft.Compute/disks", "rg-x").Role).toEqual({ value: "storage", basis: "name" });
    expect(inferTagsFromNaming("x-01", "Microsoft.Network/virtualNetworks", "rg-x").Role).toEqual({ value: "network", basis: "type" });
    // Sin indicios no hay "prod", "worker", "Engineering" ni "CloudOps" por defecto.
    expect(inferTagsFromNaming("vm-01", "Microsoft.Compute/virtualMachines", "rg-x")).toEqual({});
  });

  it("suggestTagValues normaliza el valor actual, respeta los válidos e infiere los faltantes", () => {
    const aliases = new Map([["environment", [{ alias: "production", canonicalValue: "prod" }]]]);
    const r = { resourceName: "vm-web-dev-01", resourceType: "Microsoft.Compute/virtualMachines", resourceGroup: "rg-x" };
    expect(
      suggestTagValues({ ...r, currentTags: { environment: "Production", Role: "api", CostCenter: "Finance" } }, DEFAULT_MANDATORY_TAG_POLICIES, aliases)
    ).toEqual({
      Environment: { value: "prod", method: "alias", confidence: 0.95 },
      Department: { value: "Engineering", method: "naming", basis: "role", confidence: 0.5 },
    });
    expect(suggestTagValues(r, DEFAULT_MANDATORY_TAG_POLICIES).Environment).toEqual({
      value: "dev",
      method: "naming",
      basis: "name",
      confidence: 0.8,
    });
  });

  it("suggestTagValues sugiere dentro del vocabulario del tenant y nunca fuera", () => {
    const r = { resourceName: "app-dev-01", resourceType: "", resourceGroup: "rg-x" };
    const pol = (allowedValues: string[]) => [{ id: "p", tagName: "Environment", isRequired: true, allowedValues }];
    expect(suggestTagValues(r, pol(["DEV", "PROD"])).Environment).toEqual({
      value: "DEV",
      method: "naming",
      basis: "name",
      confidence: 0.8,
    });
    expect(suggestTagValues(r, pol(["Production", "Development"]))).not.toHaveProperty("Environment");
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
