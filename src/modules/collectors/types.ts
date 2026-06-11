export interface DateRange {
    start: Date;
    end: Date;
}

export interface CloudProvider {
    getBillingData(tenantId: string, subscriptionId: string, timeframe: string): Promise<any>;
    getActiveResources(tenantId: string, subscriptionId: string, resourceType?: string): Promise<any[]>;
    getRecommendations(tenantId: string, subscriptionId: string): Promise<any[]>;
}
