/**
 * TypeScript definitions for Historical Progress & Counterfactual Savings Analysis
 */

export type HistoryTimeRange = "30d" | "90d" | "180d" | "365d";

export interface HistoricalPillars {
  allocation: number;
  rates: number;
  usage: number;
  governance: number;
}

export interface HistoricalDataPoint {
  date: string;
  label?: string;
  maturityScore: number;
  maturityLevel?: "Crawl" | "Walk" | "Run";
  actualSpendUSD: number;
  counterfactualSpendUSD: number;
  tagCoveragePercentage: number;
  unallocatedSpendUSD: number;
  commitmentCoveragePercentage: number;
  commitmentUtilizationPercentage?: number;
  netSavingsUSD?: number;
  budgetUSD?: number;
  forecastSpendUSD?: number;
  zombiesPurgedCount?: number;
  recurringSavingsAvoidedUSD?: number;
  ahubVcores?: number;
  emissionsMtco2e?: number;
  carbonAvoidedMtco2e?: number;
  pillars?: HistoricalPillars;
}

export interface HistoricalSummary {
  currentMaturityScore: number;
  scoreDelta: number;
  currentMaturityStage: "CRAWL" | "WALK" | "RUN";
  totalAvoidedCostUSD: number;
  tagHygienePercentage: number;
  commitmentCoveragePercentage: number;
  commitmentUtilizationPercentage: number;
  realizedSavingsUSD: number;
  totalZombiesPurged: number;
  totalCarbonAvoidedMtco2e: number;
  leakageSpendUSD: number;
  openDebtBacklogUSD: number;
  remediationPaceUSD: number;
  avgTimeToRemediateDays: number;
}

/** De dónde salió la línea base de costo previo (medición vs. estimación). */
export type BaselineSource = "cost_management" | "retail_catalog" | "type_baseline" | "none";

export interface BeforeAfterVerificationItem {
  id: string;
  resourceName: string;
  resourceGroup: string;
  /** Tipo ARM completo ("Microsoft.Network/bastionHosts"), para el icono. */
  resourceType?: string;
  /** ARM Resource ID crudo; sólo para tooltip / copiado. */
  resourceId?: string;
  actionType: string;
  executedDate: string;
  executedBy: string;
  costPre30d: number;
  costPost30d: number;
  realizedMonthlySavings: number;
  /** 0-100 con guarda de división por cero (nunca NaN). */
  savingsPercentage?: number;
  /** Porcentaje formateado, "—" cuando no hay línea base. */
  formattedSavingsPercentage?: string;
  baselineSource?: BaselineSource;
  savingsAccuracyPct: number;
  reboundStatus: "verified_optimal" | "warning_rebound" | "pending_verification";
  reboundDetails: string;
}

export interface ArchitectureMilestone {
  id: string;
  date: string;
  title: string;
  description: string;
  type: "release" | "migration" | "policy" | "reservation";
  monthlyCostDelta: number;
}

export interface WaiverLedgerItem {
  id: string;
  resourceName: string;
  resourceGroup: string;
  category: string;
  recommendationTitle: string;
  estimatedMonthlySavings: number;
  dismissedDate: string;
  expiryDate: string;
  reason: string;
  engineerName: string;
  status: "active_waiver" | "expired" | "revoked";
}

export interface HistoricalProgressPayload {
  success: boolean;
  timeRange: HistoryTimeRange;
  summary: HistoricalSummary;
  series: HistoricalDataPoint[];
  beforeAfterVerifications: BeforeAfterVerificationItem[];
  architectureMilestones: ArchitectureMilestone[];
  waiverLedger: WaiverLedgerItem[];
  tenantName?: string;
  tier?: string;
  source: "mock" | "live";
}
