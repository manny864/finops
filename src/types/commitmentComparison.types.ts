export type CommitmentType = 'RESERVATION' | 'SAVINGS_PLAN';
export type CommitmentTerm = '1_YEAR' | '3_YEARS';
export type CommitmentWinner = 'RESERVATION' | 'SAVINGS_PLAN' | 'TIED';

export interface GranularCommitmentRecommendationItem {
    id: string;
    skuName: string;
    resourceFamily: string;
    region: string;
    scope: 'SingleSubscription' | 'Shared';
    subscriptionId?: string;
    subscriptionName?: string;
    recommendedQuantity: number;
    recommendedHourlyCommitmentUSD?: number;
    currentCostOnDemandUSD: number;
    projectedCostWithCommitmentUSD: number;
    estimatedMonthlySavingsUSD: number;
    savingsPercentage: number;
    term: CommitmentTerm;
    type: CommitmentType;
}

export interface CommitmentOptionSummary {
    monthlySavingsUSD: number;
    recommendationsCount: number;
    savingsPercentage: number;
    coveragePercentage: number;
    isWinner: boolean;
    items: GranularCommitmentRecommendationItem[];
}

export interface TermComparisonItem {
    term: CommitmentTerm;
    termDisplayName: string;
    winner: CommitmentWinner;
    winnerBadgeText: string;
    reservationOption: CommitmentOptionSummary;
    savingsPlanOption: CommitmentOptionSummary;
}

export interface SavingsPlanVsReservationData {
    evaluatedSubscriptionsCount: number;
    oneYearComparison: TermComparisonItem;
    threeYearComparison: TermComparisonItem;
    bestPracticeInsightMarkdown: string;
    lastEvaluatedAtIso: string;
}
