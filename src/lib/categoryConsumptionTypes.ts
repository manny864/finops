/**
 * Tipos TypeScript para el Monitor Jerárquico y Resolutivo de Costo por Categoría FinOps (FOCUS)
 */

export interface CategoryServiceBreakdown {
    name: string;
    cost: number;
    count: number;
    sku?: string;
    percentageOfCategory: number;
}

export interface CategoryBudgetConfig {
    monthlyBudget: number;
    spentPercentage: number;
    isOverBudget: boolean;
    remainingBudget: number;
}

export interface CategoryCommitmentMix {
    commitmentPct: number;
    onDemandPct: number;
    commitmentAmount: number;
    onDemandAmount: number;
}

export interface CategoryResourceDetail {
    id: string;
    name: string;
    service: string;
    resourceGroup: string;
    region: string;
    sku: string;
    cost: number;
    optimizationAction?: string;
    optimizationKey?: string;
    tags?: Record<string, string>;
}

export interface FinOpsCategoryDetail {
    category: string;
    totalCost: number;
    percentage: number;
    dailyBurnRate: number;
    projectedCost: number;
    momVariation: number;
    hasSpike: boolean;
    services: CategoryServiceBreakdown[];
    budget: CategoryBudgetConfig;
    commitmentMix: CategoryCommitmentMix;
    recommendation: string;
    remediationActionLabel: string;
    remediationActionKey: string;
    potentialSavings: number;
    resources: CategoryResourceDetail[];
    iconName: string;
    color: string;
}

export interface CategoryHistoricalPoint {
    month: string;
    [category: string]: number | string;
}

export interface CategoryOptimizationOpportunity {
    category: string;
    title: string;
    description: string;
    potentialSavings: number;
    actionKey: string;
    actionLabel: string;
    impactLevel: "high" | "medium" | "low";
}

export interface CategoryOverview {
    success: boolean;
    mock?: boolean;
    empty?: boolean;
    message?: string;
    total: number;
    projectedTotal: number;
    dailyBurnRate: number;
    topCategory: string | null;
    topCategoryPercentage: number;
    overallMomVariation: number;
    categories: FinOpsCategoryDetail[];
    historical6Months: CategoryHistoricalPoint[];
    optimizationOpportunities: CategoryOptimizationOpportunity[];
    diagnostics?: {
        requestedDays: number;
        effectiveDays: number;
        rowsFound: number;
        source: string;
    };
}
