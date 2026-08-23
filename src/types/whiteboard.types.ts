// ─── Tipos base del Whiteboard Ejecutivo ───

export interface WhiteboardSummary {
  costMtdUSD: number;
  forecastEomUSD: number;
  zombieCount: number;
  zombieSavingsUSD: number;
  potentialSavingsUSD: number;
  carbonKgCO2e: number;
  lastSyncDate: string;
  momVariationPct?: number;
}

export interface WhiteboardSummaryMetrics extends WhiteboardSummary {
  zombieResourcesCount?: number;
  zombieMonthlyWasteUSD?: number;
  cacheTimestamp?: string;
}

export interface WhiteboardForecastData {
  date: string;
  actualCostUSD?: number;
  projectedCostUSD: number;
  upperBandUSD: number;
  lowerBandUSD: number;
}

export interface WhiteboardBudgetEntry {
  costCenterName: string;
  allocatedBudgetUSD: number;
  currentSpendUSD: number;
  percentageUsed: number;
}

export interface WhiteboardTopServiceItem {
  serviceName: string;
  costUSD: number;
  percentage: number;
}

/** @deprecated Use WhiteboardTopServiceItem */
export interface WhiteboardTopService {
  serviceName: string;
  monthlyCostUSD: number;
  sharePercentage: number;
}

export interface WhiteboardQuickWinItem {
  id: string;
  title: string;
  resourceName: string;
  resourceType: string;
  monthlySavingsUSD: number;
  actionType: string;
  commandPayload?: string;
}

/** @deprecated Use WhiteboardQuickWinItem */
export interface WhiteboardQuickWin {
  id: string;
  title: string;
  category: "Cost" | "Security" | "Governance";
  resourceName: string;
  estimatedMonthlySavingsUSD: number;
  actionType: string;
  description?: string;
  resourceGroup?: string;
  resourceType?: string;
  subscriptionName?: string;
  /** Comando de remediación resuelto en servidor según el tipo real de recurso. */
  commandCli?: string;
  commandPowerShell?: string;
}

export interface WhiteboardGovernanceSecurity {
  tagCoveragePercentage: number;
  untaggedResourcesCount: number;
  unallocatedSpendUSD: number;
  advisorPillars: WhiteboardAdvisorPillars;
  topSecurityActions: string[];
}

export interface WhiteboardAdvisorPillars {
  cost: number;
  security: number;
  reliability: number;
  performance: number;
}

export interface WhiteboardCostTrendPoint {
  month: string;
  actualCostUSD: number;
}

export interface WhiteboardExecutivePayload {
  summary: WhiteboardSummaryMetrics;
  budgets: WhiteboardBudgetEntry[];
  topServices: WhiteboardTopService[];
  quickWins: WhiteboardQuickWin[];
  advisorPillars: WhiteboardAdvisorPillars;
  securityActions: string[];
  costTrend: WhiteboardCostTrendPoint[];
  tagCoveragePct: number;
  untaggedResourcesCount: number;
  unallocatedCostUSD: number;
}