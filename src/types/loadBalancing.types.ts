export type LoadBalancingServiceType =
    | "Application Gateway"
    | "Front Door"
    | "Load Balancer"
    | "Traffic Manager";

export type LoadBalancingOperationalState =
    | "Running"
    | "Stopped"
    | "Healthy"
    | "Degraded"
    | "Orphan";

/**
 * Strict corporate blue palette for Load Balancing & Ingress
 */
export const LOAD_BALANCING_COLORS: Record<LoadBalancingServiceType, string> = {
    "Application Gateway": "#0078D4", // Corporate Blue Deep
    "Front Door": "#2563EB", // Cobalt Blue
    "Load Balancer": "#0284C7", // Cyan / Sky Blue
    "Traffic Manager": "#38BDF8", // Light Sky Blue
};

export interface LoadBalancingResourceDetails {
    skuName?: string;
    skuTier?: string;
    capacity?: number;
    minCapacity?: number;
    maxCapacity?: number;
    autoscaleEnabled?: boolean;
    wafEnabled?: boolean;
    wafMode?: "Detection" | "Prevention" | "None";
    wafPolicyId?: string;
    backendPoolsCount?: number;
    backendAddressesCount?: number;
    httpListenersCount?: number;
    rulesCount?: number;
    frontendIps?: string[];
    customDomains?: string[];
    routingRulesCount?: number;
    endpointsCount?: number;
    trafficRoutingMethod?: string;
    profileStatus?: string;
    requestsCountMonth?: number;
    failedRequestsCountMonth?: number;
    currentCapacityUnits?: number;
    throughputMbps?: number;
    environment?: "prod" | "dev" | "staging" | "qa" | "unknown";
}

export interface LoadBalancingResource {
    id: string;
    name: string;
    serviceType: LoadBalancingServiceType;
    serviceLabel: string;
    skuTier: string;
    wafEnabled: boolean;
    autoscaleMin?: number;
    autoscaleMax?: number;
    operationalState: LoadBalancingOperationalState;
    publicIpOrFqdn: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    costCenterOwner: string;
    creationDate: string;
    location: string;
    monthlyCostUSD: number;
    isOrphan: boolean;
    orphanReason?: string;
    backendPoolsCount: number;
    rulesCount: number;
    requestCountMonth: number;
    costBreakdownReason?: string;
    tags?: Record<string, string>;
    details?: LoadBalancingResourceDetails;
}

export interface LoadBalancingServiceBreakdown {
    serviceName: LoadBalancingServiceType;
    serviceLabel: string;
    costUSD: number;
    percentage: number;
    color: string;
    count: number;
}

export interface LoadBalancingSummary {
    totalCostUSD: number;
    projectedEndOfMonthCostUSD: number;
    totalGatewaysCount: number;
    totalFrontDoorsCount: number;
    totalLoadBalancersCount: number;
    totalTrafficManagersCount: number;
    orphanedCount: number;
    totalRequestsMillion: number;
    breakdown: LoadBalancingServiceBreakdown[];
}

/**
 * Lista en tiempo de ejecucion, no solo un tipo: el texto de cada recomendacion
 * se resuelve con `rem_<category>_title` / `_desc` / `_impact`, asi que el test
 * de claves necesita poder recorrer las categorias. El tipo se deriva de la
 * lista para que no puedan separarse.
 */
export const LOAD_BALANCING_REMEDIATION_CATEGORIES = [
  "ORPHAN_LB",
  "APP_GATEWAY_AUTOSCALE",
  "FRONTDOOR_SKU_DOWNGRADE",
  "IDLE_INGRESS",
] as const;

export type LoadBalancingRemediationCategory = (typeof LOAD_BALANCING_REMEDIATION_CATEGORIES)[number];

export interface LoadBalancingRemediationAction {
    id: string;
    resourceId: string;
    resourceName: string;
    params?: Record<string, string | number>;
    category: LoadBalancingRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    actionType: "DELETE" | "RIGHTSIZE" | "RECONFIGURE" | "AUDIT";
    commandPayload: {
        cli: string;
        powershell: string;
    };
}

export interface LoadBalancingResponse {
    success: boolean;
    mock: boolean;
    kpis: LoadBalancingSummary;
    resources: LoadBalancingResource[];
    remediations: LoadBalancingRemediationAction[];
}
