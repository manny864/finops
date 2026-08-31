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

/**
 * Resource Groups que contienen al menos un recurso con la etiqueta `key = value`.
 *
 * Por qué existe: un Cost Group definido por etiqueta daba SIEMPRE $0.00. El
 * predicado SQL comparaba `CostSnapshots.Tags`, pero esa columna no la escribe
 * nadie — ni `insertCostSnapshotRow` ni el ingestor de exports la incluyen en su
 * INSERT, y la consulta del sync diario agrupa por
 * ['ServiceName','ResourceGroupName'], sin pedir tags. Con la columna en NULL en
 * el 100% de las filas, ninguna etiqueta podía coincidir.
 *
 * Las etiquetas sí están disponibles en vivo en Resource Graph, y el costo sí
 * está agregado por `resource_group`, así que la etiqueta se traduce al conjunto
 * de RGs que la portan.
 *
 * ATENCIÓN — granularidad: el costo de CostSnapshots está agregado por RG, no
 * por recurso. Si en un RG hay recursos con la etiqueta y otros sin ella, se
 * atribuye el RG COMPLETO. El caller debe informar esa aproximación en vez de
 * presentarla como exacta (ver `tagMatchIsApproximate` en /api/cost-groups).
 * La solución exacta requiere tags en el pipeline de costos (MEJ-30).
 *
 * Best-effort como el resto del archivo: si Resource Graph falla devuelve
 * vacío, y el Cost Group queda en 0 igual que antes, sin cortar la respuesta.
 */
export async function fetchResourceGroupsByTag(
    tenantId: string,
    tagKey: string,
    tagValue: string
): Promise<string[]> {
    if (!tagKey || !tagValue) return [];
    try {
        const subscriptions = await getSubscriptionsForTenant(tenantId);
        if (subscriptions.length === 0) return [];
        const argClient = await getResourceGraphClient(tenantId);
        // Los nombres de tag en Azure son case-insensitive: `=~` evita que
        // "CostCenter" no matchee un recurso etiquetado "costcenter".
        // El valor va como parámetro literal escapando comillas simples, que es
        // lo único que puede romper la KQL.
        const safeKey = tagKey.replace(/'/g, "''");
        const safeValue = tagValue.replace(/'/g, "''");
        const response: any = await argClient.resources({
            subscriptions,
            query: `Resources
                | where tostring(tags['${safeKey}']) =~ '${safeValue}'
                | distinct resourceGroup`,
            options: { resultFormat: "objectArray", top: 1000 },
        });
        const rows: any[] = Array.isArray(response?.data) ? response.data : [];
        return Array.from(
            new Set(
                rows
                    .map((r) => String(r.resourceGroup || "").toLowerCase())
                    .filter(Boolean)
            )
        );
    } catch (e) {
        console.error(`[azureResourceCounts] Error resolviendo RGs por tag para ${tenantId}:`, e);
        return [];
    }
}
