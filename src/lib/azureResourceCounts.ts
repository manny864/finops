/**
 * Utilidades compartidas para reconciliar conteos/listados de recursos reales
 * (Azure Resource Graph) contra agrupaciones de costo derivadas de
 * CostSnapshots (Cost Groups, Cost Centers) — CostSnapshots no trae
 * `ResourceId` poblado de forma consistente (el sync agrega por resource
 * group), así que `COUNT(DISTINCT ResourceId)` da 0 en la mayoría de
 * tenants. Ambos helpers son best-effort: si Resource Graph falla, devuelven
 * un resultado vacío sin cortar al caller.
 */
import { getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";

/** Cuenta recursos reales (`Resources | summarize count() by resourceGroup`) para las RG dadas. */
export async function fetchResourceCountsByRg(tenantId: string, rgNames: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (rgNames.length === 0) return counts;
    try {
        const subscriptions = await getSubscriptionsForTenant(tenantId);
        if (subscriptions.length === 0) return counts;
        const argClient = await getResourceGraphClient(tenantId);
        const response: any = await argClient.resources({
            subscriptions,
            query: `Resources | summarize resourceCount = count() by resourceGroup`,
            options: { resultFormat: "objectArray", top: 1000 },
        });
        const rows: any[] = Array.isArray(response?.data) ? response.data : [];
        for (const row of rows) {
            const rg = String(row.resourceGroup || "").toLowerCase();
            if (!rg) continue;
            counts.set(rg, (counts.get(rg) || 0) + (Number(row.resourceCount) || 0));
        }
    } catch (e) {
        console.error(`[azureResourceCounts] Error contando recursos para ${tenantId}:`, e);
    }
    return counts;
}

export interface ResourceListItem {
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
}

/** Lista recursos individuales (id/name/type) dentro de las RG dadas, para poblar drawers de detalle. */
export async function fetchResourcesInResourceGroups(
    tenantId: string,
    rgNames: string[],
    limit = 500
): Promise<ResourceListItem[]> {
    if (rgNames.length === 0) return [];
    try {
        const subscriptions = await getSubscriptionsForTenant(tenantId);
        if (subscriptions.length === 0) return [];
        const argClient = await getResourceGraphClient(tenantId);
        const rgList = rgNames.map((rg) => `'${rg.replace(/'/g, "")}'`).join(", ");
        const response: any = await argClient.resources({
            subscriptions,
            query: `Resources | where resourceGroup in (${rgList}) | project id, name, type, resourceGroup`,
            options: { resultFormat: "objectArray", top: limit },
        });
        const rows: any[] = Array.isArray(response?.data) ? response.data : [];
        return rows.map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            type: String(r.type || ""),
            resourceGroup: String(r.resourceGroup || ""),
        })).filter((r) => r.id);
    } catch (e) {
        console.error(`[azureResourceCounts] Error listando recursos para ${tenantId}:`, e);
        return [];
    }
}
