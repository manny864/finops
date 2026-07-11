import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { resolveCostColumn, isCostUsdUnsupportedError, degradeCostColumn, type CostColumn } from "@/lib/azureCostColumn";

// ─────────────────────────────────────────────────────────────────────────────
// Inventario de recursos (Resource Graph) + costo (Cost Management), en apoyo
// a la sección "Recursos". Todo en vivo contra Azure — sin fabricar datos que
// Azure no expone (p.ej. "Last Login" de un usuario requiere Microsoft Graph
// con permisos que este Service Principal no tiene; se omite en vez de
// inventarlo).
// ─────────────────────────────────────────────────────────────────────────────

export interface InventoryResourceRow {
    id: string;
    name: string;
    type: string;
    subscriptionId: string;
    resourceGroup: string;
    tags: Record<string, string>;
    createdTime: string | null; // best-effort desde properties.timeCreated (no todos los tipos lo exponen)
}

async function runResourceGraphQuery(tenantId: string, subs: string[], query: string, top?: number, skip?: number): Promise<any[]> {
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
        // Si el caller pidió una página específica (top/skip), no seguimos paginando.
    } while (skipToken && top === undefined);
    return rows;
}

export interface SearchResourcesFilters {
    subscriptionId?: string;
    resourceGroup?: string;
    tagKey?: string;
    tagValue?: string;
    search?: string;
    page: number;
    pageSize: number;
}

export async function searchResources(tenantId: string, filters: SearchResourcesFilters) {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) {
        return { rows: [] as InventoryResourceRow[], total: 0, kpis: { costGroups: 0, subscriptions: 0, resourceGroups: 0, resources: 0 } };
    }

    const whereClauses: string[] = [];
    if (filters.subscriptionId) whereClauses.push(`subscriptionId =~ '${filters.subscriptionId.replace(/'/g, "")}'`);
    if (filters.resourceGroup) whereClauses.push(`resourceGroup =~ '${filters.resourceGroup.replace(/'/g, "")}'`);
    if (filters.tagKey) whereClauses.push(`isnotempty(tags['${filters.tagKey.replace(/'/g, "")}'])`);
    if (filters.search) whereClauses.push(`name contains '${filters.search.replace(/'/g, "")}'`);
    const where = whereClauses.length ? `| where ${whereClauses.join(" and ")}` : "";

    const baseQuery = `Resources ${where}`;
    const countRows = await runResourceGraphQuery(tenantId, subs, `${baseQuery} | summarize c = count()`);
    const total = Number(countRows?.[0]?.c || 0);

    const pageRows = await runResourceGraphQuery(
        tenantId, subs,
        `${baseQuery} | project id, name, type, subscriptionId, resourceGroup, tags, createdTime = tostring(properties.timeCreated) | order by name asc`,
        filters.pageSize,
        (filters.page - 1) * filters.pageSize
    );

    const rows: InventoryResourceRow[] = pageRows.map(r => ({
        id: r.id, name: r.name, type: r.type, subscriptionId: r.subscriptionId,
        resourceGroup: r.resourceGroup, tags: r.tags || {}, createdTime: r.createdTime || null,
    }));

    // KPIs sobre el universo COMPLETO (no solo la página).
    const [rgCountRows, costGroupRows] = await Promise.all([
        runResourceGraphQuery(tenantId, subs, `${baseQuery} | summarize by resourceGroup, subscriptionId`),
        runResourceGraphQuery(tenantId, subs, `${baseQuery} | project cc = tostring(tags['CostCenter']) | where isnotempty(cc) | summarize by cc`),
    ]);

    // Costo en vivo SOLO para los recursos de la página actual (acotado —
    // evita una consulta de Cost Management a nivel de todo el tenant).
    const costMap = await getResourceCostsById(tenantId, rows.map(r => ({ id: r.id, subscriptionId: r.subscriptionId })));

    return {
        rows: rows.map(r => ({ ...r, periodCost: costMap.get(r.id.toLowerCase()) || 0 })),
        total,
        kpis: {
            costGroups: costGroupRows.length,
            subscriptions: new Set(rgCountRows.map(r => r.subscriptionId)).size,
            resourceGroups: new Set(rgCountRows.map(r => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: total,
        },
    };
}

/**
 * Costo del mes en curso (MonthToDate) para un set acotado de ResourceIds,
 * vía Cost Management filtrado por dimensión ResourceId (no un group-by de
 * todo el tenant). Se agrupa por suscripción porque el scope de la Cost
 * Management API es por suscripción.
 */
export async function getResourceCostsById(tenantId: string, resources: Array<{ id: string; subscriptionId: string }>): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (resources.length === 0) return result;

    const bySub = new Map<string, string[]>();
    for (const r of resources) {
        if (!bySub.has(r.subscriptionId)) bySub.set(r.subscriptionId, []);
        bySub.get(r.subscriptionId)!.push(r.id);
    }

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

    await Promise.all(Array.from(bySub.entries()).map(async ([subId, ids]) => {
        // Cost Management admite hasta ~1000 valores por filtro In; nuestras
        // páginas son chicas (20-50 filas) así que no hace falta trocear.
        try {
            let res: any;
            try {
                res = await client.query.usage(`/subscriptions/${subId}`, buildOptions(ids, col));
            } catch (e: any) {
                if (col === "CostUSD" && isCostUsdUnsupportedError(e)) {
                    await degradeCostColumn(tenantId);
                    res = await client.query.usage(`/subscriptions/${subId}`, buildOptions(ids, "PreTaxCost"));
                } else {
                    throw e;
                }
            }
            const cols: any[] = res?.columns || [];
            const costIdx = cols.findIndex(c => /cost/i.test(c.name));
            const ridIdx = cols.findIndex(c => c.name === "ResourceId");
            for (const row of (res?.rows || [])) {
                const rid = String(row[ridIdx] || "").toLowerCase();
                const cost = Number(row[costIdx]) || 0;
                result.set(rid, (result.get(rid) || 0) + cost);
            }
        } catch (e: any) {
            console.warn(`[resourceInventory] costo por recurso falló para sub ${subId}:`, e?.message);
        }
    }));

    return result;
}

