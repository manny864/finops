import { describe, expect, it } from "vitest";
import { formatCurrencyAxis } from "@/lib/whiteboard";
import {
  extractReadableResourceName,
  readCostCenter,
  buildQuickWinCliCommand,
} from "@/services/whiteboard.service";

describe("formatCurrencyAxis", () => {
  it("shows whole dollars for datasets below one thousand", () => {
    expect(formatCurrencyAxis(0, 450.66)).toBe("$0");
    expect(formatCurrencyAxis(50, 450.66)).toBe("$50");
    expect(formatCurrencyAxis(450.66, 450.66)).toBe("$451");
  });

  it("shows one-decimal thousands for larger datasets", () => {
    expect(formatCurrencyAxis(1500, 4200)).toBe("$1.5k");
    expect(formatCurrencyAxis(4000, 4200)).toBe("$4.0k");
  });

  it("fails closed for non-finite values", () => {
    expect(formatCurrencyAxis(Number.NaN, 450)).toBe("$0");
  });
});

describe("extractReadableResourceName", () => {
  it("extracts resource name from full ARM path", () => {
    const armId =
      "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-app-01";
    expect(extractReadableResourceName("", armId)).toBe("vm-prod-app-01");
  });

  it("prefers clean impactedValue if provided", () => {
    expect(extractReadableResourceName("vm-prod-app-01", "")).toBe("vm-prod-app-01");
  });

  it("falls back to default when empty", () => {
    expect(extractReadableResourceName("", "")).toBe("Recurso Azure");
  });
});

describe("readCostCenter", () => {
  it("reads CostCenter from JSON string tags", () => {
    expect(readCostCenter(JSON.stringify({ CostCenter: "Infrastructure" }))).toBe(
      "Infrastructure"
    );
  });

  it("reads CostCenter from object tags", () => {
    expect(readCostCenter({ CostCenter: "Platform" })).toBe("Platform");
  });

  it("returns 'Sin asignar' when tag is missing or null", () => {
    expect(readCostCenter(null)).toBe("Sin asignar");
    expect(readCostCenter({})).toBe("Sin asignar");
  });
});

describe("buildQuickWinCliCommand", () => {
  it("builds correct CLI command for rightsizing", () => {
    const cmd = buildQuickWinCliCommand({
      actionType: "rightsizing",
      resourceName: "vm-app-01",
    });
    expect(cmd).toContain('az vm update --resource-group "rg-prod" --name "vm-app-01"');
  });

  it("builds correct CLI command for delete_orphan", () => {
    const cmd = buildQuickWinCliCommand({
      actionType: "delete_orphan",
      resourceName: "disk-backup-01",
    });
    expect(cmd).toContain('az disk delete --resource-group "rg-storage" --name "disk-backup-01"');
  });
});