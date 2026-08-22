import { describe, it, expect } from "vitest";
import {
  normalizeStrategy,
  deriveSharedResourceType,
  isValidResourceType,
  deriveAllocationStatus,
  validateTargets,
  calculateAllocation,
  calculateProportionalTargets,
  buildAllocationSummary,
  generateAllocationRecommendations,
  getMockAllocationPayload,
  costCenterColor,
} from "@/services/azureCostAllocation.service";
import type { SharedResourceType } from "@/types/azureCostAllocation.types";

describe("Cost Allocation — normalización", () => {
  it("deriva el tipo de recurso compartido desde el resource ID", () => {
    expect(deriveSharedResourceType("/subs/x/providers/Microsoft.Network/expressRouteCircuits/er1")).toBe("ExpressRoute");
    expect(deriveSharedResourceType("/subs/x/providers/Microsoft.ContainerService/managedClusters/aks1")).toBe("AKS");
    expect(deriveSharedResourceType("/subs/x/providers/Microsoft.OperationalInsights/workspaces/law1")).toBe("LogAnalytics");
    expect(deriveSharedResourceType("/subs/x/providers/Microsoft.Network/azureFirewalls/fw1")).toBe("AzureFirewall");
    expect(deriveSharedResourceType("/subs/x/providers/Microsoft.Network/virtualNetworkGateways/vpn1")).toBe("VPNGateway");
    expect(deriveSharedResourceType("/subs/x/providers/Microsoft.Network/virtualNetworks/hub")).toBe("VNetHub");
    expect(deriveSharedResourceType("/algo/desconocido")).toBe("Other");
  });

  it("valida la estrategia contra la lista cerrada", () => {
    expect(normalizeStrategy("DYNAMIC_AKS_NAMESPACE")).toBe("DYNAMIC_AKS_NAMESPACE");
    expect(normalizeStrategy("INVENTADA")).toBe("FIXED_PERCENTAGE");
    expect(normalizeStrategy(undefined)).toBe("FIXED_PERCENTAGE");
    expect(isValidResourceType("AKS")).toBe(true);
    expect(isValidResourceType("Inventado")).toBe(false);
  });

  it("aplica tolerancia decimal al estado: 33.33 × 3 es válido, no incompleto", () => {
    expect(deriveAllocationStatus(100)).toBe("VALID_100");
    expect(deriveAllocationStatus(99.99)).toBe("VALID_100");
    expect(deriveAllocationStatus(100.01)).toBe("VALID_100");
    expect(deriveAllocationStatus(99.5)).toBe("INCOMPLETE");
    expect(deriveAllocationStatus(101)).toBe("OVER_ALLOCATED");
    expect(deriveAllocationStatus(0)).toBe("INCOMPLETE");
  });
});

describe("Cost Allocation — validación de reglas", () => {
  it("rechaza sumas por encima de 100%", () => {
    const v = validateTargets([
      { targetCostCenterName: "A", percentage: 60 },
      { targetCostCenterName: "B", percentage: 50 },
    ]);
    expect(v.valid).toBe(false);
    expect(v.totalPercentage).toBe(110);
    expect(v.errors.some((e) => e.includes("no puede superar 100%"))).toBe(true);
  });

  it("acepta sumas por debajo de 100%: el residuo es válido y se hace visible", () => {
    // Una regla incompleta no es un error de captura, es un estado del modelo.
    const v = validateTargets([{ targetCostCenterName: "A", percentage: 60 }]);
    expect(v.valid).toBe(true);
    expect(v.totalPercentage).toBe(60);
  });

  it("rechaza negativos, no-números y centros duplicados", () => {
    expect(validateTargets([{ targetCostCenterName: "A", percentage: -5 }]).valid).toBe(false);
    expect(validateTargets([{ targetCostCenterName: "A", percentage: "x" }]).valid).toBe(false);
    expect(validateTargets([{ targetCostCenterName: "", percentage: 50 }]).valid).toBe(false);

    // Duplicar un centro distorsiona el showback sin que se note.
    const dup = validateTargets([
      { targetCostCenterName: "Engineering", percentage: 50 },
      { targetCostCenterName: "engineering", percentage: 50 },
    ]);
    expect(dup.valid).toBe(false);
    expect(dup.errors.some((e) => e.includes("repetido"))).toBe(true);
  });

  it("rechaza una regla sin ningún target", () => {
    expect(validateTargets([]).valid).toBe(false);
  });
});

