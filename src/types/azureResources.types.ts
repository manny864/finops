/**
 * Types for Azure Resources Inventory & Governance Module
 */

export interface CloudResourceItem {
    id: string;
    name: string;
    type: string;
    typeDisplayName: string;
    location: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    skuName?: string;
    owner?: string;
    costGroup?: string;
    createdDate?: string;
    monthlyCostUSD: number;
    tags: Record<string, string>;
    properties?: Record<string, any>;
}

export interface TagCostSummary {
    tagKey: string;
    distinctValuesCount: number;
    taggedResourcesCount: number;
    monthlySpendUSD: number;
    values: Array<{
        tagValue: string;
        resourcesCount: number;
        costUSD: number;
    }>;
}

export interface CreatorSummary {
    creatorName: string;
    resourcesCount: number;
    resourceGroupsCount: number;
    subscriptionsCount: number;
}

export interface ResourcesKPIs {
    costGroups: number;
    subscriptions: number;
    resourceGroups: number;
    resources: number;
    owners?: number;
    createdBy?: number;
    resourcesWithTags?: number;
    resourcesWithoutTags?: number;
    tagNames?: number;
    tagValues?: number;
}

export interface ResourcesSearchResponse {
    rows: CloudResourceItem[];
    total: number;
    page: number;
    pageSize: number;
    sortedByCost: boolean;
    kpis: ResourcesKPIs;
    mock?: boolean;
}

export interface ResourcesInventoryResponse {
    byType: Array<{ type: string; count: number; friendlyName: string; typeDisplayName?: string }>;
    bySubscription: Array<{ subscriptionId: string; subscriptionName: string; count: number }>;
    byRegion?: Array<{ location: string; count: number }>;
    kpis: ResourcesKPIs;
    mock?: boolean;
}

export interface ResourcesCreatedByResponse {
    rows: CreatorSummary[];
    kpis: ResourcesKPIs;
    mock?: boolean;
}

export interface ResourcesCostsByTagResponse {
    tags: TagCostSummary[];
    kpis?: ResourcesKPIs;
    mock?: boolean;
}

export type CreatedByResponse = ResourcesCreatedByResponse;
export type CostsByTagResponse = ResourcesCostsByTagResponse;
