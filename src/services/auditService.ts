import { SubscriptionClient } from "@azure/arm-subscriptions";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../modules/core/kqlCatalog";

async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 2, subscriptions: string[] = [], delayMs = 1500) {
    const getQuery = (query: string) => ({
        subscriptions,
        query
    });

    const results: any = {};
    // Si TODAS las queries fallan por permisos (AuthorizationFailed/403), el
    // audit NO debe devolver "todo en 0" silencioso: se propaga AccessDenied
    // para que /api/audit/full responda MISSING_RBAC_ROLE y el dashboard
    // muestre el banner de onboarding en vez de tarjetas en cero.
    let authFailures = 0;
    const isAuthError = (e: any) => {
        const msg = String(e?.message || e || "");
        return e?.statusCode === 403 || e?.status === 403 ||
            e?.code === "AuthorizationFailed" || e?.code === "AccessDenied" ||
            /authorizationfailed|accessdenied|forbidden/i.test(msg);
    };
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
                        currentDelay *= 2;
                        retries--;
                    } else {
                        if (isAuthError(e)) authFailures++;
                        console.warn(`Query ${q.key} failed after retries:`, e.message || e);
                        return { key: q.key, data: [] };
                    }
                }
            }
            return { key: q.key, data: [] };
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(r => results[r.key] = r.data);

        if (authFailures >= queries.length) {
            throw Object.assign(
                new Error("AuthorizationFailed: el Service Principal no tiene rol Reader en las suscripciones."),
                { code: "AccessDenied" }
            );
        }

        if (i + batchSize < queries.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return results;
}

const auditCache: Record<string, { timestamp: number, data: any }> = {};
const CACHE_TTL_MS = 60 * 1000; // 60 seconds cache

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

    const cacheKey = [...subs].sort().join(",");
    const now = Date.now();
    if (auditCache[cacheKey] && (now - auditCache[cacheKey].timestamp < CACHE_TTL_MS)) {
        console.log(`[AuditCache] Returning cached results for subscriptions: ${cacheKey}`);
        return auditCache[cacheKey].data;
    }

    const queryList = Object.keys(kqlCatalog).map(key => ({
        key,
        query: kqlCatalog[key]
    }));

    // batchSize bajo + delay alto: Resource Graph throttlea agresivamente
    // (429) cuando se disparan muchas queries concurrentes junto con las
    // demas llamadas del dashboard (forecast, billing, ttl, power). Con
    // batchSize=16 casi todas las queries agotaban sus reintentos y el
    // audit volvia practicamente vacio (zombieCount=0 en el dashboard).
    const results = await runInBatches(client, queryList, 5, subs, 2500);
    
    auditCache[cacheKey] = {
        timestamp: now,
        data: results
    };
    
    return results;
}


export async function runMonitorAudits() {
    return [];
}

export async function runM365Audits() {
    return [];
}
