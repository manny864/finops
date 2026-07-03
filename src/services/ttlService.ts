import { getAzureCredential, getSubscriptionsForTenant } from "../lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../modules/core/kqlCatalog";

export async function findExpiredResources(tenantId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    const query = kqlCatalog.expiredTtlResources;
    if (!query) throw new Error("Query no encontrada en KQL Catalog");

    const subscriptions = await getSubscriptionsForTenant(tenantId, credential);
    if (subscriptions.length === 0) {
        throw Object.assign(new Error("No hay suscripciones disponibles o no se tienen permisos"), { code: "AccessDenied" });
    }

    let resources: any[] = [];
    let retries = 3;
    let currentDelay = 3000;
    for (;;) {
        try {
            const res = await client.resources({ query, subscriptions });
            resources = res.data as any[] || [];
            break;
        } catch (e: any) {
            const isRateLimit = e.statusCode === 429 || (e.code && e.code === 'RateLimiting');
            if (isRateLimit && retries > 1) {
                console.warn(`[TTL] Rate Limited (429). Reintentando en ${currentDelay}ms... (Intentos restantes: ${retries - 1})`);
                await new Promise(resolve => setTimeout(resolve, currentDelay));
                currentDelay *= 1.5;
                retries--;
            } else if (isRateLimit) {
                // Se agotaron los reintentos por throttling: degradar a lista
                // vacía en lugar de propagar un 500 al dashboard.
                console.warn(`[TTL] Rate Limited (429) tras reintentos agotados. Devolviendo lista vacía.`);
                return [];
            } else {
                throw e;
            }
        }
    }

    if (!resources || resources.length === 0) return [];

    const now = new Date();
    const processedResources: any[] = [];

    for (const r of resources) {
        if (!r.expirationDate) continue;
        
        const expDate = new Date(r.expirationDate);
        
        if (!isNaN(expDate.getTime())) {
            const diffTime = now.getTime() - expDate.getTime();
            const diffDays = diffTime / (1000 * 3600 * 24);
            
            let status = 'Active';
            if (expDate <= now) {
                if (diffDays <= 3) {
                    status = 'Warning';
                } else {
                    status = 'Critical';
                }
            }
            
            processedResources.push({
                ...r,
                ttlStatus: status
            });
        }
    }

    return processedResources;
}
