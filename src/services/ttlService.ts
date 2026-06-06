import { getAzureCredential } from "../lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../lib/kqlCatalog";

export async function findExpiredResources(tenantId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    const query = kqlCatalog.expiredTtlResources;
    if (!query) throw new Error("Query no encontrada en KQL Catalog");

    let resources: any[] = [];
    try {
        const res = await client.resources({ query });
        resources = res.data as any[] || [];
    } catch (e: any) {
        if (e.statusCode === 429 || (e.code && e.code === 'RateLimiting')) {
            console.warn(`[TTL] Rate Limited (429). Reintentando en 3s...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            const res = await client.resources({ query });
            resources = res.data as any[] || [];
        } else {
            throw e;
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
