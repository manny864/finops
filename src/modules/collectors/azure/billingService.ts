import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from '@/lib/azure';
import { FocusCostEntry, mapAzureToFocus } from '@/modules/core/focusMapper';

// --- Helpers de resiliencia para Azure Cost Management (rate limiting) ---
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function extractRetryAfterMs(err: any): number | null {
    const headers = err?.response?.headers || err?.headers || {};
    const raw = headers?.get?.('retry-after')
        ?? headers?.get?.('x-ms-ratelimit-microsoft-consumption-retry-after')
        ?? headers?.['retry-after']
        ?? headers?.['x-ms-ratelimit-microsoft-consumption-retry-after'];
    if (!raw) return null;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function is429(err: any): boolean {
    const code = err?.code ?? err?.error?.code;
    const status = err?.statusCode ?? err?.status ?? err?.response?.status;
    const message = err?.message || err?.body?.message || '';
    return status === 429
        || code === 'TooManyRequests'
        || code === '429'
        || /too many requests|throttl|rate.?limit|please retry|429/i.test(String(message));
}

// Caché in-memory de respaldo (TTL corto: 60s) para deduplicar bursts del MISMO
// proceso. La capa principal de cache vive en Redis (ver src/lib/cache.ts) y se
// aplica en los route handlers vía getWithStaleWhileRevalidate.
type CacheEntry = { data: FocusCostEntry[]; diagnostics: CostQueryDiagnostics; expiresAt: number };
const COST_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60s — solo deduplica bursts inmediatos
function getFromCache(key: string): CacheEntry | null {
    const e = COST_CACHE.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { COST_CACHE.delete(key); return null; }
    return e;
}
function setCache(key: string, data: FocusCostEntry[], diagnostics: CostQueryDiagnostics) {
    COST_CACHE.set(key, { data, diagnostics, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function withRetry<T>(fn: () => Promise<T>, opts: { maxRetries?: number; baseDelayMs?: number; label?: string } = {}): Promise<T> {
    const maxRetries = opts.maxRetries ?? 4;
    const baseDelay = opts.baseDelayMs ?? 1500;
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (e: any) {
            if (!is429(e) || attempt >= maxRetries) throw e;
            const retryAfter = extractRetryAfterMs(e);
            const backoff = retryAfter ?? Math.min(30_000, baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 500));
            console.warn(`[BillingService] 429 on ${opts.label || 'azure call'}. Retry ${attempt + 1}/${maxRetries} in ${backoff}ms`);
            await sleep(backoff);
            attempt++;
        }
    }
}

// Procesa una lista de tareas con concurrencia limitada (evita ráfagas que disparan 429).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const idx = i++;
            if (idx >= items.length) return;
            results[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
}

export type CostQueryDiagnostics = {
    scopeAttempted: string;
    isFallback: boolean;
    subsDiscovered: number;
    subsSucceeded: number;
    subsWithData: number;
    perSubErrors: Array<{ subscriptionId: string; code: string; message: string }>;
    totalRows: number;
    subsList: string[];
    timeframeUsed: 'MonthToDate' | 'Last30Days';
    last30RowsIfMtdEmpty?: number;
};

export async function getCurrentMonthAmortizedCostsWithDiagnostics(
    tenantId: string,
    subscriptionId: string,
    metricType: 'ActualCost' | 'AmortizedCost' = 'ActualCost'
): Promise<{ data: FocusCostEntry[]; diagnostics: CostQueryDiagnostics }> {
    const cacheKey = `${tenantId}::${subscriptionId}::${metricType}`;
    const cached = getFromCache(cacheKey);
    if (cached) {
        console.log(`[BillingService] cache HIT for ${cacheKey} (rows=${cached.data.length})`);
        return { data: cached.data, diagnostics: cached.diagnostics };
    }

    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' || subscriptionId.toLowerCase() === 'all'
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}`
        : `/subscriptions/${subscriptionId}`;

    const diagnostics: CostQueryDiagnostics = {
        scopeAttempted: scope,
        isFallback: false,
        subsDiscovered: 0,
        subsSucceeded: 0,
        subsWithData: 0,
        perSubErrors: [],
        totalRows: 0,
        subsList: [],
        timeframeUsed: 'MonthToDate',
    };

    const focusData: FocusCostEntry[] = [];
    const processResult = (res: any): number => {
        if (!res || !res.rows || !res.columns) return 0;
        let n = 0;
        for (const row of res.rows) {
            focusData.push(mapAzureToFocus(row, res.columns));
            n++;
        }
        return n;
    };

    // Construye queryOptions con timeframe específico. Reutilizable para reintento Last30Days.
    const buildOptions = (timeframe: 'MonthToDate' | 'Custom', from?: Date, to?: Date) => {
        const base: any = {
            type: metricType === 'ActualCost' ? 'ActualCost' : 'AmortizedCost',
            timeframe,
            dataset: {
                granularity: "Daily",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                },
                grouping: [
                    { type: "Dimension", name: "ServiceName" },
                    { type: "Dimension", name: "SubscriptionId" },
                    { type: "Dimension", name: "ChargeType" },
                    { type: "Dimension", name: "PublisherType" }
                ]
            }
        };
        if (timeframe === 'Custom' && from && to) {
            base.timePeriod = { from, to };
        }
        return base;
    };

    const mtdOptions = buildOptions('MonthToDate');

    try {
        const result = await withRetry(() => client.query.usage(scope, mtdOptions), { label: `usage(MG ${tenantId})` });
        const n = processResult(result);
        diagnostics.totalRows = n;
        setCache(cacheKey, focusData, diagnostics);
        return { data: focusData, diagnostics };
    } catch (e: any) {
        const isAuthOrNotFound =
            e.statusCode === 403 || e.statusCode === 401 ||
            e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' ||
            e.message?.includes('AuthorizationFailed') ||
            e.code === 'ManagementGroupNotFound' ||
            e.message?.includes("was not found or you don't have access") ||
            e.message?.includes('does not have authorization') ||
            e.message?.includes('does not have any valid subscriptions') ||
            e.statusCode === 400;

        if (!(subscriptionId === 'All' || subscriptionId.toLowerCase() === 'all') || !isAuthOrNotFound) {
            throw e;
        }

        diagnostics.isFallback = true;
        console.log(`[BillingService] Management Group scope failed (${e.message}), iterating subscriptions...`);

        const token = await credential.getToken("https://management.azure.com/.default");
        const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { 'Authorization': `Bearer ${token?.token}` }
        });
        const subJson = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');
        diagnostics.subsDiscovered = subs.length;
        diagnostics.subsList = subs.map((s: any) => s.subscriptionId);

        // Limitar a 3 concurrentes para no disparar 429 en Cost Management API.
        await mapWithConcurrency(subs, 3, async (sub: any) => {
            const subId: string = sub.subscriptionId;
            try {
                const res = await withRetry(
                    () => client.query.usage(`/subscriptions/${subId}`, mtdOptions),
                    { label: `usage(sub ${subId})` }
                );
                diagnostics.subsSucceeded++;
                const n = processResult(res);
                if (n > 0) diagnostics.subsWithData++;
            } catch (subErr: any) {
                const code = subErr.code || subErr.statusCode || 'UNKNOWN';
                const message = (subErr.message || String(subErr)).slice(0, 240);
                diagnostics.perSubErrors.push({ subscriptionId: subId, code: String(code), message });
                console.warn(`[BillingService] Cost query failed for sub ${subId} (code=${code}): ${message}`);
            }
        });

        diagnostics.totalRows = focusData.length;

        // Si MTD vino vacío pero hubo subs OK, probamos Last30Days para distinguir
        // "sin consumo NUNCA" vs "sin consumo solo este mes".
        if (focusData.length === 0 && diagnostics.subsSucceeded > 0) {
            const to = new Date();
            const from = new Date();
            from.setDate(from.getDate() - 30);
            const last30Options = buildOptions('Custom', from, to);

            let probeCount = 0;
            await mapWithConcurrency(diagnostics.subsList, 3, async (subId) => {
                try {
                    const res = await withRetry(
                        () => client.query.usage(`/subscriptions/${subId}`, last30Options),
                        { label: `probe30d(sub ${subId})`, maxRetries: 2 }
                    );
                    if (res?.rows) probeCount += res.rows.length;
                } catch {
                    // best-effort
                }
            });
            diagnostics.last30RowsIfMtdEmpty = probeCount;
            console.log(`[BillingService] MTD vacío. Probe Last30Days = ${probeCount} filas.`);
        }

        setCache(cacheKey, focusData, diagnostics);
        return { data: focusData, diagnostics };
    }
}

export async function getCurrentMonthAmortizedCosts(
    tenantId: string,
    subscriptionId: string,
    metricType: 'ActualCost' | 'AmortizedCost' = 'ActualCost'
): Promise<FocusCostEntry[]> {
    const { data } = await getCurrentMonthAmortizedCostsWithDiagnostics(tenantId, subscriptionId, metricType);
    return data;
}

export async function getCostForecast(
    tenantId: string, 
    subscriptionId: string,
    metricType: 'ActualCost' | 'AmortizedCost' = 'ActualCost'
) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' 
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
        : `/subscriptions/${subscriptionId}`;
    
    const today = new Date();
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const forecastOptions = {
        type: metricType === 'ActualCost' ? 'ActualCost' : 'AmortizedCost',
        timeframe: "Custom",
        timePeriod: {
            from: today,
            to: endOfMonth
        },
        dataset: {
            granularity: "Daily",
            aggregation: {
                totalCost: {
                    name: "PreTaxCost",
                    function: "Sum"
                }
            }
        }
    } as any;

    let result;
    let fallbackResults: any[] = [];
    let isFallback = false;

    try {
        result = await withRetry(() => client.forecast.usage(scope, forecastOptions), { label: `forecast(${scope})` });
    } catch (e: any) {
        const isAuthOrNotFound = e.statusCode === 403 || e.statusCode === 401 || e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' || e.message?.includes('AuthorizationFailed') || e.code === 'ManagementGroupNotFound' || e.message?.includes("was not found or you don't have access") || e.message?.includes('does not have authorization') || e.message?.includes('does not have any valid subscriptions') || e.statusCode === 400;
        if (subscriptionId === 'All' && isAuthOrNotFound) {
            isFallback = true;
            console.log("Management Group scope failed for forecast, falling back to concurrent subscription iteration...");
            const token = await credential.getToken("https://management.azure.com/.default");
            const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                headers: { 'Authorization': `Bearer ${token?.token}` }
            });
            const subJson = await subRes.json();
            const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');

            fallbackResults = (await mapWithConcurrency(subs, 3, async (sub: any) => {
                try {
                    return await withRetry(
                        () => client.forecast.usage(`/subscriptions/${sub.subscriptionId}`, forecastOptions),
                        { label: `forecast(sub ${sub.subscriptionId})`, maxRetries: 3 }
                    );
                } catch {
                    return null;
                }
            })).filter((r: any) => r && r.rows);
        } else {
            throw e;
        }
    }

    const forecastMap: Record<string, number> = {};

    const processForecastRows = (rows: any[]) => {
        rows.forEach(row => {
            const cost = Number(row[0]) || 0;
            const dateStr = String(row[1]);
            if (!forecastMap[dateStr]) forecastMap[dateStr] = 0;
            forecastMap[dateStr] += cost;
        });
    };

    if (isFallback) {
        fallbackResults.forEach(res => {
            if (res.rows) processForecastRows(res.rows);
        });
    } else {
        if (!result || !result.rows) return [];
        processForecastRows(result.rows);
    }

    const forecastData = Object.keys(forecastMap).sort().map(dateStr => {
        const formattedDate = dateStr.length === 8 ? `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}` : dateStr;
        return {
            date: formattedDate,
            forecastCost: Number(forecastMap[dateStr].toFixed(2))
        };
    });

    return forecastData;
}

export async function getYesterdaysCost(tenantId: string): Promise<number> {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    // Calculate yesterday's date range
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = yesterday.getMonth();
    const dd = yesterday.getDate();
    const fromDate = new Date(yyyy, mm, dd, 0, 0, 0);
    const toDate = new Date(yyyy, mm, dd, 23, 59, 59);

    const queryOptions = {
        type: 'ActualCost',
        timeframe: "Custom",
        timePeriod: {
            from: fromDate,
            to: toDate
        },
        dataset: {
            granularity: "None",
            aggregation: {
                totalCost: {
                    name: "PreTaxCost",
                    function: "Sum"
                }
            }
        }
    } as any;

    try {
        const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        const result = await withRetry(() => client.query.usage(scope, queryOptions), { label: `yesterday(MG ${tenantId})` });
        if (result && result.rows && result.rows.length > 0) {
            return Number(result.rows[0][0]) || 0;
        }
        return 0;
    } catch (e: any) {
        console.warn(`Management Group scope query failed for yesterday's cost of tenant ${tenantId}, falling back to subscriptions:`, e.message);
        
        const token = await credential.getToken("https://management.azure.com/.default");
        if (!token) {
            throw new Error("No se pudo obtener el token de acceso de Azure.");
        }
        
        const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { 'Authorization': `Bearer ${token.token}` }
        });
        if (!subRes.ok) {
            throw new Error(`Failed to fetch subscriptions: HTTP ${subRes.status}`);
        }
        const subJson = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');

        let totalCost = 0;
        await mapWithConcurrency(subs, 3, async (sub: any) => {
            try {
                const subScope = `/subscriptions/${sub.subscriptionId}`;
                const res = await withRetry(
                    () => client.query.usage(subScope, queryOptions),
                    { label: `yesterday(sub ${sub.subscriptionId})`, maxRetries: 3 }
                );
                if (res && res.rows && res.rows.length > 0) {
                    totalCost += Number(res.rows[0][0]) || 0;
                }
            } catch (subErr: any) {
                console.warn(`Failed to query yesterday's cost for subscription ${sub.subscriptionId}:`, subErr.message);
            }
        });
        return totalCost;
    }
}

