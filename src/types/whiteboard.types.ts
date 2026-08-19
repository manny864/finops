export interface WhiteboardSummaryMetrics {
  costMtdUSD: number;
  forecastEomUSD: number;
  zombieResourcesCount: number;
  zombieMonthlyWasteUSD: number;
  potentialSavingsUSD: number;
  carbonKgCO2e: number;
  cacheTimestamp: string;
  momVariationPct: number;
}

export interface WhiteboardBudgetEntry {
  costCenterName: string;
  allocatedBudgetUSD: number;
  currentSpendUSD: number;
  percentageUsed: number;
}

export interface WhiteboardTopService {
  serviceName: string;
  monthlyCostUSD: number;
  sharePercentage: number;
}

export interface WhiteboardQuickWin {
  id: string;
  title: string;
  category: "Cost" | "Security" | "Governance";
  resourceName: string;
  estimatedMonthlySavingsUSD: number;
  actionType: string;
  description?: string;
  resourceGroup?: string;
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