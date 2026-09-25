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

/**
 * Lo que devuelve `GET /api/budgets/burn`.
 *
 * Existe para que el mock del interceptor de la demo quede ATADO al contrato
 * (ver `MockContracts` en mockData.ts): la ruta no puede alcanzarse con un
 * tenant de demo —pide credenciales de Azure antes de cualquier rama mock—, así
 * que la comparación en runtime que hace `formaMockInterceptor` no llega. El
 * typecheck sí. (MEJ-03)
 */
export interface BudgetBurnRow extends BudgetProjection {
    /** Nombre del centro de costo cuando el presupuesto es por etiqueta. */
    costCenter?: string;
    subscriptionId?: string;
    budget: number;
    actual: number;
}

/**
 * Ojo: la ruta NO expande `BudgetProjection` entero acá. Elige cinco de sus
 * siete campos y usa `budget`/`actual` en lugar de
 * `assignedAmount`/`currentSpend`. El tipo describe lo que la ruta devuelve, no
 * lo que uno supondría: al escribirlo con el spread completo, el typecheck
 * marcó la diferencia de inmediato.
 */
export type BudgetBurnSubBudget = Omit<BudgetProjection, "assignedAmount" | "currentSpend"> & {
    subscriptionId: string;
    budget: number;
    actual: number;
};

export interface BudgetBurnResponse {
    burnData: BudgetBurnRow[];
    subBudgets: Record<string, BudgetBurnSubBudget>;
    consolidated: BudgetProjection;
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
