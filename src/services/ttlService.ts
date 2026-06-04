import { getAzureCredential } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "@/lib/kqlCatalog";

export async function findExpiredResources(tenantId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);
    
    const query = kqlCatalog.expiredTtlResources;
    const res = await client.resources({ query });
    const data = res.data as any[];
    
    const now = new Date();
    const expired: any[] = [];
    
    for (const item of data) {
        if (!item.expirationDate) continue;
        
        // Parse ISO 8601
        const expDate = new Date(item.expirationDate);
        if (isNaN(expDate.getTime())) {
            // Formato inválido
            continue;
        }
        
        if (expDate < now) {
            expired.push({
                ...item,
                daysExpired: Math.floor((now.getTime() - expDate.getTime()) / (1000 * 3600 * 24))
            });
        }
    }
    
    return expired;
}
