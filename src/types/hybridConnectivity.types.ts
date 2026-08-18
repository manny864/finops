export type HybridNetworkServiceType =
    | "ExpressRoute"
    | "Virtual WAN"
    | "VPN Gateway"
    | "Connection"
    | "Local Network Gateway";

export type HybridConnectionStatus =
    | "Connected"
    | "Connecting"
    | "NotConnected"
    | "ConfigOnly";

/**
 * Strict corporate blue palette for Hybrid Connectivity
 */
export const HYBRID_NETWORK_COLORS: Record<HybridNetworkServiceType, string> = {
    "ExpressRoute": "#0078D4", // Corporate Blue Deep
    "Virtual WAN": "#2563EB", // Cobalt Blue
    "VPN Gateway": "#0284C7", // Sky / Cyan Blue
    "Connection": "#38BDF8", // Light Sky Blue
    "Local Network Gateway": "#94A3B8", // Slate Neutral ($0.00 base cost)
};

export interface HybridNetworkResourceDetails {
    gatewayType?: string; // Vpn | ExpressRoute
    vpnType?: string; // RouteBased | PolicyBased
    activeActive?: boolean;
    bgpEnabled?: boolean;
    asn?: number;
    bgpPeeringAddress?: string;
    peeringLocation?: string;
    bandwidthMbps?: number;
    meteredFamily?: "MeteredData" | "UnlimitedData";
    circuitProvisioningState?: string;
    virtualHubScaleUnits?: number;
    associatedGatewayId?: string;
    associatedGatewayName?: string;
    remoteNetworkAddressSpace?: string[];
    localGatewayIp?: string;
    egressGbMtd?: number;
    ingressGbMtd?: number;
    tunnelThroughputAvgMbps?: number;
    environment?: "prod" | "dev" | "staging" | "qa" | "unknown";
}

export interface HybridNetworkResource {
    id: string;
    name: string;
    serviceType: HybridNetworkServiceType;
    serviceLabel: string;
    skuTier: string;
    connectionStatus: HybridConnectionStatus;
    publicIpOrEndpoint: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    costCenterOwner: string;
    creationDate: string;
    location: string;
    monthlyCostUSD: number;
    isOrphan: boolean;
    orphanReason?: string;
    activeConnectionsCount: number;
    throughputMbps: number;
    costBreakdownReason?: string;
    targetResourceId?: string;
    tags?: Record<string, string>;
    details?: HybridNetworkResourceDetails;
}

export interface HybridNetworkServiceBreakdown {
    serviceName: HybridNetworkServiceType;
    serviceLabel: string;
    costUSD: number;
    percentage: number;
    color: string;
    count: number;
}

export interface HybridConnectivitySummary {
    totalCostUSD: number;
    projectedEndOfMonthCostUSD: number;
    totalGatewaysCount: number;
    totalCircuitsCount: number;
    disconnectedTunnelsCount: number;
    orphanedGatewaysCount: number;
    totalThroughputMbps: number;
    totalEgressGb: number;
    breakdown: HybridNetworkServiceBreakdown[];
}

export type HybridRemediationCategory =
    | "ORPHAN_GATEWAY"
    | "EXPRESSROUTE_ARBITRAGE"
    | "GATEWAY_RIGHTSIZING"
    | "DISCONNECTED_TUNNEL";

export interface HybridRemediationAction {
    id: string;
    resourceId: string;
    resourceName: string;
    title: string;
    description: string;
    category: HybridRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    actionType: "DELETE" | "RIGHTSIZE" | "RECONFIGURE" | "AUDIT";
    commandPayload: {
        cli: string;
        powershell: string;
        impactSummary: string;
    };
}

export interface HybridConnectivityResponse {
    success: boolean;
    mock: boolean;
    kpis: HybridConnectivitySummary;
    resources: HybridNetworkResource[];
    remediations: HybridRemediationAction[];
}