export async function getInventoryDistribution(tenantId: string) {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) return { byType: [], bySubscription: [], kpis: { costGroups: 0, subscriptions: 0, resourceGroups: 0, resources: 0, owners: 0 } };

    const [byType, bySub, rgRows, ownerRows, costGroupRows] = await Promise.all([
        runResourceGraphQuery(tenantId, subs, `Resources | summarize count() by type | order by count_ desc | limit 15`),
        runResourceGraphQuery(tenantId, subs, `Resources | summarize count() by subscriptionId`),
        runResourceGraphQuery(tenantId, subs, `Resources | summarize by resourceGroup, subscriptionId`),
        runResourceGraphQuery(tenantId, subs, `Resources | project o = tostring(tags['Owner']) | where isnotempty(o) | summarize by o`),
        runResourceGraphQuery(tenantId, subs, `Resources | project cc = tostring(tags['CostCenter']) | where isnotempty(cc) | summarize by cc`),
    ]);

    return {
        byType: byType.map(r => ({ type: String(r.type || "").split("/").pop(), count: Number(r.count_) || 0 })),
        bySubscription: bySub.map(r => ({ subscriptionId: r.subscriptionId, count: Number(r.count_) || 0 })),
        kpis: {
            costGroups: costGroupRows.length,
            subscriptions: bySub.length,
            resourceGroups: new Set(rgRows.map(r => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: byType.reduce((s, r) => s + (Number(r.count_) || 0), 0),
            owners: ownerRows.length,
        },
    };
}

/**
 * "Creado por": Azure Resource Graph no trae el caller de creación (eso vive
 * en Activity Log, una API mucho más pesada de recorrer por suscripción).
 * Se usa la etiqueta CreatedBy/Owner como proxy real (muchas organizaciones
 * la auto-taggean en su pipeline de aprovisionamiento) — no es 1:1 con
 * "Created By" del portal de Azure, pero es dato real, no inventado.
 */
export async function getCreatedByAggregation(tenantId: string) {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) return { rows: [], kpis: { createdBy: 0, costGroups: 0, subscriptions: 0, resourceGroups: 0, resources: 0 } };

    const rows = await runResourceGraphQuery(
        tenantId, subs,
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
        rows: rows.map(r => ({
            userName: r.creator, resources: Number(r.resources) || 0,
            resourceGroups: Number(r.resourceGroups) || 0, subscriptions: Number(r.subscriptions) || 0,
        })),
        kpis: {
            createdBy: rows.length,
            costGroups: costGroupRows.length,
            subscriptions: new Set(rgRows.map(r => r.subscriptionId)).size,
            resourceGroups: new Set(rgRows.map(r => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: Number(totalRows?.[0]?.c || 0),
        },
    };
}

/** Claves de etiqueta distintas presentes en el tenant (para "Costs by Tag"). */
export async function getDistinctTagKeys(tenantId: string): Promise<string[]> {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) return [];
    const rows = await runResourceGraphQuery(tenantId, subs, `Resources | mv-expand bagexpansion=array tagsArr = pack_array(bag_keys(tags)) | mv-expand key = tagsArr | project key = tostring(key) | where isnotempty(key) | summarize by key`);
    return rows.map(r => r.key).filter(Boolean).slice(0, 12);
}

/**
 * Costo por VALOR de una etiqueta, vía Cost Management agrupado por TagKey
 * (Azure agrega esto internamente a nivel de recurso — es la misma fuente que
 * usa el portal para "Costs by Tag").
 */
export async function getCostByTagKey(tenantId: string, tagKey: string): Promise<Array<{ value: string; cost: number }>> {
    const subs = await getSubscriptionsForTenant(tenantId);
    if (subs.length === 0) return [];
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);
    const col: CostColumn = await resolveCostColumn(tenantId);

    const buildOptions = (useCol: CostColumn) => ({
        type: "ActualCost",
        timeframe: "TheLastMonth",
        dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: useCol, function: "Sum" } },
            grouping: [{ type: "TagKey", name: tagKey }],
        },
    } as any);

    const totals = new Map<string, number>();
    await Promise.all(subs.map(async subId => {
        try {
            let res: any;
            try {
                res = await client.query.usage(`/subscriptions/${subId}`, buildOptions(col));
            } catch (e: any) {
                if (col === "CostUSD" && isCostUsdUnsupportedError(e)) {
                    await degradeCostColumn(tenantId);
                    res = await client.query.usage(`/subscriptions/${subId}`, buildOptions("PreTaxCost"));
                } else {
                    throw e;
                }
            }
            const cols: any[] = res?.columns || [];
            const costIdx = cols.findIndex(c => /cost/i.test(c.name));
            const tagIdx = cols.findIndex(c => /tag/i.test(c.name));
            for (const row of (res?.rows || [])) {
                const raw = String(row[tagIdx] || "");
                // Azure devuelve "key:value" o "key:" para recursos sin esa tag.
                const value = raw.includes(":") ? raw.split(":").slice(1).join(":").trim() : raw;
                if (!value) continue;
                const cost = Number(row[costIdx]) || 0;
                totals.set(value, (totals.get(value) || 0) + cost);
            }
        } catch (e: any) {
            console.warn(`[resourceInventory] costo por tag '${tagKey}' falló para sub ${subId}:`, e?.message);
        }
    }));

    return Array.from(totals.entries()).map(([value, cost]) => ({ value, cost: Number(cost.toFixed(2)) })).sort((a, b) => b.cost - a.cost);
}
