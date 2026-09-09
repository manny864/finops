import { errorMessage } from '@/lib/apiErrors';
import { listTenantSubscriptions } from '@/lib/azure';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { withArgLimit } from '@/lib/argConcurrency';

// CostSnapshots sólo guarda subscription_id (GUID) — para mostrar el nombre
// real en la UI se resuelve vía Azure Management y Azure Resource Graph,
// cacheado en un Map por el llamador.
export async function getSubscriptionNameMap(tenantId: string, credential: any): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!credential) return map;

    // 1. Intento vía Azure Management REST API. Va por listTenantSubscriptions
    // para no traer nombres de suscripciones de otros directorios: este mapa
    // alimenta los filtros de la UI y mezclarlos cruza clientes.
    try {
        for (const sub of await listTenantSubscriptions(tenantId, credential)) {
            const name = sub.displayName || sub.subscriptionId;
            map.set(sub.subscriptionId, name);
            map.set(sub.subscriptionId.toLowerCase(), name);
        }
    } catch (e) {
        console.warn("[azureSubscriptionNames] getSubscriptionNameMap REST warning:", errorMessage(e));
    }

    // 2. Complemento / Fallback directo desde Azure Resource Graph
    try {
        const client = new ResourceGraphClient(credential);
        const argRes = await withArgLimit(() =>
            client.resources({
                query: "ResourceContainers | where type =~ 'microsoft.resources/subscriptions' | project subscriptionId, name"
            })
        );
        if (argRes.data && Array.isArray(argRes.data)) {
            for (const row of argRes.data) {
                if (row.subscriptionId && row.name) {
                    map.set(row.subscriptionId, row.name);
                    map.set(row.subscriptionId.toLowerCase(), row.name);
                }
            }
        }
    } catch {
        // Silencioso: si ARG falla, se preserva el mapa obtenido en el paso 1
    }

    return map;
}

export function resolveSubscriptionName(id: string | null | undefined, subMap: Map<string, string>): string {
    if (!id) return "";
    const cleanId = id.trim();
    if (subMap.has(cleanId)) return subMap.get(cleanId)!;
    if (subMap.has(cleanId.toLowerCase())) return subMap.get(cleanId.toLowerCase())!;
    if (cleanId.toLowerCase() === "ec03e8ce-ceee-4638-b303-64ae431d5b1e") {
        return "CSCS-LandingZone";
    }
    if (cleanId === "demo-sub-01") return "CSCS-LandingZone-Production";
    if (cleanId === "demo-sub-02") return "CSCS-DataPlatform-Analytics";
    return cleanId;
}

export function isUnattributedSubscriptionId(id: string | null | undefined): boolean {
    if (!id) return true;
    const lower = id.toLowerCase().trim();
    return lower === 'mg-aggregated' || lower === 'default' || lower === 'unknown' || lower === 'all' || lower === '';
}

