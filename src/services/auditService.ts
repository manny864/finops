import { SubscriptionClient } from "@azure/arm-subscriptions";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../modules/core/kqlCatalog";

async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 2, subscriptions: string[] = [], delayMs = 1500) {
    const getQuery = (query: string) => ({
        subscriptions,
        query
    });

    const results: any = {};
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchPromises = batch.map(async (q) => {
            let retries = 3;
            let currentDelay = 3000;
            while (retries > 0) {
                try {
                    const res = await client.resources(getQuery(q.query));
                    return { key: q.key, data: res.data };
                } catch (e: any) {
                    const isRateLimit = e.statusCode === 429 || (e.code && e.code === 'RateLimiting');
                    if (isRateLimit && retries > 1) {
                        console.warn(`[Audit] Rate Limited (429) en ${q.key}. Reintentando en ${currentDelay}ms... (Intentos restantes: ${retries - 1})`);
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        currentDelay *= 1.5;
                        retries--;
                    } else {
                        console.warn(`Query ${q.key} failed after retries:`, e.message || e);
                        return { key: q.key, data: [] };
                    }
                }
            }
            return { key: q.key, data: [] };
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => results[r.key] = r.data);
        
        if (i + batchSize < queries.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
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

    const results = await runInBatches(client, queryList, 12, subs, 4500);
    return results;
}

export async function runMonitorAudits() {
    return [];
}

export async function runM365Audits() {
    return [];
}
