import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";

type Family = "analysis" | "basic" | "hybrid" | "balancing" | "internet";

interface FamilyItemConfig {
    serviceLabel: string;
    resourceTypes: string[];
    meterWhere: string;
    snapshotWhere: string;
}

async function queryPublicIpMap(tenantId: string): Promise<Map<string, string>> {
    try {
        const arg = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.network/publicipaddresses'
            | project id = tolower(id), ip = tostring(properties.ipAddress)
        `;
        const res: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 5000 } });
        const map = new Map<string, string>();
        for (const row of (res.data as any[]) || []) {
            const id = String(row.id || "").toLowerCase();
            const ip = String(row.ip || "");
            if (id && ip) map.set(id, ip);
        }
        return map;
    } catch {
        return new Map<string, string>();
    }
}

function extractPublicIpIdsFromProperties(properties: unknown): string[] {
    if (!properties) return [];
    const raw = typeof properties === "string" ? properties : JSON.stringify(properties);
    const matches = raw.match(/\/subscriptions\/[^"'\\\s]+\/providers\/microsoft\.network\/publicipaddresses\/[^"'\\\s]+/gi) || [];
    return Array.from(new Set(matches.map((item) => item.toLowerCase())));
}

interface FamilyConfig {
    items: FamilyItemConfig[];
}

interface NetworkResourceRow {
    serviceLabel: string;
    resourceId: string;
    resourceName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    publicIp: string;
    costGroupOwner: string;
    createdAt: string;
    monthlyCost: number;
}

const MOCK_TENANT_TIER: Record<string, "pro" | "business" | "enterprise"> = {
    "22222222-3333-4444-5555-666666666666": "pro",
    "44444444-5555-6666-7777-888888888888": "business",
    "33333333-4444-5555-6666-777777777777": "enterprise",
};

const tierMultiplier = (tenantId: string): number => {
    const tier = MOCK_TENANT_TIER[tenantId] || "pro";
    if (tier === "pro") return 3;
    if (tier === "business") return 10;
    if (tier === "enterprise") return 50;
    return 1;
};

const BASIC_ITEMS: FamilyItemConfig[] = [
    {
        serviceLabel: "Virtual Networks",
        resourceTypes: ["microsoft.network/virtualnetworks"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%virtual network%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%virtual network%' OR LOWER(COALESCE(service_name,'')) LIKE '%virtual network%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%virtual network%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%virtual network%' OR LOWER(COALESCE(service_name,'')) LIKE '%virtual network%'",
    },
    {
        serviceLabel: "Subnets",
        resourceTypes: ["microsoft.network/virtualnetworks/subnets"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%subnet%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%subnet%' OR LOWER(COALESCE(service_name,'')) LIKE '%subnet%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%subnet%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%subnet%' OR LOWER(COALESCE(service_name,'')) LIKE '%subnet%'",
    },
    {
        serviceLabel: "Network Security Groups (NSG)",
        resourceTypes: ["microsoft.network/networksecuritygroups"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%network security group%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%network security group%' OR LOWER(COALESCE(service_name,'')) LIKE '%network security group%' OR LOWER(COALESCE(MeterName,'')) LIKE '%nsg%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%network security group%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%network security group%' OR LOWER(COALESCE(service_name,'')) LIKE '%network security group%' OR LOWER(COALESCE(MeterName,'')) LIKE '%nsg%'",
    },
    {
        serviceLabel: "Route Tables (UDR)",
        resourceTypes: ["microsoft.network/routetables"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%route table%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%route table%' OR LOWER(COALESCE(service_name,'')) LIKE '%route table%' OR LOWER(COALESCE(MeterName,'')) LIKE '%udr%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%route table%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%route table%' OR LOWER(COALESCE(service_name,'')) LIKE '%route table%' OR LOWER(COALESCE(MeterName,'')) LIKE '%udr%'",
    },
    {
        serviceLabel: "Private Endpoints",
        resourceTypes: ["microsoft.network/privateendpoints"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%private endpoint%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%private endpoint%' OR LOWER(COALESCE(service_name,'')) LIKE '%private endpoint%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%private endpoint%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%private endpoint%' OR LOWER(COALESCE(service_name,'')) LIKE '%private endpoint%'",
    },
    {
        serviceLabel: "Private DNS Zones",
        resourceTypes: ["microsoft.network/privatednszones"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%private dns%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%private dns%' OR LOWER(COALESCE(service_name,'')) LIKE '%private dns%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%private dns%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%private dns%' OR LOWER(COALESCE(service_name,'')) LIKE '%private dns%'",
    },
];

const HYBRID_ITEMS: FamilyItemConfig[] = [
    {
        serviceLabel: "VPN Gateway",
        resourceTypes: ["microsoft.network/virtualnetworkgateways"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%vpn gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%vpn gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%vpn gateway%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%vpn gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%vpn gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%vpn gateway%'",
    },
    {
        serviceLabel: "ExpressRoute",
        resourceTypes: ["microsoft.network/expressroutecircuits"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%expressroute%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%expressroute%' OR LOWER(COALESCE(service_name,'')) LIKE '%expressroute%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%expressroute%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%expressroute%' OR LOWER(COALESCE(service_name,'')) LIKE '%expressroute%'",
    },
    {
        serviceLabel: "Virtual WAN",
        resourceTypes: ["microsoft.network/virtualwans"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%virtual wan%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%virtual wan%' OR LOWER(COALESCE(service_name,'')) LIKE '%virtual wan%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%virtual wan%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%virtual wan%' OR LOWER(COALESCE(service_name,'')) LIKE '%virtual wan%'",
    },
    {
        serviceLabel: "Local Network Gateway",
        resourceTypes: ["microsoft.network/localnetworkgateways"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%local network gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%local network gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%local network gateway%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%local network gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%local network gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%local network gateway%'",
    },
];

const BALANCING_ITEMS: FamilyItemConfig[] = [
    {
        serviceLabel: "Load Balancer",
        resourceTypes: ["microsoft.network/loadbalancers"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%load balancer%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%load balancer%' OR LOWER(COALESCE(service_name,'')) LIKE '%load balancer%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%load balancer%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%load balancer%' OR LOWER(COALESCE(service_name,'')) LIKE '%load balancer%'",
    },
    {
        serviceLabel: "Application Gateway",
        resourceTypes: ["microsoft.network/applicationgateways"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%application gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%application gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%application gateway%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%application gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%application gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%application gateway%'",
    },
    {
        serviceLabel: "Front Door",
        resourceTypes: ["microsoft.network/frontdoors", "microsoft.cdn/profiles"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%front door%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%front door%' OR LOWER(COALESCE(service_name,'')) LIKE '%front door%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%front door%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%front door%' OR LOWER(COALESCE(service_name,'')) LIKE '%front door%'",
    },
    {
        serviceLabel: "Traffic Manager",
        resourceTypes: ["microsoft.network/trafficmanagerprofiles"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%traffic manager%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%traffic manager%' OR LOWER(COALESCE(service_name,'')) LIKE '%traffic manager%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%traffic manager%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%traffic manager%' OR LOWER(COALESCE(service_name,'')) LIKE '%traffic manager%'",
    },
];

const INTERNET_ITEMS: FamilyItemConfig[] = [
    {
        serviceLabel: "Public IP",
        resourceTypes: ["microsoft.network/publicipaddresses"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%public ip%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%public ip%' OR LOWER(COALESCE(service_name,'')) LIKE '%public ip%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%public ip%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%public ip%' OR LOWER(COALESCE(service_name,'')) LIKE '%public ip%'",
    },
    {
        serviceLabel: "NAT Gateway",
        resourceTypes: ["microsoft.network/natgateways"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%nat gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%nat gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%nat gateway%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%nat gateway%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%nat gateway%' OR LOWER(COALESCE(service_name,'')) LIKE '%nat gateway%'",
    },
    {
        serviceLabel: "Azure Firewall",
        resourceTypes: ["microsoft.network/azurefirewalls"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%firewall%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%firewall%' OR LOWER(COALESCE(service_name,'')) LIKE '%firewall%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%firewall%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%firewall%' OR LOWER(COALESCE(service_name,'')) LIKE '%firewall%'",
    },
    {
        serviceLabel: "DDoS Protection",
        resourceTypes: ["microsoft.network/ddosprotectionplans"],
        meterWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%ddos%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%ddos%' OR LOWER(COALESCE(service_name,'')) LIKE '%ddos%'",
        snapshotWhere: "LOWER(COALESCE(MeterName,'')) LIKE '%ddos%' OR LOWER(COALESCE(MeterSubCategory,'')) LIKE '%ddos%' OR LOWER(COALESCE(service_name,'')) LIKE '%ddos%'",
    },
];

const FAMILY_CONFIG: Record<Family, FamilyConfig> = {
    analysis: { items: [...BASIC_ITEMS, ...HYBRID_ITEMS, ...BALANCING_ITEMS, ...INTERNET_ITEMS] },
    basic: { items: BASIC_ITEMS },
    hybrid: { items: HYBRID_ITEMS },
    balancing: { items: BALANCING_ITEMS },
    internet: { items: INTERNET_ITEMS },
};

async function queryCostMeterSum(tenantId: string, whereClause: string): Promise<number> {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM CostMeterSnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND (${whereClause})`,
        [tenantId]
    );
    return Number(rows?.[0]?.total || 0);
}

