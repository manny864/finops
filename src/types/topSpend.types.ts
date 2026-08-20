export interface TopSpendItem {
    id: string;
    name: string;
    subText?: string;
    costUSD: number;
    sharePercentage: number;
}

export interface TopSpendSummary {
    topCostGroups: TopSpendItem[];
    topSubscriptions: TopSpendItem[];
    topResourceGroups: TopSpendItem[];
    topResources: TopSpendItem[];
    totalAnalyzedCostUSD: number;
    unattributedSubscriptionCost?: number;
    timeframe: "mtd" | "30d";
    topLimit: number;
    mock?: boolean;
}
