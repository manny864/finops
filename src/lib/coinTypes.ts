/**
 * Definiciones de Tipos TypeScript para el Índice de Optimización COIN
 * (Cost Optimization Implementation Number) y Recomendaciones WAF.
 */

export interface RecommendationStatusBreakdown {
    /** Recomendaciones abiertas sin acción (antes llamadas "0 de 75") */
    pending: number;
    /** Recomendaciones aceptadas / en progreso por el equipo técnico */
    accepted: number;
    /** Recomendaciones implementadas con éxito */
    implemented: number;
    /** Recomendaciones pospuestas temporalmente (Snoozed) */
    snoozed: number;
    /** Recomendaciones descartadas formalmente */
    dismissed: number;
    /** Total consolidado exhaustivo: pending + accepted + implemented + snoozed + dismissed */
    total: number;
}

export interface CategoryCoinBreakdown {
    category: "Cost" | "Security" | "Reliability" | "Performance" | "OperationalExcellence" | string;
    implemented: number;
    total: number;
    /** Porcentaje de éxito de implementación (0 - 100%) */
    coinRate: number;
    /** Ahorro potencial mensual en USD */
    potentialSavingsUsd: number;
    /** Ahorro mensual capturado/realizado en USD */
    realizedSavingsUsd: number;
}

export interface CoinMonthlyTrendPoint {
    month: string; // "YYYY-MM"
    coinRate: number; // Porcentaje COIN del mes
    implementedCount: number;
    totalCount: number;
    benchmarkTarget?: number; // Benchmark target (ej. 70%)
}

export interface QuickWinRecommendation {
    id: string;
    name: string;
    category: "Cost" | "Security" | "Reliability" | "Performance" | "OperationalExcellence" | string;
    impact: "High" | "Medium" | "Low";
    impactedResource: string;
    resourceGroup?: string;
    subscriptionName?: string;
    estimatedMonthlySavingsUsd: number;
    targetModuleUrl: string;
    status: "pending" | "accepted" | "inProgress";
}

export interface CoinIndexSummary {
    success: boolean;
    mock?: boolean;
    windowDays: number;
    /** COIN por Volumen: (implemented / total) * 100 */
    coinVolumeRate: number;
    /** COIN Financiero: (realizedSavings / totalPotentialSavings) * 100 */
    coinFinancialRate: number;
    /** Alias para compatibilidad hacia atrás */
    coin: number;
    /** Suma total de ahorro mensual de todas las recomendaciones abiertas ($ USD) */
    totalPotentialSavingsUsd: number;
    /** Ahorro mensual consolidado de las recomendaciones implementadas ($ USD) */
    realizedSavingsUsd: number;
    /** Desglose exhaustivo de los 5 estados de recomendaciones */
    statusBreakdown: RecommendationStatusBreakdown;
    /** Totales directos para compatibilidad */
    implemented: number;
    total: number;
    pending: number;
    accepted: number;
    suppressed: number; // Alias de snoozed
    snoozed: number;
    dismissed: number;
    /** Desglose por los 5 pilares WAF */
    breakdown: CategoryCoinBreakdown[];
    /** Serie temporal de los últimos 6 meses */
    monthly: CoinMonthlyTrendPoint[];
    /** Top 5 Quick Wins con mayor impacto económico */
    quickWins: QuickWinRecommendation[];
}