async function queryCostSnapshotsSum(tenantId: string, whereClause: string): Promise<number> {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(SUM(COALESCE(BilledCost, cost_usd, 0)), 0) AS total
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND (${whereClause})`,
        [tenantId]
    );
    return Number(rows?.[0]?.total || 0);
}

async function queryCostCategorySum(tenantId: string, resourceTypes: string[]): Promise<number> {
    if (!resourceTypes.length) return 0;
    const placeholders = resourceTypes.map(() => "?").join(",");
    const [rows]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM CostCategorySnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND LOWER(resource_type) IN (${placeholders})`,
        [tenantId, ...resourceTypes.map((type) => type.toLowerCase())]
    );
    return Number(rows?.[0]?.total || 0);
}

async function queryHybridCost(tenantId: string, meterWhere: string, snapshotWhere: string): Promise<number> {
    const meterCost = await queryCostMeterSum(tenantId, meterWhere);
    if (meterCost > 0) return meterCost;
    return queryCostSnapshotsSum(tenantId, snapshotWhere);
}

async function queryArgCountsByType(tenantId: string, resourceTypes: string[]): Promise<Map<string, number>> {
    if (resourceTypes.length === 0) return new Map<string, number>();
    try {
        const arg = await getResourceGraphClient(tenantId);
        const types = resourceTypes.map((t) => `'${t}'`).join(",");
        const query = `
            Resources
            | where type in~ (${types})
            | summarize resourceCount = count() by resourceType = tolower(type)
        `;
        const res: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        const counts = new Map<string, number>();
        for (const row of (res.data as any[]) || []) {
            counts.set(String(row.resourceType || "").toLowerCase(), Number(row.resourceCount || 0));
        }
        return counts;
    } catch {
        return new Map<string, number>();
    }
}

