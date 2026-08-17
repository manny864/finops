// Colores institucionales consistentes para categorías FinOps
export const CATEGORY_COLOR_MAP: Record<string, string> = {
    Databases: "#F59E0B", // Amber
    Compute: "#0054A6", // Brand Deep Blue
    Networking: "#8B5CF6", // Purple
    "AI and Machine Learning": "#EC4899", // Pink
    Storage: "#10B981", // Emerald
    "Management and Governance": "#64748B", // Slate
    Web: "#00AEEF", // Brand Cyan
    Analytics: "#F97316", // Orange
    Security: "#EF4444", // Red
    Integration: "#14B8A6", // Teal
    Other: "#94A3B8", // Gray
};

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
