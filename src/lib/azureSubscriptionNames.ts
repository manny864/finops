// CostSnapshots sólo guarda subscription_id (GUID) — para mostrar el nombre
// real en la UI se resuelve vía Azure Management (mismo endpoint que
// /api/subscriptions), cacheado en un Map por el llamador.
export async function getSubscriptionNameMap(tenantId: string, credential: any): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const tokenData = await credential.getToken("https://management.azure.com/.default");
        const res = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { Authorization: `Bearer ${tokenData.token}` },
        });
        if (res.ok) {
            const data = await res.json();
            for (const sub of data.value || []) {
                if (sub.subscriptionId) map.set(sub.subscriptionId, sub.displayName || sub.subscriptionId);
            }
        }
    } catch (e: any) {
        console.warn("[azureSubscriptionNames] getSubscriptionNameMap:", e.message);
    }
    return map;
}

export function resolveSubscriptionName(id: string | null | undefined, subMap: Map<string, string>): string {
    if (!id) return id || "";
    return subMap.get(id) || id;
}

/**
 * CostSnapshots.subscription_id no siempre es un GUID real: cuando el sync
 * diario tiene acceso Cost Management Reader a nivel Management Group,
 * getYesterdaysDetailedCosts (billingService.ts) toma un atajo de 1 sola
 * query agregada y graba subscription_id='mg-aggregated' para TODAS las
 * suscripciones ese día (evita N llamadas a la API de Azure). 'default' es
 * el mismo tipo de placeholder para filas legacy sin subscription_id. Un
 * GROUP BY subscription_id sin excluir estos valores infla un "tenant
 * ficticio" y subestima brutalmente el costo real de las suscripciones
 * verdaderas en los días donde se tomó el atajo — hay que separarlos y
 * mostrarlos como costo "no atribuido a una suscripción", no fabricarlos
 * como si fueran una suscripción real ni descartarlos silenciosamente.
 */
export const UNATTRIBUTED_SUBSCRIPTION_IDS = new Set(["mg-aggregated", "default"]);

export function isUnattributedSubscriptionId(id: string | null | undefined): boolean {
    return !id || UNATTRIBUTED_SUBSCRIPTION_IDS.has(id);
}
