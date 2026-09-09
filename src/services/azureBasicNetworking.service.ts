import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import {
    BasicNetworkResource,
    BasicNetworkServiceType,
    BasicNetworkRemediationAction,
    BasicNetworkingResponse,
    BasicNetworkServiceBreakdown,
    BASIC_NETWORK_COLORS,
} from "@/types/basicNetworking.types";
import { errorMessage } from '@/lib/apiErrors';

export { BASIC_NETWORK_COLORS };

/**
 * Detect environment from tags, resource name, or resource group
 */
export function detectBasicNetworkEnvironment(
    tags?: Record<string, string> | null,
    name?: string,
    rg?: string
): "prod" | "dev" | "staging" | "qa" | "unknown" {
    const combined = `${JSON.stringify(tags || {})} ${name || ""} ${rg || ""}`.toLowerCase();
    if (combined.includes("prod") || combined.includes("prd") || combined.includes("production")) return "prod";
    if (combined.includes("dev") || combined.includes("desarrollo") || combined.includes("development")) return "dev";
    if (combined.includes("stg") || combined.includes("staging") || combined.includes("preprod")) return "staging";
    if (combined.includes("qa") || combined.includes("test") || combined.includes("testing") || combined.includes("uat")) return "qa";
    return "unknown";
}

function parseResourceTags(tags: unknown): Record<string, string> {
    if (!tags) return {};
    if (typeof tags === "object") {
        return Object.fromEntries(
            Object.entries(tags as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
        );
    }
    if (typeof tags === "string") {
        try {
            const parsed = JSON.parse(tags);
            if (parsed && typeof parsed === "object") {
                return Object.fromEntries(
                    Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
                );
            }
        } catch {
            return {};
        }
    }
    return {};
}

function resolveOwnerFromTags(tags: Record<string, string>): string {
    const entries = Object.entries(tags);
    const get = (key: string) => entries.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
    return get("CostOwner") || get("Owner") || get("CostCenterOwner") || get("CostCenter") || get("OwnerGroup") || "-";
}

/**
 * Extract Resource Name from ARM Resource ID
 */
function extractNameFromId(id?: string): string {
    if (!id) return "-";
    const parts = id.split("/");
    return parts[parts.length - 1] || id;
}

/**
 * Fetch Basic Networking Inventory from Azure Resource Graph
 */
export async function fetchLiveBasicNetworkInventory(tenantId: string, subscriptionIds?: string[]): Promise<any[]> {
    try {
        const arg = await getResourceGraphClient(tenantId);
        const subFilter = subscriptionIds && subscriptionIds.length > 0
            ? `| where subscriptionId in~ (${subscriptionIds.map((s) => `'${s}'`).join(",")})`
            : "";

        const query = `
            Resources
            ${subFilter}
            | where type in~ (
                'microsoft.network/virtualnetworks',
                'microsoft.network/privateendpoints',
                'microsoft.network/privatednszones',
                'microsoft.network/networksecuritygroups',
                'microsoft.network/routetables'
            )
            | project id, name, type, resourceGroup, subscriptionId, location, tags, properties,
                     skuName = tostring(sku.name),
                     skuTier = tostring(sku.tier),
                     createdAt = tostring(coalesce(
                        properties.creationTime,
                        properties.createdTime,
                        properties.timeCreated,
                        properties.provisioningTime,
                        properties.metadata.createdAt
                     ))
            | limit 1000
        `;

        const res: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        return (res.data as any[]) || [];
    } catch (e) {
        console.error("[azureBasicNetworking] Error querying ARG:", e);
        return [];
    }
}

/**
 * Query MTD Costs for Basic Networking resources
 */
export async function fetchBasicNetworkCosts(tenantId: string, rawResources: any[] = []) {
    const costByResourceId = new Map<string, number>();
    const costByResourceType = new Map<string, number>();

    try {
        // 1. Direct costs from CostSnapshots
        const [resourceCostRows]: any = await pool.query(
            `SELECT LOWER(COALESCE(ResourceId, resource_id, '')) AS resourceId, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
             FROM CostSnapshots
             WHERE tenant_id = ?
               AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
               AND COALESCE(ResourceId, resource_id, '') <> ''
             GROUP BY LOWER(COALESCE(ResourceId, resource_id, ''))`,
            [tenantId]
        ).catch(() => [[]]);

        for (const row of resourceCostRows || []) {
            const rid = String(row.resourceId || "").toLowerCase();
            if (rid) {
                costByResourceId.set(rid, Number(row.total || 0));
            }
        }

        // 2. Category costs from CostCategorySnapshots
        const [categoryCostRows]: any = await pool.query(
            `SELECT LOWER(resource_type) AS resourceType, SUM(cost_usd) AS total
             FROM CostCategorySnapshots
             WHERE tenant_id = ?
               AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
             GROUP BY LOWER(resource_type)`,
            [tenantId]
        ).catch(() => [[]]);

        for (const row of categoryCostRows || []) {
            const rt = String(row.resourceType || "").toLowerCase();
            costByResourceType.set(rt, Number(row.total || 0));
        }

        // 3. Fallback: live Azure Cost Management if DB has no records for discovered resources
        if (costByResourceId.size === 0 && rawResources.length > 0) {
            try {
                const queryItems = rawResources
                    .map((r) => ({
                        id: String(r.id || ""),
                        subscriptionId: String(r.subscriptionId || ""),
                    }))
                    .filter((r) => Boolean(r.id && r.subscriptionId));

                if (queryItems.length > 0) {
                    const liveCosts = await getResourceCostsById(tenantId, queryItems);
                    for (const [rid, cost] of liveCosts.entries()) {
                        costByResourceId.set(rid.toLowerCase(), cost);
                    }
                }
            } catch (e) {
                console.warn("[azureBasicNetworking] Error querying live getResourceCostsById:", errorMessage(e));
            }
        }

        return { costByResourceId, costByResourceType };
    } catch {
        return {
            costByResourceId: new Map<string, number>(),
            costByResourceType: new Map<string, number>(),
        };
    }
}

/**
 * Generate Mock Data for Demo Tenants strictly adapted per Tier (Professional, Business, Enterprise)
 */
export function getMockBasicNetworkingResponse(tenantId: string = "demo-tenant-id"): BasicNetworkingResponse {
    let multiplier = 1;
    if (tenantId === "44444444-5555-6666-7777-888888888888" || tenantId.includes("business")) {
        multiplier = 2.5;
    } else if (tenantId === "33333333-4444-5555-6666-777777777777" || tenantId.includes("enterprise")) {
        multiplier = 6.0;
    }

    const resources: BasicNetworkResource[] = [
        // 14 Virtual Networks (scaled according to spec: 14 VNets total in Pro baseline)
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-core-networking-prod/providers/Microsoft.Network/virtualNetworks/vnet-hub-prod-eastus2",
            name: "vnet-hub-prod-eastus2",
            serviceType: "Virtual Networks",
            serviceLabel: "Virtual Network",
            cidrOrPrivateIp: "10.100.0.0/16",
            resourceGroup: "rg-core-networking-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Core-Infra",
            creationDate: "2025-01-15T10:00:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((8.45 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 4,
            linkedVnetsCount: 6,
            costBreakdownReasonKey: "cbr_PEERING_TRANSFER_LOGS",
            details: {
                addressPrefixes: ["10.100.0.0/16"],
                subnets: [
                    { name: "GatewaySubnet", addressPrefix: "10.100.1.0/24", connectedDevicesCount: 2 },
                    { name: "AzureFirewallSubnet", addressPrefix: "10.100.2.0/24", connectedDevicesCount: 2 },
                    { name: "snet-shared-services", addressPrefix: "10.100.10.0/24", connectedDevicesCount: 8 },
                    { name: "snet-private-endpoints", addressPrefix: "10.100.20.0/24", connectedDevicesCount: 6 },
                ],
                peerings: [
                    { name: "peering-to-spoke-apps", peeringState: "Connected", remoteVirtualNetworkName: "vnet-spoke-apps-prod", allowVirtualNetworkAccess: true },
                    { name: "peering-to-spoke-data", peeringState: "Connected", remoteVirtualNetworkName: "vnet-spoke-data-prod", allowVirtualNetworkAccess: true },
                ],
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-apps-prod/providers/Microsoft.Network/virtualNetworks/vnet-spoke-apps-prod",
            name: "vnet-spoke-apps-prod",
            serviceType: "Virtual Networks",
            serviceLabel: "Virtual Network",
            cidrOrPrivateIp: "10.101.0.0/16",
            resourceGroup: "rg-apps-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Digital-Banking",
            creationDate: "2025-02-10T14:30:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((3.20 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 3,
            linkedVnetsCount: 1,
            costBreakdownReasonKey: "cbr_PEERING_INGRESS_EGRESS",
            details: {
                addressPrefixes: ["10.101.0.0/16"],
                subnets: [
                    { name: "snet-frontend", addressPrefix: "10.101.1.0/24", connectedDevicesCount: 4 },
                    { name: "snet-backend-api", addressPrefix: "10.101.2.0/24", connectedDevicesCount: 6 },
                    { name: "snet-integration", addressPrefix: "10.101.3.0/24", connectedDevicesCount: 2 },
                ],
                peerings: [
                    { name: "peering-to-hub", peeringState: "Connected", remoteVirtualNetworkName: "vnet-hub-prod-eastus2", allowVirtualNetworkAccess: true },
                ],
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-data-prod/providers/Microsoft.Network/virtualNetworks/vnet-spoke-data-prod",
            name: "vnet-spoke-data-prod",
            serviceType: "Virtual Networks",
            serviceLabel: "Virtual Network",
            cidrOrPrivateIp: "10.102.0.0/16",
            resourceGroup: "rg-data-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Analytics-BI",
            creationDate: "2025-03-01T09:15:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((2.10 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 2,
            linkedVnetsCount: 1,
            costBreakdownReasonKey: "cbr_PEERING_INTER_SPOKE",
            details: {
                addressPrefixes: ["10.102.0.0/16"],
                subnets: [
                    { name: "snet-sql-mi", addressPrefix: "10.102.1.0/24", connectedDevicesCount: 3 },
                    { name: "snet-databricks-private", addressPrefix: "10.102.2.0/24", connectedDevicesCount: 5 },
                ],
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-legacy-sandboxes/providers/Microsoft.Network/virtualNetworks/vnet-empty-sandbox-poc",
            name: "vnet-empty-sandbox-poc",
            serviceType: "Virtual Networks",
            serviceLabel: "Virtual Network",
            cidrOrPrivateIp: "172.16.0.0/16",
            resourceGroup: "rg-legacy-sandboxes",
            subscriptionId: "22222222-3333-4444-5555-666666666666",
            subscriptionName: "Dev & Test Sandbox",
            costCenterOwner: "Innovation-Lab",
            creationDate: "2025-06-12T11:00:00Z",
            location: "centralus",
            monthlyCostUSD: 0.00,
            isOrphan: true,
            orphanReasonKey: "orph_VNET_EMPTY",
            subnetsCount: 0,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_VNET_EMPTY_ZERO",
            details: {
                addressPrefixes: ["172.16.0.0/16"],
                subnets: [],
                peerings: [],
                environment: "dev",
            },
        },
        // Additional VNets to complete the set of 14
        ...Array.from({ length: 10 }).map((_, i) => ({
            id: `/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-workloads-${(i % 3) + 1}/providers/Microsoft.Network/virtualNetworks/vnet-workload-spoke-${i + 1}`,
            name: `vnet-workload-spoke-${i + 1}`,
            serviceType: "Virtual Networks" as BasicNetworkServiceType,
            serviceLabel: "Virtual Network",
            cidrOrPrivateIp: `10.${110 + i}.0.0/16`,
            resourceGroup: `rg-workloads-${(i % 3) + 1}`,
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: ["Platform-Eng", "App-Services", "Integration-Hub"][i % 3],
            creationDate: "2025-04-10T08:00:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((0.40 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 2,
            linkedVnetsCount: 1,
            costBreakdownReasonKey: "cbr_PEERING_BASE",
            details: {
                addressPrefixes: [`10.${110 + i}.0.0/16`],
                subnets: [
                    { name: `snet-main-${i + 1}`, addressPrefix: `10.${110 + i}.1.0/24`, connectedDevicesCount: 2 },
                    { name: `snet-aux-${i + 1}`, addressPrefix: `10.${110 + i}.2.0/24`, connectedDevicesCount: 1 },
                ],
                environment: "prod" as const,
            },
        })),

        // 6 Private Endpoints (6 PEs total in baseline)
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-data-prod/providers/Microsoft.Network/privateEndpoints/pe-sql-primary-prod",
            name: "pe-sql-primary-prod",
            serviceType: "Private Endpoints",
            serviceLabel: "Private Endpoint",
            cidrOrPrivateIp: "10.100.20.4",
            resourceGroup: "rg-data-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Core-Database",
            creationDate: "2025-01-20T12:00:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((7.30 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 1,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PE_FIXED_GB",
            costBreakdownParams: { gb: 124 },
            targetResourceId: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-data-prod/providers/Microsoft.Sql/servers/sql-srv-prod-primary",
            details: {
                privateIp: "10.100.20.4",
                privateLinkServiceName: "sql-srv-prod-primary",
                targetResourceName: "Microsoft.Sql/servers/sql-srv-prod-primary",
                customDnsConfigs: [{ fqdn: "sql-srv-prod-primary.database.windows.net", ipAddresses: ["10.100.20.4"] }],
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-storage-prod/providers/Microsoft.Network/privateEndpoints/pe-stg-datalake-blob",
            name: "pe-stg-datalake-blob",
            serviceType: "Private Endpoints",
            serviceLabel: "Private Endpoint",
            cidrOrPrivateIp: "10.100.20.5",
            resourceGroup: "rg-storage-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Data-Eng",
            creationDate: "2025-02-05T09:30:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((7.30 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 1,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PE_FIXED_GB",
            costBreakdownParams: { gb: 85 },
            targetResourceId: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-storage-prod/providers/Microsoft.Storage/storageAccounts/stgprodanalyticslake",
            details: {
                privateIp: "10.100.20.5",
                privateLinkServiceName: "stgprodanalyticslake",
                targetResourceName: "Microsoft.Storage/storageAccounts/stgprodanalyticslake",
                customDnsConfigs: [{ fqdn: "stgprodanalyticslake.blob.core.windows.net", ipAddresses: ["10.100.20.5"] }],
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-sec-prod/providers/Microsoft.Network/privateEndpoints/pe-kv-secrets-vault",
            name: "pe-kv-secrets-vault",
            serviceType: "Private Endpoints",
            serviceLabel: "Private Endpoint",
            cidrOrPrivateIp: "10.100.20.6",
            resourceGroup: "rg-sec-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Security-Ops",
            creationDate: "2025-01-18T16:20:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((7.30 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 1,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PE_FIXED_GB",
            costBreakdownParams: { gb: 12 },
            targetResourceId: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-sec-prod/providers/Microsoft.KeyVault/vaults/kv-prod-enterprise-01",
            details: {
                privateIp: "10.100.20.6",
                privateLinkServiceName: "kv-prod-enterprise-01",
                targetResourceName: "Microsoft.KeyVault/vaults/kv-prod-enterprise-01",
                customDnsConfigs: [{ fqdn: "kv-prod-enterprise-01.vault.azure.net", ipAddresses: ["10.100.20.6"] }],
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-microservices/providers/Microsoft.Network/privateEndpoints/pe-cosmos-dev-sandbox",
            name: "pe-cosmos-dev-sandbox",
            serviceType: "Private Endpoints",
            serviceLabel: "Private Endpoint",
            cidrOrPrivateIp: "10.200.10.12",
            resourceGroup: "rg-dev-microservices",
            subscriptionId: "22222222-3333-4444-5555-666666666666",
            subscriptionName: "Dev & Test Sandbox",
            costCenterOwner: "Dev-Squad-Alpha",
            creationDate: "2025-05-20T10:00:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((7.30 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 1,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PE_LOW_TRAFFIC",
            targetResourceId: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-microservices/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-dev-mock-01",
            details: {
                privateIp: "10.200.10.12",
                privateLinkServiceName: "cosmos-dev-mock-01",
                targetResourceName: "Microsoft.DocumentDB/databaseAccounts/cosmos-dev-mock-01",
                customDnsConfigs: [{ fqdn: "cosmos-dev-mock-01.documents.azure.com", ipAddresses: ["10.200.10.12"] }],
                environment: "dev",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-apps-prod/providers/Microsoft.Network/privateEndpoints/pe-redis-cache-prod",
            name: "pe-redis-cache-prod",
            serviceType: "Private Endpoints",
            serviceLabel: "Private Endpoint",
            cidrOrPrivateIp: "10.100.20.7",
            resourceGroup: "rg-apps-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "App-Services",
            creationDate: "2025-02-14T11:45:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((7.30 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 1,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PE_FIXED_GB",
            costBreakdownParams: { gb: 310 },
            targetResourceId: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-apps-prod/providers/Microsoft.Cache/Redis/redis-cache-prod-c3",
            details: {
                privateIp: "10.100.20.7",
                privateLinkServiceName: "redis-cache-prod-c3",
                targetResourceName: "Microsoft.Cache/Redis/redis-cache-prod-c3",
                customDnsConfigs: [{ fqdn: "redis-cache-prod-c3.redis.cache.windows.net", ipAddresses: ["10.100.20.7"] }],
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-data-prod/providers/Microsoft.Network/privateEndpoints/pe-acr-container-registry",
            name: "pe-acr-container-registry",
            serviceType: "Private Endpoints",
            serviceLabel: "Private Endpoint",
            cidrOrPrivateIp: "10.100.20.8",
            resourceGroup: "rg-data-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "DevOps-Core",
            creationDate: "2025-02-18T15:00:00Z",
            location: "eastus2",
            monthlyCostUSD: Number((7.30 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 1,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PE_FIXED_GB",
            costBreakdownParams: { gb: 45 },
            targetResourceId: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-data-prod/providers/Microsoft.ContainerRegistry/registries/acrfinopsprod",
            details: {
                privateIp: "10.100.20.8",
                privateLinkServiceName: "acrfinopsprod",
                targetResourceName: "Microsoft.ContainerRegistry/registries/acrfinopsprod",
                customDnsConfigs: [{ fqdn: "acrfinopsprod.azurecr.io", ipAddresses: ["10.100.20.8"] }],
                environment: "prod",
            },
        },

        // 8 Private DNS Zones (8 DNS total in baseline)
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-core-networking-prod/providers/Microsoft.Network/privateDnsZones/privatelink.database.windows.net",
            name: "privatelink.database.windows.net",
            serviceType: "Private DNS Zones",
            serviceLabel: "Private DNS Zone",
            cidrOrPrivateIp: "Zona DNS Privada",
            resourceGroup: "rg-core-networking-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Core-Infra",
            creationDate: "2025-01-16T10:00:00Z",
            location: "global",
            monthlyCostUSD: Number((0.50 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 0,
            linkedVnetsCount: 4,
            costBreakdownReasonKey: "cbr_DNS_ZONE_QUERIES",
            details: {
                virtualNetworkLinksCount: 4,
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-core-networking-prod/providers/Microsoft.Network/privateDnsZones/privatelink.blob.core.windows.net",
            name: "privatelink.blob.core.windows.net",
            serviceType: "Private DNS Zones",
            serviceLabel: "Private DNS Zone",
            cidrOrPrivateIp: "Zona DNS Privada",
            resourceGroup: "rg-core-networking-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Core-Infra",
            creationDate: "2025-01-16T10:05:00Z",
            location: "global",
            monthlyCostUSD: Number((0.50 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 0,
            linkedVnetsCount: 4,
            costBreakdownReasonKey: "cbr_DNS_ZONE_QUERIES",
            details: {
                virtualNetworkLinksCount: 4,
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-core-networking-prod/providers/Microsoft.Network/privateDnsZones/privatelink.vaultcore.azure.net",
            name: "privatelink.vaultcore.azure.net",
            serviceType: "Private DNS Zones",
            serviceLabel: "Private DNS Zone",
            cidrOrPrivateIp: "Zona DNS Privada",
            resourceGroup: "rg-core-networking-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Core-Infra",
            creationDate: "2025-01-16T10:10:00Z",
            location: "global",
            monthlyCostUSD: Number((0.50 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 0,
            linkedVnetsCount: 3,
            costBreakdownReasonKey: "cbr_DNS_ZONE_FIXED",
            details: {
                virtualNetworkLinksCount: 3,
                environment: "prod",
            },
        },
        ...[
            "privatelink.documents.azure.com",
            "privatelink.redis.cache.windows.net",
            "privatelink.azurecr.io",
            "privatelink.servicebus.windows.net",
            "privatelink.table.core.windows.net",
        ].map((dnsName) => ({
            id: `/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-core-networking-prod/providers/Microsoft.Network/privateDnsZones/${dnsName}`,
            name: dnsName,
            serviceType: "Private DNS Zones" as BasicNetworkServiceType,
            serviceLabel: "Private DNS Zone",
            cidrOrPrivateIp: "Zona DNS Privada",
            resourceGroup: "rg-core-networking-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Core-Infra",
            creationDate: "2025-01-20T08:00:00Z",
            location: "global",
            monthlyCostUSD: Number((0.50 * multiplier).toFixed(2)),
            isOrphan: false,
            subnetsCount: 0,
            linkedVnetsCount: 2,
            costBreakdownReasonKey: "cbr_DNS_ZONE_FIXED",
            details: {
                virtualNetworkLinksCount: 2,
                environment: "prod" as const,
            },
        })),

        // 12 NSGs & Route Tables (UDRs) (12 total in baseline)
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-sec-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-aks-subnet-prod",
            name: "nsg-aks-subnet-prod",
            serviceType: "Network Security Group",
            serviceLabel: "Network Security Group",
            cidrOrPrivateIp: "12 Reglas Inbound/Outbound",
            resourceGroup: "rg-sec-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Security-Ops",
            creationDate: "2025-01-15T11:00:00Z",
            location: "eastus2",
            monthlyCostUSD: 0.00,
            isOrphan: false,
            subnetsCount: 2,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PLATFORM_INCLUDED",
            details: {
                securityRulesCount: 12,
                hasAssociatedSubnets: true,
                hasAssociatedNics: true,
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-unassigned/providers/Microsoft.Network/networkSecurityGroups/nsg-dev-test-orphan-01",
            name: "nsg-dev-test-orphan-01",
            serviceType: "Network Security Group",
            serviceLabel: "Network Security Group",
            cidrOrPrivateIp: "6 Reglas (Sin uso)",
            resourceGroup: "rg-dev-unassigned",
            subscriptionId: "22222222-3333-4444-5555-666666666666",
            subscriptionName: "Dev & Test Sandbox",
            costCenterOwner: "Unallocated",
            creationDate: "2025-03-22T14:10:00Z",
            location: "eastus2",
            monthlyCostUSD: 0.00,
            isOrphan: true,
            orphanReasonKey: "orph_NSG_UNUSED",
            subnetsCount: 0,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_ORPHAN_HYGIENE",
            details: {
                securityRulesCount: 6,
                hasAssociatedSubnets: false,
                hasAssociatedNics: false,
                environment: "dev",
            },
        },
        {
            id: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-unassigned/providers/Microsoft.Network/networkSecurityGroups/nsg-legacy-vm-orphan-02",
            name: "nsg-legacy-vm-orphan-02",
            serviceType: "Network Security Group",
            serviceLabel: "Network Security Group",
            cidrOrPrivateIp: "4 Reglas (Sin uso)",
            resourceGroup: "rg-dev-unassigned",
            subscriptionId: "22222222-3333-4444-5555-666666666666",
            subscriptionName: "Dev & Test Sandbox",
            costCenterOwner: "Unallocated",
            creationDate: "2025-04-05T09:25:00Z",
            location: "eastus2",
            monthlyCostUSD: 0.00,
            isOrphan: true,
            orphanReasonKey: "orph_NSG_AFTER_VM_DELETE",
            subnetsCount: 0,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_ORPHAN_HYGIENE",
            details: {
                securityRulesCount: 4,
                hasAssociatedSubnets: false,
                hasAssociatedNics: false,
                environment: "dev",
            },
        },
        {
            id: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-core-networking-prod/providers/Microsoft.Network/routeTables/rt-spoke-to-nva-firewall",
            name: "rt-spoke-to-nva-firewall",
            serviceType: "Route Table",
            serviceLabel: "Route Table (UDR)",
            cidrOrPrivateIp: "5 Rutas (0.0.0.0/0 -> 10.100.2.4)",
            resourceGroup: "rg-core-networking-prod",
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: "Core-Infra",
            creationDate: "2025-01-15T11:30:00Z",
            location: "eastus2",
            monthlyCostUSD: 0.00,
            isOrphan: false,
            subnetsCount: 3,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PLATFORM_INCLUDED",
            details: {
                routesCount: 5,
                hasAssociatedSubnets: true,
                environment: "prod",
            },
        },
        {
            id: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-unassigned/providers/Microsoft.Network/routeTables/rt-dev-orphan-table-01",
            name: "rt-dev-orphan-table-01",
            serviceType: "Route Table",
            serviceLabel: "Route Table (UDR)",
            cidrOrPrivateIp: "2 Rutas (Sin asociar)",
            resourceGroup: "rg-dev-unassigned",
            subscriptionId: "22222222-3333-4444-5555-666666666666",
            subscriptionName: "Dev & Test Sandbox",
            costCenterOwner: "Unallocated",
            creationDate: "2025-04-18T16:00:00Z",
            location: "eastus2",
            monthlyCostUSD: 0.00,
            isOrphan: true,
            orphanReasonKey: "orph_UDR_NO_SUBNET",
            subnetsCount: 0,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_ORPHAN_HYGIENE",
            details: {
                routesCount: 2,
                hasAssociatedSubnets: false,
                environment: "dev",
            },
        },
        ...Array.from({ length: 7 }).map((_, i) => ({
            id: `/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-workloads-${(i % 3) + 1}/providers/Microsoft.Network/networkSecurityGroups/nsg-workload-subnet-${i + 1}`,
            name: `nsg-workload-subnet-${i + 1}`,
            serviceType: (i % 2 === 0 ? "Network Security Group" : "Route Table") as BasicNetworkServiceType,
            serviceLabel: i % 2 === 0 ? "Network Security Group" : "Route Table (UDR)",
            cidrOrPrivateIp: i % 2 === 0 ? "8 Reglas Inbound/Outbound" : "3 Rutas Custom",
            resourceGroup: `rg-workloads-${(i % 3) + 1}`,
            subscriptionId: "11111111-2222-3333-4444-555555555555",
            subscriptionName: "Producción Principal (PAYG)",
            costCenterOwner: ["Platform-Eng", "App-Services", "Integration-Hub"][i % 3],
            creationDate: "2025-03-10T09:00:00Z",
            location: "eastus2",
            monthlyCostUSD: 0.00,
            isOrphan: false,
            subnetsCount: 1,
            linkedVnetsCount: 0,
            costBreakdownReasonKey: "cbr_PLATFORM_INCLUDED",
            details: {
                securityRulesCount: 8,
                routesCount: 3,
                hasAssociatedSubnets: true,
                hasAssociatedNics: true,
                environment: "prod" as const,
            },
        })),
    ];

    // Compute Summary KPIs
    const totalCostUSD = Number(resources.reduce((sum, r) => sum + r.monthlyCostUSD, 0).toFixed(2));
    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projectedEndOfMonthCostUSD = totalCostUSD > 0
        ? Number(((totalCostUSD / daysElapsed) * daysInMonth).toFixed(2))
        : 0;

    const orphanedResourcesCount = resources.filter((r) => r.isOrphan).length;
    const privateEndpointsCount = resources.filter((r) => r.serviceType === "Private Endpoints").length;
    const virtualNetworksCount = resources.filter((r) => r.serviceType === "Virtual Networks").length;
    const privateDnsZonesCount = resources.filter((r) => r.serviceType === "Private DNS Zones").length;
    const nsgUdrCount = resources.filter((r) => r.serviceType === "Network Security Group" || r.serviceType === "Route Table").length;

    // Service Breakdown for Donut Chart (Ordered in strict blue shades)
    const serviceTypeOrder: BasicNetworkServiceType[] = [
        "Virtual Networks",
        "Private Endpoints",
        "Private DNS Zones",
        "Network Security Group",
        "Route Table",
    ];

    const breakdown: BasicNetworkServiceBreakdown[] = serviceTypeOrder.map((st) => {
        const matching = resources.filter((r) => r.serviceType === st);
        const cost = Number(matching.reduce((sum, r) => sum + r.monthlyCostUSD, 0).toFixed(2));
        const percentage = totalCostUSD > 0 ? Number(((cost / totalCostUSD) * 100).toFixed(1)) : 0;
        return {
            serviceName: st,
            serviceLabel: st === "Route Table" ? "Route Tables (UDR)" : st === "Network Security Group" ? "NSGs" : st,
            costUSD: cost,
            percentage,
            color: BASIC_NETWORK_COLORS[st],
            count: matching.length,
        };
    });

    // Resolutive Remediations
    const remediations: BasicNetworkRemediationAction[] = [
        {
            id: "rem-orphan-nsg-01",
            resourceId: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-unassigned/providers/Microsoft.Network/networkSecurityGroups/nsg-dev-test-orphan-01",
            resourceName: "nsg-dev-test-orphan-01",
            category: "ORPHAN_NSG",
            params: { name: "nsg-dev-test-orphan-01", rg: "rg-dev-unassigned" },
            estimatedSavingsUSD: 0.00,
            confidence: "HIGH",
            actionType: "DELETE",
            commandPayload: {
                cli: `az network nsg delete \\\n  --name "nsg-dev-test-orphan-01" \\\n  --resource-group "rg-dev-unassigned" \\\n  --subscription "22222222-3333-4444-5555-666666666666"`,
                powershell: `Remove-AzNetworkSecurityGroup -Name "nsg-dev-test-orphan-01" -ResourceGroupName "rg-dev-unassigned" -Force`,
            },
        },
        {
            id: "rem-orphan-udr-01",
            resourceId: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-unassigned/providers/Microsoft.Network/routeTables/rt-dev-orphan-table-01",
            resourceName: "rt-dev-orphan-table-01",
            category: "UNUSED_UDR",
            params: { name: "rt-dev-orphan-table-01" },
            estimatedSavingsUSD: 0.00,
            confidence: "HIGH",
            actionType: "DELETE",
            commandPayload: {
                cli: `az network route-table delete \\\n  --name "rt-dev-orphan-table-01" \\\n  --resource-group "rg-dev-unassigned" \\\n  --subscription "22222222-3333-4444-5555-666666666666"`,
                powershell: `Remove-AzRouteTable -Name "rt-dev-orphan-table-01" -ResourceGroupName "rg-dev-unassigned" -Force`,
            },
        },
        {
            id: "rem-empty-vnet-01",
            resourceId: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-legacy-sandboxes/providers/Microsoft.Network/virtualNetworks/vnet-empty-sandbox-poc",
            resourceName: "vnet-empty-sandbox-poc",
            category: "EMPTY_VNET",
            params: { name: "vnet-empty-sandbox-poc", cidr: "172.16.0.0/16", rg: "rg-legacy-sandboxes" },
            estimatedSavingsUSD: 0.00,
            confidence: "HIGH",
            actionType: "DELETE",
            commandPayload: {
                cli: `az network vnet delete \\\n  --name "vnet-empty-sandbox-poc" \\\n  --resource-group "rg-legacy-sandboxes" \\\n  --subscription "22222222-3333-4444-5555-666666666666"`,
                powershell: `Remove-AzVirtualNetwork -Name "vnet-empty-sandbox-poc" -ResourceGroupName "rg-legacy-sandboxes" -Force`,
            },
        },
        {
            id: "rem-pe-optimization-01",
            resourceId: "/subscriptions/22222222-3333-4444-5555-666666666666/resourceGroups/rg-dev-microservices/providers/Microsoft.Network/privateEndpoints/pe-cosmos-dev-sandbox",
            resourceName: "pe-cosmos-dev-sandbox",
            category: "PE_OPTIMIZATION",
            params: { name: "pe-cosmos-dev-sandbox", env: "DEV", cost: (7.30 * multiplier).toFixed(2) },
            estimatedSavingsUSD: Number((7.30 * multiplier).toFixed(2)),
            confidence: "MEDIUM",
            actionType: "RIGHTSIZE",
            commandPayload: {
                cli: `# Opción 1: Reemplazar por Service Endpoint (gratuito) en la subred de desarrollo:\naz network vnet subnet update \\\n  --name "snet-dev" \\\n  --vnet-name "vnet-dev" \\\n  --resource-group "rg-dev-microservices" \\\n  --service-endpoints "Microsoft.AzureCosmosDB"\n\n# Opción 2: Eliminar Private Endpoint ocioso:\naz network private-endpoint delete \\\n  --name "pe-cosmos-dev-sandbox" \\\n  --resource-group "rg-dev-microservices"`,
                powershell: `Remove-AzPrivateEndpoint -Name "pe-cosmos-dev-sandbox" -ResourceGroupName "rg-dev-microservices" -Force`,
            },
        },
    ];

    return {
        success: true,
        mock: true,
        kpis: {
            totalCostUSD,
            projectedEndOfMonthCostUSD,
            totalResourcesCount: resources.length,
            orphanedResourcesCount,
            privateEndpointsCount,
            virtualNetworksCount,
            privateDnsZonesCount,
            nsgUdrCount,
            breakdown,
        },
        resources,
        remediations,
    };
}

/**
 * Process Live Basic Networking Resources for Real Connected Tenants (Zero Fallback)
 */
export async function computeLiveBasicNetworking(tenantId: string, subscriptionIds?: string[]): Promise<BasicNetworkingResponse> {
    const rawResources = await fetchLiveBasicNetworkInventory(tenantId, subscriptionIds);
    const { costByResourceId, costByResourceType } = await fetchBasicNetworkCosts(tenantId, rawResources);

    if (!rawResources || rawResources.length === 0) {
        // Zero-fallback: genuine empty state
        return {
            success: true,
            mock: false,
            kpis: {
                totalCostUSD: 0,
                projectedEndOfMonthCostUSD: 0,
                totalResourcesCount: 0,
                orphanedResourcesCount: 0,
                privateEndpointsCount: 0,
                virtualNetworksCount: 0,
                privateDnsZonesCount: 0,
                nsgUdrCount: 0,
                breakdown: [],
            },
            resources: [],
            remediations: [],
        };
    }

    const credential = await getAzureCredential(tenantId).catch(() => null);
    const subNameMap = credential
        ? await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>())
        : new Map<string, string>();

    const resources: BasicNetworkResource[] = [];
    const remediations: BasicNetworkRemediationAction[] = [];

    for (const raw of rawResources) {
        const id = String(raw.id || "");
        const normId = id.toLowerCase();
        const armType = String(raw.type || "").toLowerCase();
        const name = String(raw.name || "");
        const resourceGroup = String(raw.resourceGroup || "");
        const subscriptionId = String(raw.subscriptionId || "");
        const subscriptionName = resolveSubscriptionName(subscriptionId, subNameMap);
        const tags = parseResourceTags(raw.tags);
        const costCenterOwner = resolveOwnerFromTags(tags);
        const location = String(raw.location || "global");
        const creationDate = String(raw.createdAt || "");
        const env = detectBasicNetworkEnvironment(tags, name, resourceGroup);

        let monthlyCostUSD = costByResourceId.get(normId) || 0;
        let isOrphan = false;
        let orphanReasonKey: string | undefined;
        let serviceType: BasicNetworkServiceType = "Virtual Networks";
        let serviceLabel = "Virtual Network";
        let cidrOrPrivateIp = "-";
        let subnetsCount = 0;
        let linkedVnetsCount = 0;
        let costBreakdownReasonKey = "cbr_BASE_NETWORK_RESOURCE";
        let targetResourceId: string | undefined;
        const details: any = { environment: env };

        if (armType === "microsoft.network/virtualnetworks") {
            serviceType = "Virtual Networks";
            serviceLabel = "Virtual Network";
            const prefixes = raw.properties?.addressSpace?.addressPrefixes || [];
            cidrOrPrivateIp = Array.isArray(prefixes) && prefixes.length > 0 ? prefixes.join(", ") : "-";
            const subnets = raw.properties?.subnets || [];
            subnetsCount = Array.isArray(subnets) ? subnets.length : 0;
            const peerings = raw.properties?.virtualNetworkPeerings || [];
            linkedVnetsCount = Array.isArray(peerings) ? peerings.length : 0;
            details.addressPrefixes = prefixes;
            details.subnets = subnets.map((s: any) => ({
                name: s.name,
                addressPrefix: s.properties?.addressPrefix,
                nsgId: s.properties?.networkSecurityGroup?.id,
                routeTableId: s.properties?.routeTable?.id,
                connectedDevicesCount: s.properties?.ipConfigurations?.length || 0,
            }));
            details.peerings = peerings.map((p: any) => ({
                name: p.name,
                peeringState: p.properties?.peeringState,
                remoteVirtualNetworkId: p.properties?.remoteVirtualNetwork?.id,
                remoteVirtualNetworkName: extractNameFromId(p.properties?.remoteVirtualNetwork?.id),
            }));

            // Check if empty VNet (0 subnets or all subnets empty)
            const totalConnected = details.subnets.reduce((sum: number, s: any) => sum + (s.connectedDevicesCount || 0), 0);
            if (subnetsCount === 0 || (subnetsCount > 0 && totalConnected === 0)) {
                isOrphan = true;
                orphanReasonKey = "orph_VNET_NO_DEVICES";
                costBreakdownReasonKey = "cbr_VNET_EMPTY_HYGIENE";
                remediations.push({
                    id: `rem-empty-vnet-${name}`,
                    resourceId: id,
                    resourceName: name,
                    category: "EMPTY_VNET",
                    params: { name, cidr: cidrOrPrivateIp, rg: resourceGroup },
                    estimatedSavingsUSD: monthlyCostUSD,
                    confidence: "HIGH",
                    actionType: "AUDIT",
                    commandPayload: {
                        cli: `az network vnet delete --name "${name}" --resource-group "${resourceGroup}" --subscription "${subscriptionId}"`,
                        powershell: `Remove-AzVirtualNetwork -Name "${name}" -ResourceGroupName "${resourceGroup}"`,
                    },
                });
            } else {
                costBreakdownReasonKey = linkedVnetsCount > 0 ? "cbr_PEERING_TELEMETRY" : "cbr_BASE_INFRA";
            }
        } else if (armType === "microsoft.network/privateendpoints") {
            serviceType = "Private Endpoints";
            serviceLabel = "Private Endpoint";
            subnetsCount = 1;
            const customDns = raw.properties?.customDnsConfigs || [];
            const nicConfigs = raw.properties?.networkInterfaces || [];
            const dnsList: string[] = [];
            for (const d of customDns) {
                if (d.ipAddresses && Array.isArray(d.ipAddresses)) {
                    dnsList.push(...d.ipAddresses);
                }
            }
            cidrOrPrivateIp = dnsList.length > 0 ? dnsList.join(", ") : "IP Privada Asignada";
            targetResourceId = raw.properties?.privateLinkServiceConnections?.[0]?.properties?.privateLinkServiceId;
            details.privateIp = cidrOrPrivateIp;
            details.targetResourceName = extractNameFromId(targetResourceId);
            details.customDnsConfigs = customDns;

            if (monthlyCostUSD === 0) {
                // Base cost per PE: ~$7.30/mo ($0.01/hr)
                monthlyCostUSD = 7.30;
            }
            costBreakdownReasonKey = "cbr_PE_FIXED_PROCESSING";

            if (env === "dev" || env === "staging" || env === "qa") {
                remediations.push({
                    id: `rem-pe-opt-${name}`,
                    resourceId: id,
                    resourceName: name,
                    category: "PE_OPTIMIZATION",
                    params: { name, env: env.toUpperCase(), cost: monthlyCostUSD.toFixed(2) },
                    estimatedSavingsUSD: monthlyCostUSD,
                    confidence: "MEDIUM",
                    actionType: "RIGHTSIZE",
                    commandPayload: {
                        cli: `az network private-endpoint delete --name "${name}" --resource-group "${resourceGroup}" --subscription "${subscriptionId}"`,
                        powershell: `Remove-AzPrivateEndpoint -Name "${name}" -ResourceGroupName "${resourceGroup}"`,
                    },
                });
            }
        } else if (armType === "microsoft.network/privatednszones") {
            serviceType = "Private DNS Zones";
            serviceLabel = "Private DNS Zone";
            cidrOrPrivateIp = "Zona DNS Privada";
            linkedVnetsCount = Number(raw.properties?.numberOfVirtualNetworkLinks || raw.properties?.virtualNetworkLinks?.length || 0);
            if (monthlyCostUSD === 0) {
                monthlyCostUSD = 0.50; // Standard $0.50/mo hosted zone
            }
            costBreakdownReasonKey = "cbr_DNS_PRIVATE_ZONE";
            details.virtualNetworkLinksCount = linkedVnetsCount;
        } else if (armType === "microsoft.network/networksecuritygroups") {
            serviceType = "Network Security Group";
            serviceLabel = "Network Security Group";
            const subnets = raw.properties?.subnets || [];
            const nics = raw.properties?.networkInterfaces || [];
            const rules = raw.properties?.securityRules || [];
            subnetsCount = Array.isArray(subnets) ? subnets.length : 0;
            const nicsCount = Array.isArray(nics) ? nics.length : 0;
            const rulesCount = Array.isArray(rules) ? rules.length : 0;
            cidrOrPrivateIp = `${rulesCount} Reglas Inbound/Outbound`;
            details.securityRulesCount = rulesCount;
            details.hasAssociatedSubnets = subnetsCount > 0;
            details.hasAssociatedNics = nicsCount > 0;
            details.associatedNicsCount = nicsCount;

            if (subnetsCount === 0 && nicsCount === 0) {
                isOrphan = true;
                orphanReasonKey = "orph_NSG_UNUSED";
                costBreakdownReasonKey = "cbr_ORPHAN_HYGIENE";
                remediations.push({
                    id: `rem-orphan-nsg-${name}`,
                    resourceId: id,
                    resourceName: name,
                    category: "ORPHAN_NSG",
                    params: { name, rg: resourceGroup },
                    estimatedSavingsUSD: 0.00,
                    confidence: "HIGH",
                    actionType: "DELETE",
                    commandPayload: {
                        cli: `az network nsg delete --name "${name}" --resource-group "${resourceGroup}" --subscription "${subscriptionId}"`,
                        powershell: `Remove-AzNetworkSecurityGroup -Name "${name}" -ResourceGroupName "${resourceGroup}" -Force`,
                    },
                });
            } else {
                costBreakdownReasonKey = "cbr_PLATFORM_INCLUDED";
            }
        } else if (armType === "microsoft.network/routetables") {
            serviceType = "Route Table";
            serviceLabel = "Route Table (UDR)";
            const subnets = raw.properties?.subnets || [];
            const routes = raw.properties?.routes || [];
            subnetsCount = Array.isArray(subnets) ? subnets.length : 0;
            const routesCount = Array.isArray(routes) ? routes.length : 0;
            cidrOrPrivateIp = `${routesCount} Rutas Custom (UDR)`;
            details.routesCount = routesCount;
            details.hasAssociatedSubnets = subnetsCount > 0;

            if (subnetsCount === 0) {
                isOrphan = true;
                orphanReasonKey = "orph_UDR_NO_SUBNET";
                costBreakdownReasonKey = "cbr_ORPHAN_HYGIENE";
                remediations.push({
                    id: `rem-orphan-udr-${name}`,
                    resourceId: id,
                    resourceName: name,
                    category: "UNUSED_UDR",
                    params: { name },
                    estimatedSavingsUSD: 0.00,
                    confidence: "HIGH",
                    actionType: "DELETE",
                    commandPayload: {
                        cli: `az network route-table delete --name "${name}" --resource-group "${resourceGroup}" --subscription "${subscriptionId}"`,
                        powershell: `Remove-AzRouteTable -Name "${name}" -ResourceGroupName "${resourceGroup}" -Force`,
                    },
                });
            } else {
                costBreakdownReasonKey = "cbr_PLATFORM_INCLUDED";
            }
        }

        monthlyCostUSD = Number(monthlyCostUSD.toFixed(2));

        resources.push({
            id,
            name,
            serviceType,
            serviceLabel,
            cidrOrPrivateIp,
            resourceGroup,
            subscriptionId,
            subscriptionName,
            costCenterOwner,
            creationDate,
            location,
            monthlyCostUSD,
            isOrphan,
            orphanReasonKey,
            subnetsCount,
            linkedVnetsCount,
            costBreakdownReasonKey,
            targetResourceId,
            tags,
            details,
        });
    }

    const totalCostUSD = Number(resources.reduce((sum, r) => sum + r.monthlyCostUSD, 0).toFixed(2));
    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projectedEndOfMonthCostUSD = totalCostUSD > 0
        ? Number(((totalCostUSD / daysElapsed) * daysInMonth).toFixed(2))
        : 0;

    const orphanedResourcesCount = resources.filter((r) => r.isOrphan).length;
    const privateEndpointsCount = resources.filter((r) => r.serviceType === "Private Endpoints").length;
    const virtualNetworksCount = resources.filter((r) => r.serviceType === "Virtual Networks").length;
    const privateDnsZonesCount = resources.filter((r) => r.serviceType === "Private DNS Zones").length;
    const nsgUdrCount = resources.filter((r) => r.serviceType === "Network Security Group" || r.serviceType === "Route Table").length;

    const serviceTypeOrder: BasicNetworkServiceType[] = [
        "Virtual Networks",
        "Private Endpoints",
        "Private DNS Zones",
        "Network Security Group",
        "Route Table",
    ];

    const breakdown: BasicNetworkServiceBreakdown[] = serviceTypeOrder.map((st) => {
        const matching = resources.filter((r) => r.serviceType === st);
        const cost = Number(matching.reduce((sum, r) => sum + r.monthlyCostUSD, 0).toFixed(2));
        const percentage = totalCostUSD > 0 ? Number(((cost / totalCostUSD) * 100).toFixed(1)) : 0;
        return {
            serviceName: st,
            serviceLabel: st === "Route Table" ? "Route Tables (UDR)" : st === "Network Security Group" ? "NSGs" : st,
            costUSD: cost,
            percentage,
            color: BASIC_NETWORK_COLORS[st],
            count: matching.length,
        };
    });

    return {
        success: true,
        mock: false,
        kpis: {
            totalCostUSD,
            projectedEndOfMonthCostUSD,
            totalResourcesCount: resources.length,
            orphanedResourcesCount,
            privateEndpointsCount,
            virtualNetworksCount,
            privateDnsZonesCount,
            nsgUdrCount,
            breakdown,
        },
        resources,
        remediations,
    };
}
