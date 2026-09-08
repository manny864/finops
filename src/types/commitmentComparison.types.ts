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

/**
 * Claves i18n por termino y por tipo.
 *
 * El payload viaja con el DISCRIMINADOR (`term`, `type`), nunca con la frase.
 * Hasta el 2026-09-08 `TermComparisonItem` llevaba `termDisplayName` y
 * `winnerBadgeText` armados en el servidor --literalmente "1 año" y "3 años"--
 * y el cliente los pintaba tal cual: en la UI en ingles salia el termino en
 * castellano. El servidor no conoce el locale del lector, y encima esta
 * respuesta se cachea.
 *
 * `winnerBadgeText` y `bestPracticeInsightMarkdown` ya estaban muertos: el
 * dashboard derivaba el badge de `winner` con t() e ignoraba el texto. Se van
 * los tres para que nadie vuelva a confiar en ellos.
 *
 * Son Record sobre la union cerrada a proposito: si alguien agrega un termino
 * nuevo, falta la clave y no compila, en vez de pintar el nombre crudo en
 * produccion.
 */
export const COMMITMENT_TERM_KEYS: Record<CommitmentTerm, string> = {
    '1_YEAR': 'term1y',
    '3_YEARS': 'term3y',
};

// Apuntan a claves que YA existian en el namespace CommitmentSimulator y que las
// tarjetas usan para lo mismo. El modal decia "Reservas de Instancias (RI)" fijo;
// ahora dice lo mismo que la tarjeta que lo abrio.
export const COMMITMENT_TYPE_KEYS: Record<CommitmentType, string> = {
    RESERVATION: 'reservation',
    SAVINGS_PLAN: 'savingsPlan',
};

export interface TermComparisonItem {
    term: CommitmentTerm;
    winner: CommitmentWinner;
    reservationOption: CommitmentOptionSummary;
    savingsPlanOption: CommitmentOptionSummary;
}

export interface SavingsPlanVsReservationData {
    evaluatedSubscriptionsCount: number;
    oneYearComparison: TermComparisonItem;
    threeYearComparison: TermComparisonItem;
    lastEvaluatedAtIso: string;
}