/**
 * Returns a detailed FOCUS-compatible breakdown of yesterday's costs per
 * (SubscriptionId, ResourceGroupName, ServiceName, MeterSubCategory).
 * Includes UsageQuantity so consumers like storage-efficiency can detect tiers.
 * Requires: Cost Management Reader at MG or each subscription scope.
 */
export type DetailedCostRow = {
    subscriptionId: string;
    resourceGroup: string;
    serviceName: string;
    serviceFamily: string;
    meterCategory: string;
    meterSubCategory: string;
    meterName: string;
    cost: number;
    quantity: number;
    unitOfMeasure: string;
};

export async function getYesterdaysDetailedCosts(tenantId: string): Promise<DetailedCostRow[]> {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = yesterday.getMonth();
    const dd = yesterday.getDate();
    const fromDate = new Date(yyyy, mm, dd, 0, 0, 0);
    const toDate = new Date(yyyy, mm, dd, 23, 59, 59);

    // Cost Management caps grouping dimensions; we run two complementary
    // queries and merge by (sub, rg, service):
    //  A) [ServiceName, ResourceGroupName] -> billing/chargeback shape
    //  B) [ServiceName, MeterSubCategory]  -> storage-tier detection
    const baseDataset = {
        granularity: "None",
        aggregation: {
            totalCost: { name: "PreTaxCost", function: "Sum" },
            totalQty:  { name: "UsageQuantity", function: "Sum" }
        }
    };
    const buildOpts = (groupings: string[]) => ({
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from: fromDate, to: toDate },
        dataset: {
            ...baseDataset,
            grouping: groupings.map(name => ({ type: 'Dimension', name }))
        }
    } as any);

    const queryA = buildOpts(['ServiceName', 'ResourceGroupName']);
    const queryB = buildOpts(['ServiceName', 'MeterSubCategory']);

    async function runOnScope(scope: string, opts: any): Promise<{ rows: any[][]; columns: any[] }> {
        const res: any = await withRetry(() => client.query.usage(scope, opts), { label: `detailed(${scope})`, maxRetries: 3 });
        return { rows: res?.rows || [], columns: res?.columns || [] };
    }

    const colIdx = (cols: any[], name: string) => cols.findIndex((c: any) => c.name === name);

    async function runForScope(scope: string, subId: string): Promise<DetailedCostRow[]> {
        const out: DetailedCostRow[] = [];
        try {
            const a = await runOnScope(scope, queryA);
            const sIdx = colIdx(a.columns, 'ServiceName');
            const rgIdx = colIdx(a.columns, 'ResourceGroupName');
            const cIdx = colIdx(a.columns, 'PreTaxCost');
            const qIdx = colIdx(a.columns, 'UsageQuantity');
            for (const row of a.rows) {
                const cost = Number(row[cIdx] ?? 0);
                if (!Number.isFinite(cost) || cost === 0) continue;
                out.push({
                    subscriptionId: subId,
                    resourceGroup: String(row[rgIdx] ?? '*'),
                    serviceName: String(row[sIdx] ?? ''),
                    serviceFamily: '',
                    meterCategory: '',
                    meterSubCategory: '',
                    meterName: '',
                    cost,
                    quantity: Number(row[qIdx] ?? 0) || 0,
                    unitOfMeasure: ''
                });
            }
        } catch (e: any) {
            console.warn(`[BillingService] detailed A query failed for ${scope}:`, e.message);
        }
        try {
            const b = await runOnScope(scope, queryB);
            const sIdx = colIdx(b.columns, 'ServiceName');
            const mscIdx = colIdx(b.columns, 'MeterSubCategory');
            const cIdx = colIdx(b.columns, 'PreTaxCost');
            const qIdx = colIdx(b.columns, 'UsageQuantity');
            for (const row of b.rows) {
                const cost = Number(row[cIdx] ?? 0);
                if (!Number.isFinite(cost) || cost === 0) continue;
                out.push({
                    subscriptionId: subId,
                    resourceGroup: '*',
                    serviceName: String(row[sIdx] ?? ''),
                    serviceFamily: '',
                    meterCategory: String(row[mscIdx] ?? ''),
                    meterSubCategory: String(row[mscIdx] ?? ''),
                    meterName: String(row[mscIdx] ?? ''),
                    cost,
                    quantity: Number(row[qIdx] ?? 0) || 0,
                    unitOfMeasure: ''
                });
            }
        } catch (e: any) {
            console.warn(`[BillingService] detailed B query failed for ${scope}:`, e.message);
        }
        return out;
    }

    const results: DetailedCostRow[] = [];

    try {
        const mgScope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        const rowsA = await runOnScope(mgScope, queryA);
        if (rowsA.rows.length > 0) {
            results.push(...await runForScope(mgScope, 'mg-aggregated'));
            return results;
        }
        throw new Error('MG scope returned 0 rows, falling back to subs');
    } catch (e: any) {
        // Fallback: iterate subscriptions
        const token = await credential.getToken('https://management.azure.com/.default');
        if (!token) throw new Error('No se pudo obtener token Azure');
        const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
            headers: { 'Authorization': `Bearer ${token.token}` }
        });
        const subJson: any = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');
        await mapWithConcurrency(subs, 3, async (sub: any) => {
            const subId: string = sub.subscriptionId;
            const rows = await runForScope(`/subscriptions/${subId}`, subId);
            results.push(...rows);
        });
        return results;
    }
}
