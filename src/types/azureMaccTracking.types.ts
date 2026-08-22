/**
 * Tipos TypeScript para el Seguimiento de Compromisos MACC (Microsoft Azure Consumption Commitment)
 * Modelado de Pacing Velocity, Cuentas de Facturación EA/MCA, Auditoría de Marketplace y Simulación Contractual.
 */

export type MaccContractStatus =
  | "EARLY_COMPLETION"
  | "ON_TRACK"
  | "UNDER_BURN_RISK";

export interface MaccBillingAccountItem {
  id: string;
  billingAccountId: string;
  displayName: string;
  agreementType: "EA" | "MCA";
  commitmentAmountUSD: number;
  consumedAmountUSD: number;
  remainingAmountUSD: number;
  progressPercentage: number;
  startDate: string;
  endDate: string;
  daysRemaining: number;
  monthlyBurnRateUSD: number;
  projectedFinalCostUSD: number;
  status: MaccContractStatus;
  eligibleFirstPartySpendUSD: number;
  eligibleMarketplaceSpendUSD: number;
  ineligibleSpendUSD: number;
}

export interface MaccPacingDataPoint {
  date: string;
  actualSpendUSD?: number;
  linearTargetUSD: number;
  forecastSpendUSD?: number;
  commitmentTargetUSD: number;
}

export interface MaccSubscriptionBreakdownItem {
  subscriptionId: string;
  subscriptionName: string;
  billingAccountId: string;
  firstPartySpendUSD: number;
  marketplaceEligibleSpendUSD: number;
  ineligibleSpendUSD: number;
  totalEligibleSpendUSD: number;
  contributionPercentage: number;
}

export interface MaccSummaryMetrics {
  totalCommitmentUSD: number;
  totalConsumedUSD: number;
  totalRemainingUSD: number;
  globalStatus: MaccContractStatus;
  billingAccounts: MaccBillingAccountItem[];
  subscriptionsBreakdown: MaccSubscriptionBreakdownItem[];
  pacingTrend: MaccPacingDataPoint[];
  potentialRenegotiationSavingsUSD: number;
}

export interface MaccTrackingPayload {
  metrics: MaccSummaryMetrics;
  source: "live" | "mock";
  lastUpdated: string;
}

export interface MaccRemediationAction {
  id: string;
  billingAccountId: string;
  title: string;
  description: string;
  category: "RENEGOTIATE_TIER" | "ACCELERATE_CONSUMPTION" | "MARKETPLACE_ELIGIBILITY_AUDIT";
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface MaccSimulationResult {
  estimatedCompletionDate: string;
  monthsAheadOfSchedule: number;
  currentTierDiscountPercentage: number;
  simulatedCommitmentUSD: number;
  simulatedDiscountPercentage: number;
  additionalAnnualSavingsUSD: number;
}