describe("Cost Allocation — cálculo del reparto", () => {
  it("reparte con precisión decimal", () => {
    const r = calculateAllocation(1000, [
      { targetCostCenterId: "A", targetCostCenterName: "A", percentage: 65 },
      { targetCostCenterId: "B", targetCostCenterName: "B", percentage: 35 },
    ]);
    expect(r.allocated[0].allocatedAmountUSD).toBe(650);
    expect(r.allocated[1].allocatedAmountUSD).toBe(350);
    expect(r.totalPercentage).toBe(100);
    expect(r.unallocatedAmountUSD).toBe(0);
  });

  it("el último target absorbe el residuo de redondeo: la suma cuadra exacta", () => {
    // 100 USD entre tres al 33.33% deja centavos flotando si cada uno se
    // redondea por separado, y esos centavos descuadran el showback.
    const r = calculateAllocation(100, [
      { targetCostCenterId: "A", targetCostCenterName: "A", percentage: 33.33 },
      { targetCostCenterId: "B", targetCostCenterName: "B", percentage: 33.33 },
      { targetCostCenterId: "C", targetCostCenterName: "C", percentage: 33.34 },
    ]);
    const suma = r.allocated.reduce((a, t) => a + t.allocatedAmountUSD, 0);
    expect(Number(suma.toFixed(2))).toBe(100);
  });

  it("calcula el residuo de las reglas incompletas", () => {
    const r = calculateAllocation(1000, [
      { targetCostCenterId: "A", targetCostCenterName: "A", percentage: 60 },
      { targetCostCenterId: "B", targetCostCenterName: "B", percentage: 25 },
    ]);
    expect(r.totalPercentage).toBe(85);
    expect(r.unallocatedAmountUSD).toBe(150);
  });

  it("una regla sobre-asignada NO genera residuo negativo", () => {
    // El exceso es un error de validación, no un residuo que mostrar.
    const r = calculateAllocation(1000, [
      { targetCostCenterId: "A", targetCostCenterName: "A", percentage: 70 },
      { targetCostCenterId: "B", targetCostCenterName: "B", percentage: 50 },
    ]);
    expect(r.totalPercentage).toBe(120);
    expect(r.unallocatedAmountUSD).toBe(0);
  });

  it("con costo cero reparte cero, sin dividir por nada", () => {
    const r = calculateAllocation(0, [{ targetCostCenterId: "A", targetCostCenterName: "A", percentage: 100 }]);
    expect(r.allocated[0].allocatedAmountUSD).toBe(0);
    expect(r.unallocatedAmountUSD).toBe(0);
  });

  it("sin targets el residuo es el costo completo", () => {
    const r = calculateAllocation(500, []);
    expect(r.totalPercentage).toBe(0);
    expect(r.unallocatedAmountUSD).toBe(500);
  });
});

describe("Cost Allocation — reparto proporcional al gasto directo", () => {
  it("reparte según el gasto de cada centro", () => {
    const t = calculateProportionalTargets([
      { costCenterId: "A", costCenterName: "A", directSpendUSD: 750 },
      { costCenterId: "B", costCenterName: "B", directSpendUSD: 250 },
    ]);
    expect(t[0].percentage).toBe(75);
    expect(t[1].percentage).toBe(25);
  });

  it("sin gasto directo devuelve vacío, no un reparto en partes iguales", () => {
    // Repartir en partes iguales sería una decisión inventada.
    expect(calculateProportionalTargets([{ costCenterId: "A", costCenterName: "A", directSpendUSD: 0 }])).toEqual([]);
    expect(calculateProportionalTargets([])).toEqual([]);
  });

  it("ignora centros con gasto negativo o cero", () => {
    const t = calculateProportionalTargets([
      { costCenterId: "A", costCenterName: "A", directSpendUSD: 100 },
      { costCenterId: "B", costCenterName: "B", directSpendUSD: 0 },
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].percentage).toBe(100);
  });
});

