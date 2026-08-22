import { describe, it, expect } from "vitest";
import {
  simulateScenario,
  getMockWhatIfPayload,
  assembleLiveWhatIf,
} from "@/services/azureWhatIfSimulator.service";
import { type WhatIfParameters } from "@/types/azureWhatIf.types";

describe("What-If Simulator — Motor Matemático y Proyecciones", () => {
  const baseParams: WhatIfParameters = {
    baseCostUSD: 1000,
    computeGrowthPercentage: 0,
    storageGrowthPercentage: 0,
    networkEgressGrowthPercentage: 0,
    commitmentCoveragePercentage: 0,
    commitmentTerm: "1Year",
    spotMixPercentage: 0,
    offHoursShutdownPercentage: 0,
    enableAhbLicensing: false,
    enableArm64Modernization: false,
  };

  it("un escenario base sin crecimiento ni palancas mantiene el costo idéntico", () => {
    const result = simulateScenario(baseParams);
    expect(result.baseCostUSD).toBe(1000);
    expect(result.grossProjectedCostUSD).toBe(1000);
    expect(result.netProjectedCostUSD).toBe(1000);
    expect(result.totalSavingsUSD).toBe(0);
    expect(result.deltaUSD).toBe(0);
    expect(result.deltaPercentage).toBe(0);
  });

  it("calcula el crecimiento de cómputo correctamente (+50% en cómputo)", () => {
    const params: WhatIfParameters = {
      ...baseParams,
      computeGrowthPercentage: 50,
    };
    const result = simulateScenario(params);
    // Cómputo base = 600, +50% = 900. Total bruto = 900 + 250 + 150 = 1300
    expect(result.grossProjectedCostUSD).toBe(1300);
    expect(result.netProjectedCostUSD).toBe(1300);
    expect(result.deltaUSD).toBe(300);
    expect(result.deltaPercentage).toBe(30);
  });

  it("calcula ahorros de RIs 3Y (55% descuento)", () => {
    const params: WhatIfParameters = {
      ...baseParams,
      commitmentCoveragePercentage: 100,
      commitmentTerm: "3Years",
    };
    const result = simulateScenario(params);
    // Cómputo = 600, Ahorro 100% * 55% = 330
    expect(result.savingsByCommitmentsUSD).toBe(330);
    expect(result.totalSavingsUSD).toBe(330);
    expect(result.netProjectedCostUSD).toBe(670);
    expect(result.deltaUSD).toBe(-330);
    expect(result.annualizedSavingsUSD).toBe(330 * 12);
  });

  it("calcula Azure Hybrid Benefit (18% ahorro de cómputo)", () => {
    const params: WhatIfParameters = {
      ...baseParams,
      enableAhbLicensing: true,
    };
    const result = simulateScenario(params);
    // Cómputo = 600, AHB = 600 * 0.18 = 108
    expect(result.savingsByAhbUSD).toBe(108);
    expect(result.netProjectedCostUSD).toBe(892);
  });

  it("calcula Spot Mix (75% descuento) y Off-Hours Deallocation (65% ahorro en no-prod)", () => {
    const params: WhatIfParameters = {
      ...baseParams,
      spotMixPercentage: 20,
      offHoursShutdownPercentage: 50,
    };
    const result = simulateScenario(params);
    // Spot: 600 * 0.20 * 0.75 = 90
    expect(result.savingsBySpotUSD).toBe(90);
    // Off-Hours: 600 * 0.40 * 0.50 * 0.65 = 78
    expect(result.savingsByOffHoursUSD).toBe(78);
    expect(result.totalSavingsUSD).toBe(168);
  });

  it("genera los 7 pasos del Waterfall financiero correctamente", () => {
    const params: WhatIfParameters = {
      ...baseParams,
      computeGrowthPercentage: 20,
      commitmentCoveragePercentage: 60,
      commitmentTerm: "3Years",
      enableAhbLicensing: true,
    };
    const result = simulateScenario(params);
    expect(result.waterfallSteps.length).toBeGreaterThanOrEqual(7);
    expect(result.waterfallSteps[0].stepName).toBe("Costo Base");
    expect(result.waterfallSteps[result.waterfallSteps.length - 1].stepName).toBe("Costo Neto Proyectado");
  });
});

describe("What-If Simulator — Dataset Demo y Ensamblado Vivo", () => {
  it("getMockWhatIfPayload devuelve el escenario base y los escenarios guardados", () => {
    const payload = getMockWhatIfPayload("demo-tenant-1111");
    expect(payload.source).toBe("mock");
    expect(payload.baseCostUSD).toBe(607.91);
    expect(payload.savedScenarios.length).toBeGreaterThanOrEqual(3);
    expect(payload.defaultResult.netProjectedCostUSD).toBeLessThan(payload.baseCostUSD);
  });

  it("assembleLiveWhatIf ensambla correctamente datos reales", () => {
    const live = assembleLiveWhatIf({
      realBaseCostUSD: 1450.5,
    });
    expect(live.source).toBe("live");
    expect(live.baseCostUSD).toBe(1450.5);
    expect(live.defaultResult.baseCostUSD).toBe(1450.5);
  });
});
