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

/**
 * Los pasos del waterfall. Es una union cerrada y no un `string` porque el
 * valor es el sufijo de una clave i18n (`waterfall_<stepKey>`) que se arma en
 * runtime: `i18nKeyIntegrity` no la ve y next-intl no rompe el build, muestra
 * el nombre crudo de la clave en pantalla. Con la union, agregar un paso sin su
 * traduccion falla en `i18nClavesDinamicas.test.ts`, que importa esta constante.
 */
export const WATERFALL_STEP_KEYS = [
  "base",
  "growth",
  "ri",
  "ahb",
  "spot",
  "offHours",
  "net",
] as const;

export type WhatIfWaterfallStepKey = (typeof WATERFALL_STEP_KEYS)[number];

export interface WhatIfWaterfallDataPoint {
  /**
   * Clave i18n del paso, no su nombre. El servicio no conoce el locale del
   * lector y este payload se cachea: la UI resuelve waterfall_<stepKey>.
   */
  stepKey: WhatIfWaterfallStepKey;
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
