import { SubscriptionClient } from "@azure/arm-subscriptions";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../lib/kqlCatalog";

async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 5, subscriptions: string[] = []) {
    const getQuery = (query: string) => ({
        subscriptions,
        query
    });

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

export async function runGraphAudits(client: ResourceGraphClient, credential: any, subscriptionId?: string) {
    let subs: string[] = [];
    if (subscriptionId) {
        subs = [subscriptionId];
    } else {
        try {
            const tokenResponse = await credential.getToken("https://management.azure.com/.default");
            const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                headers: { "Authorization": `Bearer ${tokenResponse.token}` }
            });
            if (fetchRes.ok) {
                const data = await fetchRes.json();
                for (const sub of data.value) {
                    if (sub.subscriptionId) subs.push(sub.subscriptionId);
                }
            } else {
                console.error("Fetch API returned:", fetchRes.status, await fetchRes.text());
                throw new Error("Failed to fetch subscriptions");
            }
        } catch (e) {
            console.error("Failed to query subscriptions via REST", e);
        }
    }

    if (subs.length === 0) {
        throw Object.assign(new Error("No hay suscripciones disponibles o no se tienen permisos"), { code: "AccessDenied" });
    }

    const queryList = Object.keys(kqlCatalog).map(key => ({
        key,
        query: kqlCatalog[key]
    }));

    const results = await runInBatches(client, queryList, 5, subs);
    return results;
}

export async function runMonitorAudits() {
    return [];
}

export async function runM365Audits() {
    return [];
}
