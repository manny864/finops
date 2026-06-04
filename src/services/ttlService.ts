import { getAzureCredential } from "../lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../lib/kqlCatalog";

export async function findExpiredResources(tenantId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    const query = kqlCatalog.expiredTtlResources;
    if (!query) throw new Error("Query no encontrada en KQL Catalog");

    const res = await client.resources({ query });
    const resources = res.data as any[];

    if (!resources || resources.length === 0) return [];

    const now = new Date();
    const expired: any[] = [];

    for (const r of resources) {
        if (!r.expirationDate) continue;
        
        const expDate = new Date(r.expirationDate);
        
        if (!isNaN(expDate.getTime()) && expDate < now) {
            expired.push(r);
        }
    }

    return expired;
}
