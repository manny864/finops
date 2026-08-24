export type CommitmentTerm = '1_YEAR' | '3_YEARS';
export type CommitmentWinner = 'RESERVATION' | 'SAVINGS_PLAN' | 'TIED';

export interface CommitmentOptionSummary {
    monthlySavingsUSD: number;
    recommendationsCount: number;
    savingsPercentage: number;
    coveragePercentage: number;
    isWinner: boolean;
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
