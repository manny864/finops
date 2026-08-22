/**
 * Azure FinOps What-If Scenario Simulator Service
 * Rate Optimization, RIs/SPs Amortization, Hybrid Benefit, Spot Mix, Off-Hours Deallocation & Waterfall Cost Attribution
 *
 * RBAC mínimo: `Reader` + `Cost Management Reader`.
 * Tolerancia cero a mocks en tenants reales: cálculo matemático exacto sobre el gasto real.
 */

import { Decimal } from "decimal.js";
import {
  type SavedWhatIfScenario,
  type WhatIfParameters,
  type WhatIfPayload,
  type WhatIfSimulationResult,
  type WhatIfWaterfallDataPoint,
} from "@/types/azureWhatIf.types";

/**
 * Ejecuta el cálculo matemático determinista de simulación What-If
 */
export function simulateScenario(params: WhatIfParameters): WhatIfSimulationResult {
  const baseCost = new Decimal(params.baseCostUSD || 0);

  // Descomposición base aproximada por pilar arquitectónico:
  // Cómputo: 60%, Almacenamiento: 25%, Red/Egress: 15%
  const baseCompute = baseCost.times(0.60);
  const baseStorage = baseCost.times(0.25);
  const baseNetwork = baseCost.times(0.15);

  // 1. Crecimiento Bruto
  const computeGrowthFactor = new Decimal(1).plus(new Decimal(params.computeGrowthPercentage).div(100));
  const storageGrowthFactor = new Decimal(1).plus(new Decimal(params.storageGrowthPercentage).div(100));
  const networkGrowthFactor = new Decimal(1).plus(new Decimal(params.networkEgressGrowthPercentage).div(100));

  const projectedComputeGross = baseCompute.times(computeGrowthFactor);
  const projectedStorageGross = baseStorage.times(storageGrowthFactor);
  const projectedNetworkGross = baseNetwork.times(networkGrowthFactor);

  const grossProjectedCost = projectedComputeGross.plus(projectedStorageGross).plus(projectedNetworkGross);

  // 2. Palancas de Ahorro
  // Ahorro RIs / Savings Plans
  const commitmentDiscountRate = params.commitmentTerm === "3Years" ? 0.55 : 0.35;
  const savingsByCommitments = projectedComputeGross
    .times(new Decimal(params.commitmentCoveragePercentage).div(100))
    .times(commitmentDiscountRate);

  // Ahorro Azure Hybrid Benefit (AHB): ~18% sobre cómputo
  const savingsByAhb = params.enableAhbLicensing
    ? projectedComputeGross.times(0.18)
    : new Decimal(0);

  // Ahorro Spot Instance Mix: ~75% de descuento sobre la porción asignada a Spot
  const savingsBySpot = projectedComputeGross
    .times(new Decimal(params.spotMixPercentage).div(100))
    .times(0.75);

  // Ahorro Off-Hours Deallocation: ~40% de VMs no productivas se apagan 65% de las horas del mes
  const savingsByOffHours = projectedComputeGross
    .times(0.40)
    .times(new Decimal(params.offHoursShutdownPercentage).div(100))
    .times(0.65);

  // Ahorro Modernización ARM64: ~20% de cargas elegibles ahorran 20%
  const savingsByModernization = params.enableArm64Modernization
    ? projectedComputeGross.times(0.20).times(0.20)
    : new Decimal(0);

  const totalSavings = savingsByCommitments
    .plus(savingsByAhb)
    .plus(savingsBySpot)
    .plus(savingsByOffHours)
    .plus(savingsByModernization);

  const netProjectedCost = Decimal.max(0, grossProjectedCost.minus(totalSavings));
  const deltaUSD = netProjectedCost.minus(baseCost);
  const deltaPercentage = baseCost.gt(0)
    ? deltaUSD.div(baseCost).times(100).toNumber()
    : 0;

  const monthlySavings = baseCost.minus(netProjectedCost);
  const annualizedSavings = monthlySavings.gt(0) ? monthlySavings.times(12) : new Decimal(0);

  // Construcción de pasos Waterfall en tonos de azul y contrastes armónicos
  const grossGrowthDelta = grossProjectedCost.minus(baseCost);

  const waterfallSteps: WhatIfWaterfallDataPoint[] = [
    {
      stepName: "Costo Base",
      amountUSD: Number(baseCost.toFixed(2)),
      isNegative: false,
      runningTotalUSD: Number(baseCost.toFixed(2)),
      fill: "#64748B", // Slate neutro
    },
    {
      stepName: "Crecimiento Bruto",
      amountUSD: Number(grossGrowthDelta.toFixed(2)),
      isNegative: grossGrowthDelta.lt(0),
      runningTotalUSD: Number(grossProjectedCost.toFixed(2)),
      fill: "#2563EB", // Azul cobalto
    },
    {
      stepName: "Ahorro RIs / SPs",
      amountUSD: Number(savingsByCommitments.negated().toFixed(2)),
      isNegative: true,
      runningTotalUSD: Number(grossProjectedCost.minus(savingsByCommitments).toFixed(2)),
      fill: "#0078D4", // Azul corporativo
    },
    {
      stepName: "Ahorro AHB (Lic)",
      amountUSD: Number(savingsByAhb.negated().toFixed(2)),
      isNegative: true,
      runningTotalUSD: Number(
        grossProjectedCost.minus(savingsByCommitments).minus(savingsByAhb).toFixed(2)
      ),
      fill: "#0284C7", // Azul cian
    },
    {
      stepName: "Ahorro Spot",
      amountUSD: Number(savingsBySpot.negated().toFixed(2)),
      isNegative: true,
      runningTotalUSD: Number(
        grossProjectedCost
          .minus(savingsByCommitments)
          .minus(savingsByAhb)
          .minus(savingsBySpot)
          .toFixed(2)
      ),
      fill: "#38BDF8", // Azul cielo
    },
    {
      stepName: "Ahorro Off-Hours",
      amountUSD: Number(savingsByOffHours.negated().toFixed(2)),
      isNegative: true,
      runningTotalUSD: Number(
        grossProjectedCost
          .minus(savingsByCommitments)
          .minus(savingsByAhb)
          .minus(savingsBySpot)
          .minus(savingsByOffHours)
          .toFixed(2)
      ),
      fill: "#93C5FD", // Azul claro
    },
    {
      stepName: "Costo Neto Proyectado",
      amountUSD: Number(netProjectedCost.toFixed(2)),
      isNegative: false,
      runningTotalUSD: Number(netProjectedCost.toFixed(2)),
      fill: "#0054A6", // Azul empresarial profundo
    },
  ];

  return {
    baseCostUSD: Number(baseCost.toFixed(2)),
    grossProjectedCostUSD: Number(grossProjectedCost.toFixed(2)),
    savingsByCommitmentsUSD: Number(savingsByCommitments.toFixed(2)),
    savingsByAhbUSD: Number(savingsByAhb.toFixed(2)),
    savingsBySpotUSD: Number(savingsBySpot.toFixed(2)),
    savingsByOffHoursUSD: Number(savingsByOffHours.toFixed(2)),
    savingsByModernizationUSD: Number(savingsByModernization.toFixed(2)),
    totalSavingsUSD: Number(totalSavings.toFixed(2)),
    netProjectedCostUSD: Number(netProjectedCost.toFixed(2)),
    deltaUSD: Number(deltaUSD.toFixed(2)),
    deltaPercentage: Number(deltaPercentage.toFixed(1)),
    annualizedSavingsUSD: Number(annualizedSavings.toFixed(2)),
    waterfallSteps,
  };
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockWhatIfPayload(tenantId: string): WhatIfPayload {
  const baseCostUSD = 607.91;

  const defaultParameters: WhatIfParameters = {
    baseCostUSD,
    computeGrowthPercentage: 0,
    storageGrowthPercentage: 0,
    networkEgressGrowthPercentage: 0,
    commitmentCoveragePercentage: 60,
    commitmentTerm: "3Years",
    spotMixPercentage: 20,
    offHoursShutdownPercentage: 50,
    enableAhbLicensing: true,
    enableArm64Modernization: false,
  };

  const defaultResult = simulateScenario(defaultParameters);

  const scenario1Params: WhatIfParameters = {
    baseCostUSD,
    computeGrowthPercentage: 30,
    storageGrowthPercentage: 15,
    networkEgressGrowthPercentage: 10,
    commitmentCoveragePercentage: 0,
    commitmentTerm: "1Year",
    spotMixPercentage: 0,
    offHoursShutdownPercentage: 0,
    enableAhbLicensing: false,
    enableArm64Modernization: false,
  };

  const scenario2Params: WhatIfParameters = {
    baseCostUSD,
    computeGrowthPercentage: 20,
    storageGrowthPercentage: 10,
    networkEgressGrowthPercentage: 5,
    commitmentCoveragePercentage: 80,
    commitmentTerm: "3Years",
    spotMixPercentage: 30,
    offHoursShutdownPercentage: 80,
    enableAhbLicensing: true,
    enableArm64Modernization: true,
  };

  const savedScenarios: SavedWhatIfScenario[] = [
    {
      id: "scen-01",
      name: "Escenario Crecimiento Inercial (+30% Cómputo)",
      baseCostUSD,
      projectedCostUSD: simulateScenario(scenario1Params).netProjectedCostUSD,
      deltaPercentage: simulateScenario(scenario1Params).deltaPercentage,
      parameters: scenario1Params,
      simulationResult: simulateScenario(scenario1Params),
      createdAt: "2026-08-15T14:20:00Z",
    },
    {
      id: "scen-02",
      name: "Optimización Agresiva 3Y + AHB + Spot (Recomendado)",
      baseCostUSD,
      projectedCostUSD: simulateScenario(scenario2Params).netProjectedCostUSD,
      deltaPercentage: simulateScenario(scenario2Params).deltaPercentage,
      parameters: scenario2Params,
      simulationResult: simulateScenario(scenario2Params),
      createdAt: "2026-08-18T09:45:00Z",
    },
    {
      id: "scen-03",
      name: "Adopción de Apagado Off-Hours (Dev/Test 50%)",
      baseCostUSD,
      projectedCostUSD: defaultResult.netProjectedCostUSD,
      deltaPercentage: defaultResult.deltaPercentage,
      parameters: defaultParameters,
      simulationResult: defaultResult,
      createdAt: "2026-08-20T11:10:00Z",
    },
  ];

  return {
    baseCostUSD,
    defaultParameters,
    defaultResult,
    savedScenarios,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensamblado en vivo para tenants conectados reales.
 */
export function assembleLiveWhatIf(input: {
  realBaseCostUSD: number;
  savedScenarios?: SavedWhatIfScenario[];
}): WhatIfPayload {
  const baseCostUSD = Number(input.realBaseCostUSD.toFixed(2));

  const defaultParameters: WhatIfParameters = {
    baseCostUSD,
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

  const defaultResult = simulateScenario(defaultParameters);

  return {
    baseCostUSD,
    defaultParameters,
    defaultResult,
    savedScenarios: input.savedScenarios || [],
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}
