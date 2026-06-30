export interface DateRange {
    start: Date;
    end: Date;
}

export interface CloudProvider {
    getBillingData(tenantId: string, subscriptionId: string, timeframe: string): Promise<unknown>;
    getActiveResources(tenantId: string, subscriptionId: string, resourceType?: string): Promise<unknown[]>;
    getRecommendations(tenantId: string, subscriptionId: string): Promise<unknown[]>;
}
