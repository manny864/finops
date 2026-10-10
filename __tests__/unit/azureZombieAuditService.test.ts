import { describe, it, expect } from "vitest";
import {
  computeZombieSummaryMetrics,
  computeHardWasteByIssue,
  GENERIC_ZOMBIE_ISSUE_NAME,
  formatResourceType,
  getMockZombieAuditPayload,
  assembleLiveZombieAudit,
} from "@/services/azureZombieAudit.service";
import { ZombieResourceItem } from "@/types/azureZombieAudit.types";

describe("azureZombieAudit.service", () => {
  describe("formatResourceType", () => {
    it("formats known Azure resource types to human-readable Spanish names", () => {
      expect(formatResourceType("microsoft.compute/disks")).toBe("Disco Administrado");
      expect(formatResourceType("microsoft.network/publicipaddresses")).toBe("Dirección IP Pública");
      expect(formatResourceType("microsoft.web/serverfarms")).toBe("App Service Plan");
    });
  });

  describe("computeZombieSummaryMetrics", () => {
    it("computes hard waste, untagged, and exempted metrics correctly", () => {
      const mockItems: ZombieResourceItem[] = [
        {
          id: "/res1",
          name: "disk-1",
          resourceType: "microsoft.compute/disks",
          typeDisplayName: "Disco Administrado",
          location: "eastus",
          resourceGroup: "rg1",
          subscriptionId: "sub1",
          subscriptionName: "Sub 1",
          category: "HARD_WASTE",
          issueType: "UNATTACHED_DISK",
          issueDisplayName: "Disco Huérfano",
          severity: "HIGH",
          monthlySavingsUSD: 19.05,
          hasTags: true,
          currentTags: {},
          isExempted: false,
        },
        {
          id: "/res2",
          name: "nic-1",
          resourceType: "microsoft.network/networkinterfaces",
          typeDisplayName: "NIC",
          location: "eastus",
          resourceGroup: "rg1",
          subscriptionId: "sub1",
          subscriptionName: "Sub 1",
          category: "SOFT_WASTE_TAGS",
          issueType: "MISSING_FINOPS_TAGS",
          issueDisplayName: "Sin Etiquetas",
          severity: "LOW",
          monthlySavingsUSD: 0,
          hasTags: false,
          currentTags: {},
          isExempted: false,
        },
        {
          id: "/res3",
          name: "disk-2",
          resourceType: "microsoft.compute/disks",
          typeDisplayName: "Disco Administrado",
          location: "eastus",
          resourceGroup: "rg1",
          subscriptionId: "sub1",
          subscriptionName: "Sub 1",
          category: "HARD_WASTE",
          issueType: "UNATTACHED_DISK",
          issueDisplayName: "Disco Huérfano",
          severity: "MEDIUM",
          monthlySavingsUSD: 25.0,
          hasTags: true,
          currentTags: {},
          isExempted: true,
        },
      ];

      const summary = computeZombieSummaryMetrics(mockItems);
      expect(summary.hardWasteZombiesCount).toBe(1);
      expect(summary.untaggedResourcesCount).toBe(1);
      expect(summary.exemptedResourcesCount).toBe(1);
      expect(summary.totalPotentialSavingsUSD).toBe(19.05);
      expect(summary.totalScannedResources).toBe(3);
    });
  });

  describe("getMockZombieAuditPayload & assembleLiveZombieAudit", () => {
    it("returns deterministic mock payload with valid items", () => {
      const payload = getMockZombieAuditPayload("demo-tenant");
      expect(payload.source).toBe("mock");
      expect(payload.metrics.resources.length).toBeGreaterThan(0);
      expect(payload.metrics.totalPotentialSavingsUSD).toBeGreaterThan(0);
    });

    it("assembles live audit payload merging exemptions and local tag cache", () => {
      const exemptions = new Map<string, { reason: string; exemptedAt: string }>();
      exemptions.set("/sub1/rg1/disk-unattached", { reason: "DR Testing", exemptedAt: "2026-08-01" });

      const localTags = new Map<string, Record<string, string>>();
      localTags.set("/sub1/rg1/disk-unattached", { Environment: "Prod", CostCenter: "DevOps", Owner: "Ops" });

      const payload = assembleLiveZombieAudit({
        rawItems: [
          {
            id: "/sub1/rg1/disk-unattached",
            name: "disk-unattached",
            type: "microsoft.compute/disks",
            monthlyCost: 20,
            tags: {},
          },
        ],
        exemptions,
        localTags,
      });

      expect(payload.source).toBe("live");
      expect(payload.metrics.resources[0].isExempted).toBe(true);
      expect(payload.metrics.resources[0].hasTags).toBe(true);
      expect(payload.metrics.resources[0].currentTags.Environment).toBe("Prod");
    });
  });

  describe("computeHardWasteByIssue", () => {
    const item = (over: Partial<ZombieResourceItem>): ZombieResourceItem => ({
      id: "/r",
      name: "r",
      resourceType: "microsoft.compute/disks",
      typeDisplayName: "Disco Administrado",
      location: "eastus",
      resourceGroup: "rg1",
      subscriptionId: "sub1",
      subscriptionName: "Sub 1",
      category: "HARD_WASTE",
      issueType: "UNATTACHED_DISK",
      issueDisplayName: "Disco Huérfano (Unattached)",
      severity: "HIGH",
      monthlySavingsUSD: 10,
      hasTags: true,
      currentTags: {},
      isExempted: false,
      ...over,
    });

    it("suma por motivo sólo el desperdicio duro no eximido, de mayor a menor", () => {
      const rows = computeHardWasteByIssue([
        item({ monthlySavingsUSD: 10.1 }),
        item({ monthlySavingsUSD: 20.2 }),
        item({ issueDisplayName: "IP Pública Huérfana", monthlySavingsUSD: 4 }),
        item({ monthlySavingsUSD: 999, isExempted: true }),
        item({ monthlySavingsUSD: 0, category: "SOFT_WASTE_TAGS", issueDisplayName: "Sin Etiquetas FinOps Mínimas" }),
      ]);

      expect(rows).toEqual([
        { reason: "Disco Huérfano (Unattached)", affected: 2, wasteUsd: 30.3 }, // 10.1 + 20.2 sin el ruido de coma flotante
        { reason: "IP Pública Huérfana", affected: 1, wasteUsd: 4 },
      ]);
    });

    it("un hallazgo con el motivo genérico se rotula por su tipo de recurso, no todos juntos bajo «Recurso Zombi»", () => {
      const rows = computeHardWasteByIssue([
        item({ issueDisplayName: GENERIC_ZOMBIE_ISSUE_NAME, typeDisplayName: "VNet Gateway", monthlySavingsUSD: 130 }),
        item({ issueDisplayName: GENERIC_ZOMBIE_ISSUE_NAME, typeDisplayName: "Load Balancer", monthlySavingsUSD: 18 }),
      ]);

      expect(rows.map((r) => r.reason)).toEqual(["VNet Gateway", "Load Balancer"]);
    });

    it("el escaneo real clasifica así: un VNet Gateway con etiquetas es desperdicio duro y trae el motivo genérico", () => {
      const { metrics } = assembleLiveZombieAudit({
        rawItems: [
          { id: "/s/gw", name: "gw", type: "microsoft.network/virtualnetworkgateways", monthlyCost: 130, tags: { Environment: "P", CostCenter: "C", Owner: "O" } },
        ],
        exemptions: new Map(),
        localTags: new Map(),
      });

      expect(computeHardWasteByIssue(metrics.resources)).toEqual([{ reason: "VNet Gateway", affected: 1, wasteUsd: 130 }]);
    });

    it("sin desperdicio duro: lista vacía", () => {
      expect(computeHardWasteByIssue([])).toEqual([]);
      expect(computeHardWasteByIssue([item({ isExempted: true })])).toEqual([]);
    });
  });
});
