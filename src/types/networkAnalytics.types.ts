export type NetworkServiceType =
    | "Load Balancers"
    | "Virtual Networks"
    | "Public IP"
    | "Private Endpoints"
    | "Private DNS Zones"
    | "NAT Gateway"
    | "Virtual Network Gateway"
    | "Application Gateway"
    | "Azure Firewall"
    | "Route Tables (UDR)"
    | "Network Security Groups (NSG)"
    | "Subnets"
    | "Other";

export interface NetworkResourceDetail {
    id: string;
    name: string;
    serviceType: NetworkServiceType;
    serviceLabel: string;
    publicIpAddress: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    costCenterOwner: string;
    creationDate: string;
    location: string;
    monthlyCostUSD: number;
    isOrphan: boolean;
    orphanReason?: string;
    details: {
        sku?: string;
        provisioningState?: string;
        backendPoolCount?: number;
        activeConnectionsCount?: number;
        processedGbMtd?: number;
        egressGbMtd?: number;
        associatedResource?: string;
        subnetsCount?: number;
        linkedVnetsCount?: number;
    };
}

export interface NetworkServiceCostBreakdown {
    serviceName: string;
    totalCostUSD: number;
    percentage: number;
    colorHex: string;
    resourceCount: number;
}

export type NetworkRemediationCategory =
    | "ORPHAN_IP"
    | "UNUSED_GATEWAY"
    | "NAT_RIGHTSIZING"
    | "PE_OPTIMIZATION"
    | "ORPHAN_LB";

export interface NetworkRemediationAction {
    id: string;
    resourceId: string;
    resourceName: string;
    title: string;
    description: string;
    category: NetworkRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    actionType: "DELETE" | "DOWNSIZE" | "RECONFIGURE";
    commandPayload: {
        cli: string;
        powershell: string;
        impactSummary: string;
    };
}

export interface NetworkAnalyticsKpis {
    totalMonthlyCostUSD: number;
    projectedRunRateUSD: number;
    totalResourcesCount: number;
    orphanIpsCount: number;
    orphanIpsPotentialSavingsUSD: number;
    billableEgressGb: number;
    potentialTotalSavingsUSD: number;
}

export interface NetworkAnalyticsResponse {
    success: boolean;
    mock: boolean;
    kpis: NetworkAnalyticsKpis;
    serviceBreakdown: NetworkServiceCostBreakdown[];
    resources: NetworkResourceDetail[];
    remediations: NetworkRemediationAction[];
}
