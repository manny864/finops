/**
 * TypeScript Contracts for FinOps What-If Scenario Modeling & Rate Optimization
 */

export interface WhatIfParameters {
  baseCostUSD: number;
  computeGrowthPercentage: number;
  storageGrowthPercentage: number;
  networkEgressGrowthPercentage: number;
  commitmentCoveragePercentage: number;
  commitmentTerm: "1Year" | "3Years";
  spotMixPercentage: number;
  offHoursShutdownPercentage: number;
  enableAhbLicensing: boolean;
  enableArm64Modernization: boolean;
}

export interface WhatIfWaterfallDataPoint {
  stepName: string;
  amountUSD: number;
  isNegative: boolean;
  runningTotalUSD: number;
  fill: string;
}

export interface WhatIfSimulationResult {
  baseCostUSD: number;
  grossProjectedCostUSD: number;
  savingsByCommitmentsUSD: number;
  savingsByAhbUSD: number;
  savingsBySpotUSD: number;
  savingsByOffHoursUSD: number;
  savingsByModernizationUSD: number;
  totalSavingsUSD: number;
  netProjectedCostUSD: number;
  deltaUSD: number;
  deltaPercentage: number;
  annualizedSavingsUSD: number;
  waterfallSteps: WhatIfWaterfallDataPoint[];
}

export interface SavedWhatIfScenario {
  id: string;
  name: string;
  baseCostUSD: number;
  projectedCostUSD: number;
  deltaPercentage: number;
  parameters: WhatIfParameters;
  simulationResult: WhatIfSimulationResult;
  createdAt: string;
}

export interface WhatIfSummaryMetrics {
  activeBaseCostUSD: number;
  simulatedNetCostUSD: number;
  simulatedMonthlySavingsUSD: number;
  simulatedAnnualSavingsUSD: number;
  savedScenariosCount: number;
}

export interface WhatIfPayload {
  baseCostUSD: number;
  defaultParameters: WhatIfParameters;
  defaultResult: WhatIfSimulationResult;
  savedScenarios: SavedWhatIfScenario[];
  source: "live" | "mock";
  lastUpdated: string;
}
