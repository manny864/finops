export type PowerBiCategoryKey = 'cost' | 'sustainability' | 'governance' | 'budgets';

export type PowerBiTemplateCategory =
    | "COST"
    | "SUSTAINABILITY"
    | "GOVERNANCE"
    | "BUDGETS"
    | PowerBiCategoryKey
    | "unit-economics";

export interface PowerBiTemplateDefinition {
    id: string;
    title: string;
    category: PowerBiCategoryKey;
    categoryBadgeLabel: string;
    description: string;
    fileName: string;
    feedType: 'costs' | 'sustainability' | 'zombies' | 'budgets';
    defaultDays?: number;
    suggestedVisualizations: string[];
    rawPowerQueryScript: string;
}

export interface PowerBiTemplateItem {
    id: string;
    title: string;
    category: PowerBiTemplateCategory;
    categoryDisplayName: string;
    description: string;
    suggestedVisualizations: string[];
    powerQueryScript: string;
    feedType: string;
    defaultDays?: number;
}

export interface PowerBiFeedResponse<T = any> {
    success: boolean;
    tenantId: string;
    feedType: string;
    generatedAtIso: string;
    data?: T[];
    byRegion?: T[];
}
