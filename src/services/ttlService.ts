import { getAzureCredential, getSubscriptionsForTenant } from "../lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../modules/core/kqlCatalog";
import { withArgLimit } from "../lib/argConcurrency";

// Tipos de recurso soportados para políticas TTL — recorte de "entornos
// efímeros" típicos (sandboxes/ambientes de prueba), no la lista completa de
// tipos eliminables de remediationService.ts. Whitelist también usada para
// evitar interpolar resource_type sin validar en el KQL de getUnlabeledResources.
export const TTL_RESOURCE_TYPES = [
    'microsoft.compute/virtualmachines',
    'microsoft.containerservice/managedclusters',
    'microsoft.dbforpostgresql/flexibleservers',
    'microsoft.dbformysql/flexibleservers',
    'microsoft.cache/redis',
    'microsoft.storage/storageaccounts',
    'microsoft.network/virtualnetworks',
    'microsoft.resources/subscriptions/resourcegroups',
    'microsoft.web/serverfarms',
] as const;

export type TtlResourceType = typeof TTL_RESOURCE_TYPES[number];

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
            const res = await withArgLimit(() => client.resources({ query, subscriptions }));
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

            // Días restantes hasta la expiración (negativo = ya venció). Usado
            // por el cron de alertas ttl_expiry para avisar ANTES del borrado,
            // no solo cuando ya pasó la fecha.
            const daysUntilExpiry = Math.round((expDate.getTime() - now.getTime()) / (1000 * 3600 * 24));

            processedResources.push({
                ...r,
                ttlStatus: status,
                daysUntilExpiry
            });
        }
    }

    return processedResources;
}

/**
 * Recursos de `resourceType` sin tag ExpireOn/TTL — candidatos a etiquetar
 * desde la UI de política TTL (paso 2 del manual: "etiquetás los recursos
 * afectados"). `resourceType` se interpola en el KQL, por eso se valida
 * contra TTL_RESOURCE_TYPES antes de llamar a esta función (ver
 * /api/cleanup/ttl/unlabeled).
 */
export async function getUnlabeledResources(tenantId: string, resourceType: TtlResourceType) {
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    const query = `Resources | where type =~ '${resourceType}' | where isempty(tags['ExpireOn']) and isempty(tags['TTL']) | project id, name, type, resourceGroup, subscriptionId, tags`;

    const subscriptions = await getSubscriptionsForTenant(tenantId, credential);
    if (subscriptions.length === 0) return [];

    let retries = 3;
    let currentDelay = 3000;
    for (;;) {
        try {
            const res = await withArgLimit(() => client.resources({ query, subscriptions }));
            return (res.data as any[]) || [];
        } catch (e: any) {
            const isRateLimit = e.statusCode === 429 || (e.code && e.code === 'RateLimiting');
            if (isRateLimit && retries > 1) {
                await new Promise(resolve => setTimeout(resolve, currentDelay));
                currentDelay *= 1.5;
                retries--;
            } else if (isRateLimit) {
                return [];
            } else {
                throw e;
            }
        }
    }
}