async function queryArgResourcesByType(tenantId: string, resourceTypes: string[]): Promise<any[]> {
    if (resourceTypes.length === 0) return [];
    try {
        const arg = await getResourceGraphClient(tenantId);
        const types = resourceTypes.map((t) => `'${t}'`).join(",");
        const query = `
            Resources
            | where type in~ (${types})
            | project id, name, type, resourceGroup, subscriptionId, tags, properties,
                     publicIp = tostring(properties.ipAddress),
                     createdAt = tostring(coalesce(
                        properties.creationTime,
                        properties.createdTime,
                        properties.timeCreated,
                        properties.provisioningTime,
                        properties.provisioningTimestamp,
                        properties.metadata.createdAt
                     ))
        `;
        const res: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        return (res.data as any[]) || [];
    } catch {
        return [];
    }
}

async function queryResourceCosts(tenantId: string): Promise<Map<string, number>> {
    const [rows]: any = await pool.query(
        `SELECT LOWER(ResourceId) AS resourceId, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND ResourceId IS NOT NULL
           AND ResourceId <> ''
         GROUP BY LOWER(ResourceId)`,
        [tenantId]
    );
    const allCosts = new Map<string, number>();
    for (const row of rows || []) {
        allCosts.set(String(row.resourceId || ""), Number(row.total || 0));
    }
    return allCosts;
}