describe("Cost Allocation — resumen y recomendaciones", () => {
  const payload = getMockAllocationPayload("demo-tenant-2222");

  it("genera dataset con una regla incompleta visible", () => {
    expect(payload.source).toBe("mock");
    expect(payload.summary.rules.length).toBeGreaterThan(3);
    expect(payload.summary.invalidRulesCount).toBeGreaterThan(0);
    expect(payload.summary.totalUnallocatedSpendUSD).toBeGreaterThan(0);
  });

  it("la cobertura y el showback son coherentes", () => {
    const s = payload.summary;
    expect(s.totalAllocatedSpendUSD + s.totalUnallocatedSpendUSD).toBeCloseTo(s.totalSharedSpendUSD, 1);
    expect(s.allocationCoveragePercentage).toBeGreaterThan(0);
    expect(s.allocationCoveragePercentage).toBeLessThanOrEqual(100);
    const pct = s.showbackByCostCenter.reduce((a, c) => a + c.percentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
  });

  it("propone completar las reglas incompletas con el monto del residuo", () => {
    const rec = payload.remediations.find((r) => r.category === "COMPLETE_100_PERCENT");
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsOrImpactUSD).toBeGreaterThan(0);
    expect(rec!.description).toContain("showback");
  });

  it("propone reparto dinámico para AKS y Log Analytics con porcentaje fijo", () => {
    expect(payload.remediations.some((r) => r.category === "DYNAMIC_NAMESPACE_ENABLE")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "LAW_INGESTION_SPLIT")).toBe(true);
  });

  it("detecta los recursos compartidos sin ninguna regla", () => {
    const rec = payload.remediations.find((r) => r.category === "DETECT_UNALLOCATED_HUB");
    expect(rec).toBeDefined();
    expect(payload.summary.unruledSharedResourcesCount).toBeGreaterThan(0);
  });

  it("una regla sobre-asignada se reporta y no reclama impacto", () => {
    const over = {
      id: "r",
      ruleName: "X",
      sharedResourceId: "",
      sharedResourceName: "X",
      resourceType: "Other" as SharedResourceType,
      resourceGroup: "",
      subscriptionId: "",
      subscriptionName: "",
      monthlyCostUSD: 100,
      strategy: "FIXED_PERCENTAGE" as const,
      targets: [],
      totalAllocatedPercentage: 120,
      unallocatedAmountUSD: 0,
      status: "OVER_ALLOCATED" as const,
      lastUpdated: "",
    };
    const s = buildAllocationSummary([over]);
    const rec = generateAllocationRecommendations(s, []).find((r) => r.title.includes("sobre-asignación"));
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsOrImpactUSD).toBe(0);
  });

  it("escala por tier y es determinista", () => {
    const pro = getMockAllocationPayload("demo-1111");
    const ent = getMockAllocationPayload("demo-4444");
    expect(ent.summary.rules.length).toBeGreaterThan(pro.summary.rules.length);
    expect(getMockAllocationPayload("demo-4444").summary.totalSharedSpendUSD).toBe(ent.summary.totalSharedSpendUSD);
  });

  it("un resumen vacío no divide por cero", () => {
    const s = buildAllocationSummary([]);
    expect(s.totalSharedSpendUSD).toBe(0);
    expect(s.allocationCoveragePercentage).toBe(0);
    expect(s.showbackByCostCenter).toEqual([]);
    expect(generateAllocationRecommendations(s, [])).toEqual([]);
  });

  it("los colores de centro de costo rotan sin salirse de la escala", () => {
    expect(costCenterColor(0)).toBe("#0078D4");
    expect(costCenterColor(99)).toBeTruthy();
  });
});
