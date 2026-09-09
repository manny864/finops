export type BasicNetworkServiceType =
    | "Virtual Networks"
    | "Private Endpoints"
    | "Private DNS Zones"
    | "Network Security Group"
    | "Route Table";

export const BASIC_NETWORK_COLORS: Record<BasicNetworkServiceType, string> = {
    "Virtual Networks": "#0078D4", // Corporate Blue Deep
    "Private Endpoints": "#2563EB", // Cobalt Blue
    "Private DNS Zones": "#38BDF8", // Sky Blue
    "Network Security Group": "#93C5FD", // Ice / Light Slate Blue
    "Route Table": "#60A5FA", // Medium Light Blue
};

export interface BasicNetworkSubnetDetail {
    name: string;
    addressPrefix?: string;
    nsgId?: string;
    nsgName?: string;
    routeTableId?: string;
    routeTableName?: string;
    connectedDevicesCount?: number;
}

export interface BasicNetworkPeeringDetail {
    name: string;
    peeringState?: string;
    remoteVirtualNetworkId?: string;
    remoteVirtualNetworkName?: string;
    allowVirtualNetworkAccess?: boolean;
    allowForwardedTraffic?: boolean;
    allowGatewayTransit?: boolean;
}

export interface BasicNetworkCustomDnsConfig {
    fqdn?: string;
    ipAddresses?: string[];
}

export interface BasicNetworkResourceDetails {
    addressPrefixes?: string[];
    subnets?: BasicNetworkSubnetDetail[];
    peerings?: BasicNetworkPeeringDetail[];
    customDnsConfigs?: BasicNetworkCustomDnsConfig[];
    privateLinkServiceId?: string;
    privateLinkServiceName?: string;
    targetResourceName?: string;
    privateIp?: string;
    virtualNetworkLinksCount?: number;
    securityRulesCount?: number;
    routesCount?: number;
    hasAssociatedSubnets?: boolean;
    hasAssociatedNics?: boolean;
    associatedNicsCount?: number;
    flowLogsEnabled?: boolean;
    hasNatGateway?: boolean;
    environment?: "prod" | "dev" | "staging" | "qa" | "unknown";
}

export interface BasicNetworkResource {
    id: string;
    name: string;
    serviceType: BasicNetworkServiceType;
    serviceLabel: string;
    cidrOrPrivateIp: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    costCenterOwner: string;
    creationDate: string;
    location: string;
    monthlyCostUSD: number;
    isOrphan: boolean;
    /**
     * Clave del catalogo, no la frase: la respuesta se cachea con una clave que
     * no incluye el locale, asi que una frase armada en el servidor le llega al
     * segundo lector en el idioma del primero.
     */
    orphanReasonKey?: string;
    orphanParams?: Record<string, string | number>;
    subnetsCount: number;
    linkedVnetsCount: number;
    /**
     * Clave del catalogo, no la frase: la respuesta se cachea con una clave que
     * no incluye el locale, asi que una frase armada en el servidor le llega al
     * segundo lector en el idioma del primero.
     */
    costBreakdownReasonKey?: string;
    costBreakdownParams?: Record<string, string | number>;
    targetResourceId?: string;
    tags?: Record<string, string>;
    details?: BasicNetworkResourceDetails;
}

export interface BasicNetworkServiceBreakdown {
    serviceName: BasicNetworkServiceType;
    serviceLabel: string;
    costUSD: number;
    percentage: number;
    color: string;
    count: number;
}

export interface BasicNetworkSummary {
    totalCostUSD: number;
    projectedEndOfMonthCostUSD: number;
    totalResourcesCount: number;
    orphanedResourcesCount: number;
    privateEndpointsCount: number;
    virtualNetworksCount: number;
    privateDnsZonesCount: number;
    nsgUdrCount: number;
    breakdown: BasicNetworkServiceBreakdown[];
}

/**
 * Lista en tiempo de ejecucion, no solo un tipo: el texto de cada recomendacion
 * se resuelve con `rem_<category>_title` / `_desc` / `_impact`, asi que el test
 * de claves necesita poder recorrer las categorias. El tipo se deriva de la
 * lista para que no puedan separarse.
 */
export const BASIC_NETWORK_REMEDIATION_CATEGORIES = [
  "ORPHAN_NSG",
  "EMPTY_VNET",
  "UNUSED_UDR",
  "PE_OPTIMIZATION",
] as const;

export type BasicNetworkRemediationCategory =
  (typeof BASIC_NETWORK_REMEDIATION_CATEGORIES)[number];

export interface BasicNetworkRemediationAction {
    id: string;
    resourceId: string;
    resourceName: string;
    params?: Record<string, string | number>;
    category: BasicNetworkRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    actionType: "DELETE" | "DISASSOCIATE" | "RIGHTSIZE" | "AUDIT";
    commandPayload: {
        cli: string;
        powershell: string;
    };
}

export interface BasicNetworkingResponse {
    success: boolean;
    mock: boolean;
    kpis: BasicNetworkSummary;
    resources: BasicNetworkResource[];
    remediations: BasicNetworkRemediationAction[];
}