function parseTags(tags: unknown): Record<string, string> {
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

function resolveCostGroupOwner(tags: Record<string, string>): string {
    const entries = Object.entries(tags);
    const get = (key: string) => entries.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
    return get("CostOwner") || get("Owner") || get("CostCenterOwner") || get("CostCenter") || get("OwnerGroup") || "-";
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const rawFamily = searchParams.get("family");
        const family: Family = (rawFamily && rawFamily in FAMILY_CONFIG) ? (rawFamily as Family) : "basic";

        const isMockParam = searchParams.get("mock") === "true";
        if (
            !tenantId ||
            isMockTenant(tenantId) ||
            tenantId.startsWith("mock-") ||
            tenantId.startsWith("demo-") ||
            tenantId === "demo_tenant" ||
            isMockParam
        ) {
            const multiplier = tierMultiplier(tenantId || "demo-tenant-id");
            const items = FAMILY_CONFIG[family].items.map((item, idx) => ({
                serviceLabel: item.serviceLabel,
                monthlyCost: Number((55 * multiplier + idx * 23.15 * multiplier).toFixed(2)),
                resourceCount: 2 + (idx % 4) + (multiplier > 1 ? 1 : 0),
            }));
            const rows: NetworkResourceRow[] = items.flatMap((item, idx) =>
                Array.from({ length: item.resourceCount }).map((_, rowIdx) => ({
                    serviceLabel: item.serviceLabel,
                    resourceId: `/subscriptions/mock-sub/resourceGroups/mock-rg/providers/mock.network/${family}-${idx}-${rowIdx}`,
                    resourceName: `${family}-resource-${idx + 1}-${rowIdx + 1}`,
                    resourceGroup: `mock-rg-${(idx % 3) + 1}`,
                    subscriptionId: `mock-sub-${(idx % 3) + 1}`,
                    subscriptionName: ["Production", "Staging", "Sandbox"][idx % 3],
                    publicIp: idx % 2 === 0 ? `20.40.${idx}.${10 + rowIdx}` : "-",
                    costGroupOwner: ["CostCenter-Platform", "CostCenter-Data", "CostCenter-Shared"][idx % 3],
                    createdAt: "2026-01-01T00:00:00Z",
                    monthlyCost: Number((item.monthlyCost / Math.max(item.resourceCount, 1)).toFixed(2)),
                }))
            );
            return NextResponse.json({
                success: true,
                mock: true,
                family,
                items,
                rows,
                totalMonthlyCost: Number(rows.reduce((sum, row) => sum + row.monthlyCost, 0).toFixed(2)),
                dataAvailable: true,
            });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) {
                return NextResponse.json({ error: e.message }, { status: e.status });
            }
            throw e;
        }

        const data = await getWithStaleWhileRevalidate(
            `network-service-cost:v4:${tenantId}:${family}`,
            async () => {
                const config = FAMILY_CONFIG[family];
                const allTypes: string[] = Array.from(
                    new Set(config.items.flatMap((item: any) => item.resourceTypes.map((t: string) => t.toLowerCase())))
                );

                const [countsByType, resources, allResourceCosts] = await Promise.all([
                    queryArgCountsByType(tenantId, allTypes),
                    queryArgResourcesByType(tenantId, allTypes),
                    queryResourceCosts(tenantId),
                ]);
                const credential = await getAzureCredential(tenantId);
                const subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);
                const normalizedSubNameMap = new Map<string, string>();
                for (const [key, value] of subscriptionNameMap.entries()) {
                    normalizedSubNameMap.set(String(key).toLowerCase(), String(value));
                }
                const publicIpMap = await queryPublicIpMap(tenantId);

                const items = await Promise.all(
                    config.items.map(async (item: any) => {
                        const resourceCount = item.resourceTypes.reduce(
                            (sum: number, type: string) => sum + Number(countsByType.get(type.toLowerCase()) || 0),
                            0
                        );
                        const categoryCost = await queryCostCategorySum(tenantId, item.resourceTypes);
                        const fallbackCost = categoryCost > 0 ? categoryCost : await queryHybridCost(tenantId, item.meterWhere, item.snapshotWhere);
                        return { serviceLabel: item.serviceLabel, monthlyCost: Number(fallbackCost.toFixed(2)), resourceCount };
                    })
                );

                const rows: NetworkResourceRow[] = resources.map((resource: any) => {
                    const resourceType = String(resource.type || "").toLowerCase();
                    const service = config.items.find((item: any) =>
                        item.resourceTypes.map((type: string) => type.toLowerCase()).includes(resourceType)
                    );
                    const tags = parseTags(resource.tags);
                    const normalizedResourceId = String(resource.id || "").toLowerCase();
                    const subscriptionId = String(resource.subscriptionId || "");
                    const normalizedSubscriptionId = subscriptionId.toLowerCase();
                    const resolvedSubscriptionName = resolveSubscriptionName(subscriptionId, subscriptionNameMap)
                        || normalizedSubNameMap.get(normalizedSubscriptionId)
                        || subscriptionId
                        || "-";
                    const directPublicIp = String(resource.publicIp || "");
                    const referencedPublicIps = extractPublicIpIdsFromProperties(resource.properties)
                        .map((id) => publicIpMap.get(id))
                        .filter((ip): ip is string => Boolean(ip));
                    const allPublicIps = Array.from(new Set([
                        ...(directPublicIp ? [directPublicIp] : []),
                        ...referencedPublicIps,
                    ]));
                    return {
                        serviceLabel: service?.serviceLabel || resourceType,
                        resourceId: String(resource.id || "-"),
                        resourceName: String(resource.name || "-"),
                        resourceGroup: String(resource.resourceGroup || "-"),
                        subscriptionId,
                        subscriptionName: resolvedSubscriptionName,
                        publicIp: allPublicIps.length > 0 ? allPublicIps.join(", ") : "-",
                        costGroupOwner: resolveCostGroupOwner(tags),
                        createdAt: String(resource.createdAt || ""),
                        monthlyCost: Number((allResourceCosts.get(normalizedResourceId) || 0).toFixed(2)),
                    };
                });

                for (const item of items) {
                    const serviceRows = rows.filter((row) => row.serviceLabel === item.serviceLabel);
                    if (serviceRows.length === 0) continue;
                    const serviceCost = serviceRows.reduce((sum, row) => sum + row.monthlyCost, 0);
                    if (serviceCost === 0 && item.monthlyCost > 0) {
                        const splitCost = Number((item.monthlyCost / serviceRows.length).toFixed(2));
                        serviceRows.forEach((row) => {
                            row.monthlyCost = splitCost;
                        });
                    }
                }

                return {
                    success: true,
                    mock: false,
                    family,
                    items,
                    rows,
                    totalMonthlyCost: Number(rows.reduce((sum, row) => sum + row.monthlyCost, 0).toFixed(2)),
                    dataAvailable: true,
                };
            },
            1800,
            600
        );

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[network/service-cost-v2] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
