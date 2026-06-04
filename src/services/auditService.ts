import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../lib/kqlCatalog";

const getQuery = (query: string) => ({
    subscriptions: [],
    query
});

async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 5) {
    const results: any = {};
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchPromises = batch.map(async (q) => {
            try {
                const res = await client.resources(getQuery(q.query));
                return { key: q.key, data: res.data };
            } catch (e) {
                console.warn(`Query ${q.key} failed:`, e);
                return { key: q.key, data: [] };
            }
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => results[r.key] = r.data);
        
        if (i + batchSize < queries.length) {
            await new Promise(resolve => setTimeout(resolve, 800)); // 800ms delay to prevent 429
        }
    }
    return results;
}

export async function runGraphAudits(client: ResourceGraphClient, subscriptionId?: string) {
    const queryList = Object.keys(kqlCatalog).map(key => ({
        key,
        query: subscriptionId ? `${kqlCatalog[key]} | where subscriptionId =~ '${subscriptionId}'` : kqlCatalog[key]
    }));

    const results = await runInBatches(client, queryList, 5);
    return results;
}

export async function runMonitorAudits() {
    return [];
}

export async function runM365Audits() {
    return [];
}
