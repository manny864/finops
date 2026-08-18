export type InternetAccessServiceType =
    | "Azure Firewall"
    | "DDoS Protection"
    | "NAT Gateway"
    | "Public IP";

export type InternetAccessAssociationStatus =
    | "Attached"
    | "Unattached"
    | "Active"
    | "Inactive";

/**
 * Strict corporate blue palette for Internet Access & Perimeter Security
 */
export const INTERNET_ACCESS_COLORS: Record<InternetAccessServiceType, string> = {
    "Azure Firewall": "#0078D4", // Corporate Blue Deep
    "DDoS Protection": "#2563EB", // Cobalt Blue
    "NAT Gateway": "#0284C7", // Cyan / Sky Blue
    "Public IP": "#38BDF8", // Light Sky Blue
};

export interface InternetAccessResourceDetails {
    skuName?: string;
    skuTier?: string;
    ipAddress?: string;
    allocationMethod?: string;
    associatedResourceId?: string;
    associatedResourceType?: string;
    subnetsCount?: number;
    subnetsList?: string[];
    associatedIpsCount?: number;
    idleTimeoutMinutes?: number;
    threatIntelMode?: string;
    firewallPolicyId?: string;
    virtualNetworksProtectedCount?: number;
    publicIpsProtectedCount?: number;
    bytesProcessedGB?: number;
    throughputMbps?: number;
    environment?: "prod" | "dev" | "staging" | "qa" | "unknown";
}

export interface InternetAccessResource {
    id: string;
    name: string;
    serviceType: InternetAccessServiceType;
    serviceLabel: string;
    skuTier: string;
    ipAddressOrPrefix: string;
    associationStatus: InternetAccessAssociationStatus;
    associatedResourceName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    costCenterOwner: string;
    creationDate: string;
    location: string;
    monthlyCostUSD: number;
    isOrphan: boolean;
    orphanReason?: string;
    bytesProcessedGB: number;
    costBreakdownReason?: string;
    tags?: Record<string, string>;
    details?: InternetAccessResourceDetails;
}

export interface InternetAccessServiceBreakdown {
    serviceName: InternetAccessServiceType;
    serviceLabel: string;
    costUSD: number;
    percentage: number;
    color: string;
    count: number;
}

export interface InternetAccessSummary {
    totalCostUSD: number;
    projectedEndOfMonthCostUSD: number;
    totalPublicIpsCount: number;
    totalNatGatewaysCount: number;
    totalFirewallsCount: number;
    totalDdosPlansCount: number;
    orphanedIpsCount: number;
    perimeterSecurityCostUSD: number;
    breakdown: InternetAccessServiceBreakdown[];
}

export type InternetAccessRemediationCategory =
    | "ORPHAN_IP"
    | "DDOS_ARBITRAGE"
    | "NAT_RIGHTSIZING"
    | "FIREWALL_RIGHTSIZING";

export interface InternetAccessRemediationAction {
    id: string;
    resourceId: string;
    resourceName: string;
    title: string;
    description: string;
    category: InternetAccessRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    actionType: "DELETE" | "RIGHTSIZE" | "RECONFIGURE" | "AUDIT";
    commandPayload: {
        cli: string;
        powershell: string;
        impactSummary: string;
    };
}

export interface InternetAccessResponse {
    success: boolean;
    mock: boolean;
    kpis: InternetAccessSummary;
    resources: InternetAccessResource[];
    remediations: InternetAccessRemediationAction[];
}
