/**
 * budgetTypes.ts
 * Tipos e interfaces TypeScript para el módulo de Presupuestos FinOps Enterprise:
 * - Proyección de desvío y fecha estimada de exceso (Forecasted Breach Date)
 * - Burn Rate diario
 * - Badges de estado financiero (OK / WARNING / CRITICAL)
 * - Alertas predictivas y multi-umbral
 * - Centros de costos autodescubiertos por tags
 */

export type BudgetStatus = "OK" | "WARNING" | "CRITICAL";

export interface BudgetProjection {
    assignedAmount: number;
    currentSpend: number;
    percentageUsed: number;
    dailyBurnRate: number;
    forecastedMonthEndSpend: number;
    forecastedBreachDate: string | null;
    budgetStatus: BudgetStatus;
}

export interface TenantBudgetOverview extends BudgetProjection {
    tenantId: string;
    month: number;
    year: number;
    alertThreshold: number;
    subscriptionsCount: number;
}

export interface SubscriptionBudgetDetail extends BudgetProjection {
    subscriptionId: string;
    subscriptionName: string;
    alertThreshold: number;
    monthlyHistory: Array<{ month: string; cost: number }>;
}

export interface CostCenterBudget extends BudgetProjection {
    id: number;
    costCenter: string;
    monthlyLimit: number;
    alertThreshold: number;
    utilization: number;
    monthlyHistory?: Array<{ month: string; cost: number }>;
}

export interface BudgetThresholdAlert {
    id?: number;
    budgetId?: number;
    ruleName: string;
    thresholdValue: number;
    thresholdType: "actual" | "forecasted";
    channel: "email" | "webhook";
    channelTarget: string;
}

export interface BudgetModalFormState {
    budgetName: string;
    amount: string;
    contactEmail: string;
    alertThreshold: string;
    forecastAlertEnabled: boolean;
    channelType: "email" | "webhook";
    channelTarget: string;
    timeGrain: string;
}

export interface BudgetRemediationItem {
    id: string;
    type: "forecast_breach" | "unbudgeted_cost_center" | "azure_sync";
    title: string;
    description: string;
    actionLabel: string;
    severity: "warning" | "info" | "critical";
    metadata?: Record<string, any>;
}
