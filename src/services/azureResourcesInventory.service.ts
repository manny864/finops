/**
 * Service: Azure Resources Inventory & Governance
 * Gestión global de inventario, distribución por tipo, creadores y costos por etiqueta.
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { resolveCostColumn, isCostUsdUnsupportedError, degradeCostColumn, type CostColumn } from "@/lib/azureCostColumn";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { formatResourceType } from "@/lib/resourceTypeLabels";
import { withRetry, mapWithConcurrency } from "@/modules/collectors/azure/billing/billingHelpers";
import pool from "@/modules/storage/db";
import type {
    CloudResourceItem,
    TagCostSummary,
    CreatorSummary,
    ResourcesSearchResponse,
    ResourcesInventoryResponse,
    ResourcesCreatedByResponse,
    ResourcesCostsByTagResponse,
} from "@/types/azureResources.types";
import { errorMessage } from '@/lib/apiErrors';

const round2 = (x: number) => Math.round(x * 100) / 100;

// ── Mock Generator ──────────────────────────────────────────────────────────

export function generateMockResourcesSearch(
    tier: string = "Professional",
    filters: {
        subscriptionId?: string;
        resourceGroup?: string;
        tagKey?: string;
        search?: string;
        page?: number;
        pageSize?: number;
    } = {}
): ResourcesSearchResponse {
    const t = (tier || "Professional").toLowerCase();
    const multiplier = t === "enterprise" ? 50 : t === "business" ? 10 : t === "pro" || t === "professional" ? 3 : 1;
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(60, Math.max(5, filters.pageSize || 15));

    const owners = ["mchavez@cscloudsolutions.com.ar", "cynthia.perez@cscloudsolutions.com.ar", "CSCS-CloudOps", "secops@cscloudsolutions.com.ar"];
    const rgs = ["rg-prod-compute-core", "rg-data-platform-analytics", "rg-shared-network-hub", "rg-prod-database-tier", "rg-monitoring-core"];
    const typeTemplates = [
        { type: "microsoft.compute/virtualmachines", sku: "Standard_D4s_v5", baseCost: 185 },
        { type: "microsoft.storage/storageaccounts", sku: "Standard_ZRS", baseCost: 45 },
        { type: "microsoft.sql/servers/databases", sku: "GP_Gen5_4", baseCost: 280 },
        { type: "microsoft.compute/disks", sku: "Premium_LRS", baseCost: 38 },
        { type: "microsoft.web/serverfarms", sku: "P2v3", baseCost: 145 },
        { type: "microsoft.cache/redis", sku: "Premium_P2", baseCost: 210 },
        { type: "microsoft.network/publicipaddresses", sku: "Standard", baseCost: 4.5 },
        { type: "microsoft.network/virtualnetworks", sku: "Standard", baseCost: 0 },
        { type: "microsoft.keyvault/vaults", sku: "Standard", baseCost: 15 },
        { type: "microsoft.containerregistry/registries", sku: "Premium", baseCost: 50 },
    ];

    const totalCount = Math.min(250, 45 + multiplier * 15);

    let allRows: CloudResourceItem[] = Array.from({ length: totalCount }, (_, i) => {
        const tmpl = typeTemplates[i % typeTemplates.length];
        const rg = rgs[i % rgs.length];
        const owner = owners[i % owners.length];
        const costCenter = ["Engineering", "Data-Platform", "CX-Apps", "Shared-Infra", "SecOps"][i % 5];
        const env = i % 3 === 0 ? "Production" : i % 3 === 1 ? "Staging" : "Development";
        const cost = round2(tmpl.baseCost * (multiplier * 0.4 + 0.6) * (0.8 + 0.4 * Math.abs(Math.sin(i * 1.5))));
        const name = `res-${tmpl.type.split("/").pop()}-${100 + i}`;

        return {
            costSource: tmpl.baseCost > 0 ? ("cost_management" as const) : ("unmeasured" as const),
            id: `/subscriptions/mock-sub-1/resourceGroups/${rg}/providers/${tmpl.type}/${name}`,
            name,
            type: tmpl.type,
            typeDisplayName: formatResourceType(tmpl.type),
            location: i % 2 === 0 ? "eastus2" : "westeurope",
            resourceGroup: rg,
            subscriptionId: "sub-cscs-prod-01",
            subscriptionName: "CSCS-LandingZone-Production",
            skuName: tmpl.sku,
            owner,
            costGroup: costCenter,
            createdDate: new Date(Date.now() - (i + 12) * 86400000).toISOString().slice(0, 10),
            monthlyCostUSD: cost,
            tags: {
                Owner: owner,
                CostCenter: costCenter,
                Environment: env,
                CreatedBy: owner,
            },
            properties: {
                provisioningState: "Succeeded",
                vmSize: tmpl.sku,
            },
        };
    });

    if (filters.search) {
        const q = filters.search.toLowerCase();
        allRows = allRows.filter((r) => r.name.toLowerCase().includes(q) || r.typeDisplayName.toLowerCase().includes(q) || (r.skuName || "").toLowerCase().includes(q));
    }
    if (filters.resourceGroup) {
        allRows = allRows.filter((r) => r.resourceGroup.toLowerCase() === filters.resourceGroup!.toLowerCase());
    }
    if (filters.subscriptionId) {
        allRows = allRows.filter((r) => r.subscriptionId.toLowerCase() === filters.subscriptionId!.toLowerCase());
    }
    if (filters.tagKey) {
        allRows = allRows.filter((r) => Boolean(r.tags[filters.tagKey!]));
    }

    allRows.sort((a, b) => b.monthlyCostUSD - a.monthlyCostUSD);

    const paginated = allRows.slice((page - 1) * pageSize, page * pageSize);

    return {
        rows: paginated,
        total: allRows.length,
        page,
        pageSize,
        sortedByCost: true,
        kpis: {
            costGroups: 5,
            subscriptions: 1,
            resourceGroups: rgs.length,
            resources: allRows.length,
            owners: owners.length,
        },
        mock: true,
    };
}

export function generateMockResourcesInventory(tier: string = "Professional"): ResourcesInventoryResponse {
    const t = (tier || "Professional").toLowerCase();
    const multiplier = t === "enterprise" ? 50 : t === "business" ? 10 : t === "pro" || t === "professional" ? 3 : 1;

    const byType = [
        { type: "microsoft.compute/virtualmachines", count: Math.round(28 * (multiplier * 0.4 + 0.6)) },
        { type: "microsoft.compute/disks", count: Math.round(24 * (multiplier * 0.4 + 0.6)) },
        { type: "microsoft.storage/storageaccounts", count: Math.round(18 * (multiplier * 0.4 + 0.6)) },
        { type: "microsoft.network/networkinterfaces", count: Math.round(16 * (multiplier * 0.4 + 0.6)) },
        { type: "microsoft.sql/servers/databases", count: Math.round(9 * (multiplier * 0.4 + 0.6)) },
        { type: "microsoft.web/serverfarms", count: Math.round(6 * (multiplier * 0.4 + 0.6)) },
        { type: "microsoft.network/publicipaddresses", count: Math.round(8 * (multiplier * 0.4 + 0.6)) },
        { type: "microsoft.network/privatednszones", count: Math.round(5 * (multiplier * 0.4 + 0.6)) },
    ].map((item) => ({
        ...item,
        friendlyName: formatResourceType(item.type),
    }));

    const totalRes = byType.reduce((s, i) => s + i.count, 0);

    return {
        byType,
        bySubscription: [
            {
                subscriptionId: "sub-cscs-prod-01",
                subscriptionName: "CSCS-LandingZone-Production",
                count: Math.round(totalRes * 0.7),
            },
            {
                subscriptionId: "sub-cscs-data-02",
                subscriptionName: "CSCS-LandingZone-DataPlatform",
                count: Math.round(totalRes * 0.3),
            },
        ],
        byRegion: [
            { location: "eastus2", count: Math.round(totalRes * 0.6) },
            { location: "westeurope", count: Math.round(totalRes * 0.4) },
        ],
        kpis: {
            costGroups: 5,
            subscriptions: 2,
            resourceGroups: 11,
            resources: totalRes,
            owners: 4,
        },
        mock: true,
    };
}

export function generateMockResourcesCreatedBy(tier: string = "Professional"): ResourcesCreatedByResponse {
    const t = (tier || "Professional").toLowerCase();
    const multiplier = t === "enterprise" ? 50 : t === "business" ? 10 : t === "pro" || t === "professional" ? 3 : 1;

    const rows: CreatorSummary[] = [
        {
            creatorName: "mchavez@cscloudsolutions.com.ar",
            resourcesCount: Math.round(38 * (multiplier * 0.4 + 0.6)),
            resourceGroupsCount: 6,
            subscriptionsCount: 2,
        },
        {
            creatorName: "CSCS-CloudOps (Automation Pipeline)",
            resourcesCount: Math.round(45 * (multiplier * 0.4 + 0.6)),
            resourceGroupsCount: 8,
            subscriptionsCount: 2,
        },
        {
            creatorName: "cynthia.perez@cscloudsolutions.com.ar",
            resourcesCount: Math.round(18 * (multiplier * 0.4 + 0.6)),
            resourceGroupsCount: 3,
            subscriptionsCount: 1,
        },
        {
            creatorName: "secops@cscloudsolutions.com.ar",
            resourcesCount: Math.round(12 * (multiplier * 0.4 + 0.6)),
            resourceGroupsCount: 2,
            subscriptionsCount: 1,
        },
    ];

    return {
        rows,
        kpis: {
            createdBy: rows.length,
            costGroups: 5,
            subscriptions: 2,
            resourceGroups: 11,
            resources: rows.reduce((s, r) => s + r.resourcesCount, 0),
        },
        mock: true,
    };
}

export function generateMockResourcesCostsByTag(tier: string = "Professional"): ResourcesCostsByTagResponse {
    const t = (tier || "Professional").toLowerCase();
    const multiplier = t === "enterprise" ? 50 : t === "business" ? 10 : t === "pro" || t === "professional" ? 3 : 1;

    const mkTag = (tagKey: string, pairs: Array<[string, number, number]>): TagCostSummary => {
        const values = pairs.map(([tagValue, count, cost]) => ({
            tagValue,
            resourcesCount: Math.round(count * (multiplier * 0.4 + 0.6)),
            costUSD: round2(cost * multiplier),
        }));
        return {
            tagKey,
            distinctValuesCount: values.length,
            taggedResourcesCount: values.reduce((s, v) => s + v.resourcesCount, 0),
            monthlySpendUSD: round2(values.reduce((s, v) => s + v.costUSD, 0)),
            values,
        };
    };

    const tags: TagCostSummary[] = [
        mkTag("CostCenter", [
            ["Engineering", 32, 4800],
            ["Data-Platform", 24, 3600],
            ["CX-Apps", 18, 2400],
            ["Shared-Infra", 14, 1800],
            ["SecOps", 9, 1200],
        ]),
        mkTag("Environment", [
            ["Production", 55, 9200],
            ["Staging", 28, 3100],
            ["Development", 18, 1400],
        ]),
        mkTag("Owner", [
            ["mchavez@cscloudsolutions.com.ar", 38, 5400],
            ["CSCS-CloudOps", 45, 6100],
            ["cynthia.perez@cscloudsolutions.com.ar", 18, 2200],
        ]),
        mkTag("Project", [
            ["FinOps-Hub", 28, 4200],
            ["AI-Foundry", 22, 3800],
            ["Core-Payments", 16, 2900],
        ]),
        mkTag("Criticality", [
            ["Tier-1-Mission-Critical", 42, 8500],
            ["Tier-2-Business-Standard", 34, 3800],
            ["Tier-3-Non-Production", 21, 1400],
        ]),
    ];

    return {
        tags,
        kpis: {
            resources: tags[0].taggedResourcesCount + 15,
            resourcesWithTags: tags[0].taggedResourcesCount,
            resourcesWithoutTags: 15,
            tagNames: tags.length,
            tagValues: tags.reduce((s, t) => s + t.distinctValuesCount, 0),
            costGroups: 5,
            subscriptions: 2,
            resourceGroups: 11,
        },
        // Paridad con el camino vivo: el promedio diario divide por los días
        // transcurridos del MTD, no por 30.
        daysInPeriod: Math.max(1, new Date().getUTCDate()),
        mock: true,
    };
}

// ── Live Azure Implementation ───────────────────────────────────────────────

async function runResourceGraphQuery(
    tenantId: string,
    subs: string[],
    query: string,
    top?: number,
    skip?: number
): Promise<any[]> {
    if (subs.length === 0) return [];
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);
    const rows: any[] = [];
    let skipToken: string | undefined;
    do {
        const result: any = await client.resources({
            subscriptions: subs,
            query,
            options: {
                resultFormat: "objectArray",
                ...(top ? { top } : {}),
                ...(skip !== undefined ? { skip } : {}),
                ...(skipToken ? { skipToken } : {}),
            },
        });
        rows.push(...((result.data as any[]) || []));
        skipToken = result.skipToken;
    } while (skipToken && top === undefined);
    return rows;
}

export async function getResourceCostsById(
    tenantId: string,
    resources: Array<{ id: string; subscriptionId: string }>
): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (resources.length === 0) return result;

    // 1. Intentar resolver desde CostSnapshots en MySQL primero (rápido y exacto)
    try {
        const idList = resources.map((r) => r.id.toLowerCase());
        const placeholders = idList.map(() => "?").join(",");
        const [dbRows]: any = await pool.query(
            `SELECT LOWER(ResourceId) AS rid, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
             FROM CostSnapshots
             WHERE tenant_id = ? AND LOWER(ResourceId) IN (${placeholders})
             GROUP BY LOWER(ResourceId)`,
            [tenantId, ...idList]
        );
        for (const r of dbRows || []) {
            if (r.rid) result.set(String(r.rid).toLowerCase(), Number(Number(r.cost).toFixed(2)));
        }
    } catch (e) {
        console.warn("[azureResourcesInventory] MySQL CostSnapshots cache miss:", errorMessage(e));
    }

    const missingResources = resources.filter((r) => !result.has(r.id.toLowerCase()));
    if (missingResources.length === 0) return result;

    // 2. Resolver los faltantes con Cost Management API
    const bySub = new Map<string, string[]>();
    for (const r of missingResources) {
        if (!bySub.has(r.subscriptionId)) bySub.set(r.subscriptionId, []);
        bySub.get(r.subscriptionId)!.push(r.id);
    }

    try {
        const credential = await getAzureCredential(tenantId);
        const client = new CostManagementClient(credential);
        const col: CostColumn = await resolveCostColumn(tenantId);

        const buildOptions = (ids: string[], useCol: CostColumn) => ({
            type: "ActualCost",
            timeframe: "MonthToDate",
            dataset: {
                granularity: "None",
                aggregation: { totalCost: { name: useCol, function: "Sum" } },
                grouping: [{ type: "Dimension", name: "ResourceId" }],
                filter: { dimensions: { name: "ResourceId", operator: "In", values: ids } },
            },
        } as any);

        const entries = Array.from(bySub.entries());
        await mapWithConcurrency(entries, 1, async ([subId, ids]: [string, string[]], idx: number) => {
            if (idx > 0) {
                await new Promise((r) => setTimeout(r, 300));
            }
            try {
                let res: any;
                try {
                    res = await withRetry(
                        () => client.query.usage(`/subscriptions/${subId}`, buildOptions(ids, col)),
                        { label: `inventory-cost(sub ${subId})`, maxRetries: 3, baseDelayMs: 2000 }
                    );
                } catch (e) {
                    if (col === "CostUSD" && isCostUsdUnsupportedError(e)) {
                        await degradeCostColumn(tenantId);
                        res = await withRetry(
                            () => client.query.usage(`/subscriptions/${subId}`, buildOptions(ids, "PreTaxCost")),
                            { label: `inventory-cost(sub ${subId}, PreTaxCost)`, maxRetries: 3, baseDelayMs: 2000 }
                        );
                    } else {
                        throw e;
                    }
                }
                const cols: any[] = res?.columns || [];
                const costIdx = cols.findIndex((c) => /cost/i.test(c.name));
                const ridIdx = cols.findIndex((c) => c.name === "ResourceId");
                for (const row of res?.rows || []) {
                    const rid = String(row[ridIdx] || "").toLowerCase();
                    const cost = Number(row[costIdx]) || 0;
                    result.set(rid, Number(((result.get(rid) || 0) + cost).toFixed(2)));
                }
            } catch (e: any) {
                const isPrivilegeError = /does not have the privilege|unauthorized|forbidden|authorizationfailed|accessdenied/i.test(e?.message || '');
                if (isPrivilegeError) {
                    console.info(`[azureResourcesInventory] Suscripción ${subId} no tiene habilitado el privilegio de visualización de costos en Azure Cost Management.`);
                } else {
                    console.warn(`[azureResourcesInventory] Cost API failed for sub ${subId}:`, errorMessage(e));
                }
            }
        });
    } catch (err) {
        console.warn("[azureResourcesInventory] Azure credential error in getResourceCostsById:", errorMessage(err));
    }

    return result;
}

export async function searchLiveResources(
    tenantId: string,
    filters: {
        subscriptionId?: string;
        resourceGroup?: string;
        tagKey?: string;
        search?: string;
        page: number;
        pageSize: number;
    }
): Promise<ResourcesSearchResponse> {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) {
        return {
            rows: [],
            total: 0,
            page: filters.page,
            pageSize: filters.pageSize,
            sortedByCost: false,
            kpis: { costGroups: 0, subscriptions: 0, resourceGroups: 0, resources: 0 },
            mock: false,
        };
    }

    const whereClauses: string[] = [];
    if (filters.subscriptionId) whereClauses.push(`subscriptionId =~ '${filters.subscriptionId.replace(/'/g, "")}'`);
    if (filters.resourceGroup) whereClauses.push(`resourceGroup =~ '${filters.resourceGroup.replace(/'/g, "")}'`);
    if (filters.tagKey) whereClauses.push(`isnotempty(tags['${filters.tagKey.replace(/'/g, "")}'])`);
    if (filters.search) whereClauses.push(`name contains '${filters.search.replace(/'/g, "")}' or type contains '${filters.search.replace(/'/g, "")}'`);
    const where = whereClauses.length ? `| where ${whereClauses.join(" and ")}` : "";

    const baseQuery = `Resources ${where}`;
    const countRows = await runResourceGraphQuery(tenantId, subs, `${baseQuery} | summarize c = count()`);
    const total = Number(countRows?.[0]?.c || 0);

    let subMap: Map<string, string> = new Map<string, string>();
    try {
        const credential = await getAzureCredential(tenantId);
        subMap = await getSubscriptionNameMap(tenantId, credential);
    } catch (e) {
        console.warn("[azureResourcesInventory] subMap error:", errorMessage(e));
    }

    const pageRows = await runResourceGraphQuery(
        tenantId,
        subs,
        `${baseQuery} | project id, name, type, location, subscriptionId, resourceGroup, sku = tostring(sku.name), tags, properties, createdTime = tostring(properties.timeCreated) | order by name asc`,
        filters.pageSize,
        (filters.page - 1) * filters.pageSize
    );

    const costMap = await getResourceCostsById(
        tenantId,
        pageRows.map((r) => ({ id: r.id, subscriptionId: r.subscriptionId }))
    );

    const [rgCountRows, costGroupRows] = await Promise.all([
        runResourceGraphQuery(tenantId, subs, `${baseQuery} | summarize by resourceGroup, subscriptionId`),
        runResourceGraphQuery(tenantId, subs, `${baseQuery} | project cc = tostring(tags['CostCenter']) | where isnotempty(cc) | summarize by cc`),
    ]);

    const rows: CloudResourceItem[] = pageRows.map((r) => {
        const tags = r.tags || {};
        // Costo REAL o nada: antes, cuando Cost Management no reportaba cargo para
        // el recurso (lo normal en Action Groups, Runbooks, extensiones de VM,
        // reglas de alerta…), se rellenaba con una estimación por tipo/SKU. De ahí
        // salían los "$20" uniformes y los "$95" en cualquier cosa cuyo tipo
        // contuviera "virtualmachines". Un recurso sin cargo directo vale 0.
        const measuredCost = costMap.get(String(r.id).toLowerCase());
        const costUSD = measuredCost ?? 0;
        return {
            id: r.id,
            name: r.name,
            type: r.type,
            typeDisplayName: formatResourceType(r.type),
            location: r.location || "global",
            resourceGroup: r.resourceGroup,
            subscriptionId: r.subscriptionId,
            subscriptionName: resolveSubscriptionName(r.subscriptionId, subMap),
            skuName: r.sku || undefined,
            owner: tags.Owner || tags.owner || tags.CreatedBy || tags.createdBy || undefined,
            costGroup: tags.CostCenter || tags.Costcenter || tags.Project || undefined,
            createdDate: r.createdTime ? String(r.createdTime).slice(0, 10) : undefined,
            monthlyCostUSD: round2(costUSD),
            // Distingue "sin cargo directo medido" de "0 medido", para que la
            // tabla pueda mostrar "—" en vez de un $0.00 que parece un dato.
            costSource: measuredCost === undefined ? "unmeasured" : "cost_management",
            tags,
            properties: r.properties || undefined,
        };
    });

    return {
        rows,
        total,
        page: filters.page,
        pageSize: filters.pageSize,
        sortedByCost: false,
        kpis: {
            costGroups: costGroupRows.length,
            subscriptions: new Set(rgCountRows.map((r) => r.subscriptionId)).size,
            resourceGroups: new Set(rgCountRows.map((r) => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: total,
        },
        mock: false,
    };
}

export async function getLiveResourcesInventory(tenantId: string): Promise<ResourcesInventoryResponse> {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) {
        return {
            byType: [],
            bySubscription: [],
            byRegion: [],
            kpis: { costGroups: 0, subscriptions: 0, resourceGroups: 0, resources: 0, owners: 0 },
            mock: false,
        };
    }

    const [byTypeRows, bySubRows, byRegionRows, rgRows, ownerRows, costGroupRows] = await Promise.all([
        runResourceGraphQuery(tenantId, subs, `Resources | summarize count_ = count() by type | order by count_ desc | limit 20`),
        runResourceGraphQuery(tenantId, subs, `Resources | summarize count_ = count() by subscriptionId`),
        runResourceGraphQuery(tenantId, subs, `Resources | summarize count_ = count() by location`),
        runResourceGraphQuery(tenantId, subs, `Resources | summarize by resourceGroup, subscriptionId`),
        runResourceGraphQuery(tenantId, subs, `Resources | project o = tostring(tags['Owner']) | where isnotempty(o) | summarize by o`),
        runResourceGraphQuery(tenantId, subs, `Resources | project cc = tostring(tags['CostCenter']) | where isnotempty(cc) | summarize by cc`),
    ]);

    let subMap: Map<string, string> = new Map<string, string>();
    try {
        const credential = await getAzureCredential(tenantId);
        subMap = await getSubscriptionNameMap(tenantId, credential);
    } catch (e) {
        console.warn("[azureResourcesInventory] subMap error:", errorMessage(e));
    }

    const byType = byTypeRows.map((r) => ({
        type: String(r.type || ""),
        count: Number(r.count_) || 0,
        friendlyName: formatResourceType(String(r.type || "")),
    }));

    const bySubscription = bySubRows.map((r) => ({
        subscriptionId: String(r.subscriptionId || ""),
        subscriptionName: resolveSubscriptionName(r.subscriptionId, subMap),
        count: Number(r.count_) || 0,
    }));

    const byRegion = byRegionRows.map((r) => ({
        location: String(r.location || "global"),
        count: Number(r.count_) || 0,
    }));

    return {
        byType,
        bySubscription,
        byRegion,
        kpis: {
            costGroups: costGroupRows.length,
            subscriptions: bySubRows.length,
            resourceGroups: new Set(rgRows.map((r) => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: byType.reduce((s, r) => s + r.count, 0),
            owners: ownerRows.length,
        },
        mock: false,
    };
}

export const generateMockCreatedByAggregation = generateMockResourcesCreatedBy;
export const generateMockCostsByTagSummary = generateMockResourcesCostsByTag;
export const getLiveCreatedByAggregation = getLiveResourcesCreatedBy;
export const getLiveCostsByTagSummary = getLiveResourcesCostsByTag;

export async function getLiveResourcesCreatedBy(tenantId: string): Promise<ResourcesCreatedByResponse> {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) {
        return {
            rows: [],
            kpis: { createdBy: 0, costGroups: 0, subscriptions: 0, resourceGroups: 0, resources: 0 },
            mock: false,
        };
    }

    const rows = await runResourceGraphQuery(
        tenantId,
        subs,
        `Resources
         | extend creator = tostring(coalesce(tags['CreatedBy'], tags['createdBy'], tags['Owner'], tags['owner']))
         | where isnotempty(creator)
         | summarize resources = count(), resourceGroups = dcount(resourceGroup), subscriptions = dcount(subscriptionId) by creator`
    );

    const [rgRows, costGroupRows, totalRows] = await Promise.all([
        runResourceGraphQuery(tenantId, subs, `Resources | summarize by resourceGroup, subscriptionId`),
        runResourceGraphQuery(tenantId, subs, `Resources | project cc = tostring(tags['CostCenter']) | where isnotempty(cc) | summarize by cc`),
        runResourceGraphQuery(tenantId, subs, `Resources | summarize c = count()`),
    ]);

    return {
        rows: rows.map((r) => ({
            creatorName: String(r.creator || "Desconocido"),
            resourcesCount: Number(r.resources) || 0,
            resourceGroupsCount: Number(r.resourceGroups) || 0,
            subscriptionsCount: Number(r.subscriptions) || 0,
        })),
        kpis: {
            createdBy: rows.length,
            costGroups: costGroupRows.length,
            subscriptions: new Set(rgRows.map((r) => r.subscriptionId)).size,
            resourceGroups: new Set(rgRows.map((r) => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: Number(totalRows?.[0]?.c || 0),
        },
        mock: false,
    };
}

export async function getLiveResourcesCostsByTag(tenantId: string): Promise<ResourcesCostsByTagResponse> {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) return { tags: [], mock: false };

    // 1. Obtener claves de tags distintas
    const tagKeyRows = await runResourceGraphQuery(
        tenantId,
        subs,
        `Resources | mv-expand bagexpansion=array tagsArr = pack_array(bag_keys(tags)) | mv-expand key = tagsArr | project key = tostring(key) | where isnotempty(key) | summarize by key | limit 12`
    );
    const keys: string[] = tagKeyRows.map((r) => r.key).filter(Boolean);

    let credential: any;
    try {
        credential = await getAzureCredential(tenantId);
    } catch {
        // Fallback si no hay credencial
    }

    const client = credential ? new CostManagementClient(credential) : null;
    const col: CostColumn = await resolveCostColumn(tenantId);

    const tags: TagCostSummary[] = [];

    for (let i = 0; i < keys.length; i += 3) {
        const batch = keys.slice(i, i + 3);
        const batchResults = await Promise.all(
            batch.map(async (key) => {
                const valuesMap = new Map<string, { resourcesCount: number; costUSD: number }>();

                // Conteo de recursos por valor de tag vía Resource Graph
                const rgTagRows = await runResourceGraphQuery(
                    tenantId,
                    subs,
                    `Resources | extend val = tostring(tags['${key.replace(/'/g, "")}']) | where isnotempty(val) | summarize c = count() by val`
                );

                for (const r of rgTagRows || []) {
                    const v = String(r.val || "").trim();
                    if (v) valuesMap.set(v, { resourcesCount: Number(r.c) || 0, costUSD: 0 });
                }

                // Costo por valor de tag vía Cost Management si hay cliente
                if (client) {
                    await mapWithConcurrency(subs, 1, async (subId: string, idx: number) => {
                        if (idx > 0) {
                            await new Promise((r) => setTimeout(r, 300));
                        }
                        try {
                            const buildOptions = (useCol: CostColumn) => ({
                                type: "ActualCost",
                                timeframe: "MonthToDate",
                                dataset: {
                                    granularity: "None",
                                    aggregation: { totalCost: { name: useCol, function: "Sum" } },
                                    grouping: [{ type: "TagKey", name: key }],
                                },
                            } as any);

                            let res: any;
                            try {
                                res = await withRetry(
                                    () => client.query.usage(`/subscriptions/${subId}`, buildOptions(col)),
                                    { label: `tag-cost(${key}, sub ${subId})`, maxRetries: 3, baseDelayMs: 2000 }
                                );
                            } catch (e) {
                                if (col === "CostUSD" && isCostUsdUnsupportedError(e)) {
                                    await degradeCostColumn(tenantId);
                                    res = await withRetry(
                                        () => client.query.usage(`/subscriptions/${subId}`, buildOptions("PreTaxCost")),
                                        { label: `tag-cost(${key}, sub ${subId}, PreTaxCost)`, maxRetries: 3, baseDelayMs: 2000 }
                                    );
                                } else {
                                    throw e;
                                }
                            }

                            const cols: any[] = res?.columns || [];
                            const costIdx = cols.findIndex((c) => /cost/i.test(c.name));
                            const tagIdx = cols.findIndex((c) => /tag/i.test(c.name));
                            for (const row of res?.rows || []) {
                                const raw = String(row[tagIdx] || "");
                                const value = raw.includes(":") ? raw.split(":").slice(1).join(":").trim() : raw.trim();
                                if (!value) continue;
                                const cost = Number(row[costIdx]) || 0;
                                const curr = valuesMap.get(value) || { resourcesCount: 1, costUSD: 0 };
                                valuesMap.set(value, {
                                    resourcesCount: curr.resourcesCount,
                                    costUSD: round2(curr.costUSD + cost),
                                });
                            }
                        } catch (e: any) {
                            const isPrivilegeError = /does not have the privilege|unauthorized|forbidden|authorizationfailed|accessdenied/i.test(e?.message || '');
                            if (isPrivilegeError) {
                                console.info(`[azureResourcesInventory] Suscripción ${subId} no tiene habilitado el privilegio de visualización de costos para tags.`);
                            } else {
                                console.warn(`[azureResourcesInventory] tag cost query failed for ${key} (sub ${subId}):`, errorMessage(e));
                            }
                        }
                    });
                }

                // Si Cost Management arrojó 0 para todos los valores, intentar resolver costos sumando desde MySQL CostSnapshots
                const totalCostFromCM = Array.from(valuesMap.values()).reduce((s, v) => s + v.costUSD, 0);
                if (totalCostFromCM === 0) {
                    try {
                        const [dbRows]: any = await pool.query(
                            `SELECT Tags, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
                             FROM CostSnapshots
                             WHERE tenant_id = ? AND Tags IS NOT NULL
                             GROUP BY Tags`,
                            [tenantId]
                        );
                        for (const row of dbRows || []) {
                            try {
                                const parsed = typeof row.Tags === "string" ? JSON.parse(row.Tags) : row.Tags;
                                if (parsed && parsed[key]) {
                                    const val = String(parsed[key]).trim();
                                    const curr = valuesMap.get(val);
                                    if (curr) {
                                        curr.costUSD = round2(curr.costUSD + Number(row.cost || 0));
                                    }
                                }
                            } catch {
                                // Ignorar parse error en fila individual
                            }
                        }
                    } catch (e) {
                        console.warn(`[azureResourcesInventory] MySQL CostSnapshots tag fallback error for ${key}:`, errorMessage(e));
                    }
                }

                // Sin estimación por recurso: antes, si ni Cost Management ni
                // CostSnapshots tenían costo para la etiqueta, se rellenaba con
                // `resourcesCount * 38.50`. De ahí venían los importes imposibles
                // en "Costo Mensual (MTD)" y, arrastrados, en el promedio diario.
                // Una etiqueta sin costo atribuible se reporta en 0.

                const values = Array.from(valuesMap.entries()).map(([tagValue, data]) => ({
                    tagValue,
                    resourcesCount: data.resourcesCount,
                    costUSD: data.costUSD,
                })).sort((a, b) => b.costUSD - a.costUSD || b.resourcesCount - a.resourcesCount);

                const taggedResourcesCount = values.reduce((s, v) => s + v.resourcesCount, 0);
                const monthlySpendUSD = round2(values.reduce((s, v) => s + v.costUSD, 0));

                return {
                    tagKey: key,
                    distinctValuesCount: values.length,
                    taggedResourcesCount,
                    monthlySpendUSD,
                    values,
                };
            })
        );

        tags.push(...batchResults);
    }

    tags.sort((a, b) => b.monthlySpendUSD - a.monthlySpendUSD || b.taggedResourcesCount - a.taggedResourcesCount);

    // Días transcurridos del mes en curso: el promedio diario debe dividir por
    // esto y no por un 30 fijo, o subestima el gasto a principios de mes.
    const daysElapsedInMonth = Math.max(1, new Date().getUTCDate());

    return { tags, mock: false, daysInPeriod: daysElapsedInMonth };
}
