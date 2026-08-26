import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { kqlCatalog } from "../modules/core/kqlCatalog";
import { withArgLimit } from "@/lib/argConcurrency";

async function runInBatches(client: ResourceGraphClient, queries: {key: string, query: string}[], batchSize = 1, subscriptions: string[] = [], delayMs = 400) {
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
            try {
                const res = await withArgLimit(
                    () => client.resources(getQuery(q.query)),
                    { label: `audit(${q.key})`, maxRetries: 4 }
                );
                return { key: q.key, data: res.data };
            } catch (e: any) {
                if (isAuthError(e)) authFailures++;
                console.warn(`Query ${q.key} failed:`, e.message || e);
                return { key: q.key, data: [] };
            }
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

// Fase 0 (docs/vps-infra-improvement-plan.md): Map con tope de tamaño en vez
// de objeto sin limite. En un proceso de larga duracion (VPS sin restarts
// frecuentes) esta cache podria crecer indefinidamente si se auditan muchas
// combinaciones distintas de suscripciones. Se acota con eviccion FIFO simple
// (mismo patron que src/lib/secrets/keyvault.ts).
const auditCache = new Map<string, { timestamp: number, data: any }>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds cache
const MAX_AUDIT_CACHE_ENTRIES = 200;

function evictAuditCacheIfFull(): void {
    while (auditCache.size > MAX_AUDIT_CACHE_ENTRIES) {
        const firstKey = auditCache.keys().next().value;
        if (firstKey === undefined) break;
        auditCache.delete(firstKey);
    }
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

    const cacheKey = [...subs].sort().join(",");
    const now = Date.now();
    const cached = auditCache.get(cacheKey);
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        console.log(`[AuditCache] Returning cached results for subscriptions: ${cacheKey}`);
        return cached.data;
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
    
    auditCache.set(cacheKey, {
        timestamp: now,
        data: results
    });
    evictAuditCacheIfFull();
    
    return results;
}


export async function runMonitorAudits() {
    return [];
}

export async function runM365Audits() {
    return [];
}
