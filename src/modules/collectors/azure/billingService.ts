import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from '@/lib/azure';
import { FocusCostEntry, mapAzureToFocus } from '@/modules/core/focusMapper';
import { redis } from '@/lib/redis';
import { withCostColumn, findCostColumnIndex, resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, type CostColumn } from '@/lib/azureCostColumn';

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

// In-flight deduplication: prevents multiple concurrent callers for the same
// cache key (e.g. forecast + summary liveData) from all hitting Azure at once.
const COST_INFLIGHT = new Map<string, Promise<{ data: FocusCostEntry[]; diagnostics: CostQueryDiagnostics }>>();
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

// Private implementation — all Azure API logic lives here.
// Called exclusively from getCurrentMonthAmortizedCostsWithDiagnostics, which
// handles cache lookups and in-flight deduplication before reaching here.
async function _fetchCostData(
    tenantId: string,
    subscriptionId: string,
    metricType: 'ActualCost' | 'AmortizedCost',
    cacheKey: string
): Promise<{ data: FocusCostEntry[]; diagnostics: CostQueryDiagnostics }> {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' || subscriptionId.toLowerCase() === 'all'
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}`
        : `/subscriptions/${subscriptionId}`;

    const costCol = await resolveCostColumn(tenantId);

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
    // `col` es 'CostUSD' (default) o 'PreTaxCost' (fallback si la oferta del
    // tenant no soporta CostUSD — ver resolveCostColumnCached/degradeCostColumn).
    const buildOptions = (timeframe: 'MonthToDate' | 'Custom', col: CostColumn, from?: Date, to?: Date) => {
        const base: any = {
            type: metricType === 'ActualCost' ? 'ActualCost' : 'AmortizedCost',
            timeframe,
            dataset: {
                granularity: "Daily",
                aggregation: {
                    totalCost: { name: col, function: "Sum" }
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

    let mtdOptions = buildOptions('MonthToDate', costCol);
    let activeCol = costCol;

    try {
        // maxRetries:0 — on 429 (Azure throttling MG scope) fail immediately and fall back to
        // per-subscription iteration instead of waiting 24s+ of exponential backoff.
        let result: any;
        try {
            result = await withRetry(() => client.query.usage(scope, mtdOptions), { label: `usage(MG ${tenantId})`, maxRetries: 0 });
        } catch (colErr: any) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(colErr)) {
                console.warn(`[BillingService] CostUSD no soportado (MG scope) para tenant ${tenantId} — degradando a PreTaxCost.`);
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                mtdOptions = buildOptions('MonthToDate', activeCol);
                result = await withRetry(() => client.query.usage(scope, mtdOptions), { label: `usage(MG ${tenantId}, PreTaxCost)`, maxRetries: 0 });
            } else {
                throw colErr;
            }
        }
        if (result?.columns?.length) {
            console.log(`[BillingService] Azure columns (MG scope): ${result.columns.map((c: any) => c.name).join(', ')}`);
        }
        const n = processResult(result);
        diagnostics.totalRows = n;
        setCache(cacheKey, focusData, diagnostics);
        return { data: focusData, diagnostics };
    } catch (e: any) {
        const is429err = is429(e);
        const isAuthOrNotFound =
            e.statusCode === 403 || e.statusCode === 401 ||
            e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' ||
            e.message?.includes('AuthorizationFailed') ||
            e.code === 'ManagementGroupNotFound' ||
            e.message?.includes("was not found or you don't have access") ||
            e.message?.includes('does not have authorization') ||
            e.message?.includes('does not have any valid subscriptions') ||
            e.statusCode === 400;

        const isAll = subscriptionId === 'All' || subscriptionId.toLowerCase() === 'all';

        if (isAll && (isAuthOrNotFound || is429err)) {
            // MG scope not accessible or throttled: fall back to per-subscription iteration.
            diagnostics.isFallback = true;
            console.log(`[BillingService] MG scope failed (${is429err ? '429 throttled' : e.code || e.statusCode}), iterating subscriptions...`);
        } else if (!isAll && isAuthOrNotFound) {
            // Specific subscription returned 401/403 — no access, return empty gracefully
            console.warn(`[BillingService] Cost query unauthorized for sub ${subscriptionId} (${e.statusCode}): ${e.message?.slice(0, 120)}`);
            setCache(cacheKey, [], diagnostics);
            return { data: [], diagnostics };
        } else {
            throw e;
        }

        const token = await credential.getToken("https://management.azure.com/.default");
        const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { 'Authorization': `Bearer ${token?.token}` }
        });
        const subJson = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');
        diagnostics.subsDiscovered = subs.length;
        diagnostics.subsList = subs.map((s: any) => s.subscriptionId);

        // Concurrency 2 (not 3) to reduce 429 throttling pressure on Cost Management API.
        await mapWithConcurrency(subs, 2, async (sub: any) => {
            const subId: string = sub.subscriptionId;
            // Skip subscriptions permanently marked as billing-disabled (e.g. sponsorship/EA
            // accounts with SubscriptionCostDisabled). Checked via Redis skip-list (7d TTL).
            try {
                const skip = await redis.get(`billing:skip:${tenantId}:${subId}`);
                if (skip) {
                    console.log(`[BillingService] Sub ${subId} in billing skip-list — skipping`);
                    diagnostics.perSubErrors.push({ subscriptionId: subId, code: 'SKIP_BILLING_DISABLED', message: 'Cached skip — SubscriptionCostDisabled' });
                    return;
                }
            } catch { /* Redis unavailable — proceed normally */ }
            try {
                const res = await withRetry(
                    () => client.query.usage(`/subscriptions/${subId}`, mtdOptions),
                    // maxRetries:2 — fail fast on persistent throttling; 4×retries per sub
                    // while 4 subs run amplifies 429s. Probe will use Last30Days as fallback.
                    { label: `usage(sub ${subId})`, maxRetries: 2 }
                );
                diagnostics.subsSucceeded++;
                const n = processResult(res);
                if (n > 0) diagnostics.subsWithData++;
            } catch (subErr: any) {
                // Suscripciones individuales pueden tener un tipo de oferta distinto
                // al resto del tenant (p.ej. EA legado) y rechazar CostUSD aunque el
                // resto sí lo soporte — reintento puntual con PreTaxCost para esta sub.
                if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(subErr)) {
                    try {
                        const fallbackOptions = buildOptions('MonthToDate', 'PreTaxCost');
                        const res = await withRetry(
                            () => client.query.usage(`/subscriptions/${subId}`, fallbackOptions),
                            { label: `usage(sub ${subId}, PreTaxCost)`, maxRetries: 2 }
                        );
                        diagnostics.subsSucceeded++;
                        const n = processResult(res);
                        if (n > 0) diagnostics.subsWithData++;
                        return;
                    } catch (retryErr: any) {
                        subErr = retryErr;
                    }
                }
                const code = subErr.code || subErr.statusCode || 'UNKNOWN';
                const message = (subErr.message || String(subErr)).slice(0, 240);
                diagnostics.perSubErrors.push({ subscriptionId: subId, code: String(code), message });
                console.warn(`[BillingService] Cost query failed for sub ${subId} (code=${code}): ${message}`);
                // Sponsorship / EA subscriptions with billing disabled will NEVER return cost data.
                // Cache this permanently (7 days) so future calls skip the sub immediately.
                if (String(code) === 'SubscriptionCostDisabled' || message.includes('does not have the privilege to see the cost')) {
                    redis.set(`billing:skip:${tenantId}:${subId}`, '1', 'EX', 604800)
                        .catch(() => { /* ignore */ });
                    console.warn(`[BillingService] Sub ${subId} marked as billing-disabled (skip-list 7d)`);
                }
            }
        });

        diagnostics.totalRows = focusData.length;

        // If MonthToDate came back empty but at least one sub was accessible, fall back
        // to Last30Days — this covers cases where the billing period doesn't align with
        // the calendar month (so "MonthToDate" returns 0 rows but last 30 days has data).
        // We CAPTURE the data (not just count it) so it's available to the caller.
        if (focusData.length === 0 && diagnostics.subsSucceeded > 0) {
            const to = new Date();
            const from = new Date();
            from.setDate(from.getDate() - 30);
            const last30Options = buildOptions('Custom', activeCol, from, to);

            await mapWithConcurrency(diagnostics.subsList, 2, async (subId) => {
                try {
                    const res = await withRetry(
                        () => client.query.usage(`/subscriptions/${subId}`, last30Options),
                        { label: `fallback30d(sub ${subId})`, maxRetries: 2 }
                    );
                    if (res?.rows && res?.columns) {
                        const n = processResult(res);
                        if (n > 0) diagnostics.subsWithData++;
                    }
                } catch {
                    // best-effort
                }
            });

            if (focusData.length > 0) {
                diagnostics.timeframeUsed = 'Last30Days';
                console.log(`[BillingService] MonthToDate empty — using Last30Days fallback (${focusData.length} rows).`);
            } else {
                diagnostics.last30RowsIfMtdEmpty = 0;
                console.log(`[BillingService] Both MonthToDate and Last30Days returned no data.`);
            }
        }

        setCache(cacheKey, focusData, diagnostics);
        return { data: focusData, diagnostics };
    }
}

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

    // In-flight dedup: reuse the running promise if the same query was already launched
    // (e.g., forecast endpoint + summary liveData calling simultaneously), preventing
    // duplicate Azure API requests that amplify 429 throttling.
    const inflight = COST_INFLIGHT.get(cacheKey);
    if (inflight) {
        console.log(`[BillingService] Reusing in-flight query for ${cacheKey}`);
        return inflight;
    }

    const promise = _fetchCostData(tenantId, subscriptionId, metricType, cacheKey)
        .finally(() => COST_INFLIGHT.delete(cacheKey));
    COST_INFLIGHT.set(cacheKey, promise);
    return promise;
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
): Promise<Array<{ date: string; forecastCost: number }>> {
    let credential: Awaited<ReturnType<typeof getAzureCredential>>;
    try {
        credential = await getAzureCredential(tenantId);
    } catch (e: any) {
        console.warn(`[BillingService] getCostForecast: no credentials for tenant ${tenantId}:`, e?.message);
        return [];
    }
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' || subscriptionId.toLowerCase() === 'all'
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}`
        : `/subscriptions/${subscriptionId}`;

    const today = new Date();
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Skip forecast on the last day of the month — Azure rejects timePeriod.from === to (400).
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (todayDate.getTime() >= endOfMonth.getTime()) {
        console.log('[BillingService] getCostForecast: last day of month, skipping forecast to avoid date-range 400.');
        return [];
    }

    const forecastOptions = (col: CostColumn) => ({
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
                    name: col,
                    function: "Sum"
                }
            }
        }
    } as any);

    let result;
    let fallbackResults: any[] = [];
    let isFallback = false;
    let activeCol: CostColumn = await resolveCostColumn(tenantId);

    try {
        // maxRetries:0 — 429 on MG scope triggers immediate per-sub fallback, not 24s of backoff.
        try {
            result = await withRetry(() => client.forecast.usage(scope, forecastOptions(activeCol)), { label: `forecast(${scope})`, maxRetries: 0 });
        } catch (colErr: any) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(colErr)) {
                console.warn(`[BillingService] CostUSD no soportado en forecast para tenant ${tenantId} — degradando a PreTaxCost.`);
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                result = await withRetry(() => client.forecast.usage(scope, forecastOptions(activeCol)), { label: `forecast(${scope}, PreTaxCost)`, maxRetries: 0 });
            } else {
                throw colErr;
            }
        }
    } catch (e: any) {
        const is429err = is429(e);
        const isAuthOrNotFound = e.statusCode === 403 || e.statusCode === 401 || e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' || e.message?.includes('AuthorizationFailed') || e.code === 'ManagementGroupNotFound' || e.message?.includes("was not found or you don't have access") || e.message?.includes('does not have authorization') || e.message?.includes('does not have any valid subscriptions') || e.statusCode === 400;
        const isAll = subscriptionId === 'All' || subscriptionId.toLowerCase() === 'all';
        if (isAll && (isAuthOrNotFound || is429err)) {
            isFallback = true;
            console.log(`[BillingService] MG scope failed for forecast (${is429err ? '429 throttled' : e.code || e.statusCode}), falling back to subscription iteration...`);
            try {
                const token = await credential.getToken("https://management.azure.com/.default");
                const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                    headers: { 'Authorization': `Bearer ${token.token}` }
                });
                const subJson = await subRes.json();
                const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');

                fallbackResults = (await mapWithConcurrency(subs, 2, async (sub: any) => {
                    try {
                        return await withRetry(
                            () => client.forecast.usage(`/subscriptions/${sub.subscriptionId}`, forecastOptions(activeCol)),
                            { label: `forecast(sub ${sub.subscriptionId})`, maxRetries: 2 }
                        );
                    } catch {
                        return null;
                    }
                })).filter((r: any) => r && r.rows);
            } catch (fallbackErr: any) {
                console.warn('[BillingService] getCostForecast fallback failed:', fallbackErr?.message);
                return [];
            }
        } else {
            // Non-All subscription or non-auth error: return empty instead of throwing
            console.warn(`[BillingService] getCostForecast scope ${scope} failed (${e?.code || e?.statusCode}): ${e?.message}`);
            return [];
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

    // CostUSD (costo normalizado a USD por Azure) en vez de PreTaxCost (moneda
    // de facturación de la suscripción) — ver docs en src/lib/azureCostColumn.ts.
    const buildQueryOptions = (col: CostColumn) => ({
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
                    name: col,
                    function: "Sum"
                }
            }
        }
    } as any);

    let activeCol: CostColumn = await resolveCostColumn(tenantId);
    let queryOptions = buildQueryOptions(activeCol);

    try {
        const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        let result: any;
        try {
            result = await withRetry(() => client.query.usage(scope, queryOptions), { label: `yesterday(MG ${tenantId})` });
        } catch (colErr: any) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(colErr)) {
                console.warn(`[BillingService] CostUSD no soportado (yesterday, MG) para tenant ${tenantId} — degradando a PreTaxCost.`);
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                queryOptions = buildQueryOptions(activeCol);
                result = await withRetry(() => client.query.usage(scope, queryOptions), { label: `yesterday(MG ${tenantId}, PreTaxCost)` });
            } else {
                throw colErr;
            }
        }
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
            const subScope = `/subscriptions/${sub.subscriptionId}`;
            try {
                const res = await withRetry(
                    () => client.query.usage(subScope, queryOptions),
                    { label: `yesterday(sub ${sub.subscriptionId})`, maxRetries: 3 }
                );
                if (res && res.rows && res.rows.length > 0) {
                    totalCost += Number(res.rows[0][0]) || 0;
                }
            } catch (subErr: any) {
                if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(subErr)) {
                    try {
                        const res = await withRetry(
                            () => client.query.usage(subScope, buildQueryOptions('PreTaxCost')),
                            { label: `yesterday(sub ${sub.subscriptionId}, PreTaxCost)`, maxRetries: 3 }
                        );
                        if (res && res.rows && res.rows.length > 0) {
                            totalCost += Number(res.rows[0][0]) || 0;
                        }
                        return;
                    } catch (retryErr: any) {
                        subErr = retryErr;
                    }
                }
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
    // 'chargeback': query A (por ResourceGroup) → CostSnapshots.
    // 'meter': query B (por MeterSubCategory) → CostMeterSnapshots.
    // 'category': query C (por ResourceType) → CostCategorySnapshots.
    // Son el MISMO costo con desgloses distintos: nunca deben convivir en la
    // misma tabla ni sumarse juntas.
    kind: 'chargeback' | 'meter' | 'category';
    subscriptionId: string;
    resourceGroup: string;
    resourceLocation: string;
    resourceType: string;
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

    // CostUSD (costo normalizado a USD por Azure) en vez de PreTaxCost (moneda
    // de facturación de la suscripción) — ver docs en src/lib/azureCostColumn.ts.
    // Resuelto una vez por tenant (no por-sub): un cambio de oferta comercial
    // afecta a todas las suscripciones del tenant por igual en la práctica.
    let activeCol: CostColumn = await resolveCostColumn(tenantId);

    // Cost Management caps grouping dimensions; we run two complementary
    // queries and merge by (sub, rg, service):
    //  A) [ServiceName, ResourceGroupName] -> billing/chargeback shape
    //  B) [ServiceName, MeterSubCategory]  -> storage-tier detection
    const buildBaseDataset = (col: CostColumn) => ({
        granularity: "None",
        aggregation: {
            totalCost: { name: col, function: "Sum" },
            totalQty:  { name: "UsageQuantity", function: "Sum" }
        }
    });
    const buildOpts = (groupings: string[], col: CostColumn) => ({
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from: fromDate, to: toDate },
        dataset: {
            ...buildBaseDataset(col),
            grouping: groupings.map(name => ({ type: 'Dimension', name }))
        }
    } as any);

    // query C: costo por ResourceType (clave de join FOCUS → categoría).
    // 'Meter' (nombre del meter) y no 'MeterSubCategory': el tier de storage
    // (Hot/Cool/Cold/Archive, p.ej. "Cool LRS Data Stored") y el SKU de VM
    // (p.ej. "D4s v5") viven en el nombre del meter. La subcategoría solo dice
    // "Blob Storage"/"Dv5 Series", insuficiente para detectar tiers o cores.
    // + ResourceLocation: región real del recurso (para el desglose por región de
    // compute-cost-per-core). Cost Management acepta esta 3ª dimensión de grouping.
    const buildQueryA = (col: CostColumn) => buildOpts(['ServiceName', 'ResourceGroupName'], col);
    const buildQueryB = (col: CostColumn) => buildOpts(['ServiceName', 'Meter', 'ResourceLocation'], col);
    const buildQueryC = (col: CostColumn) => buildOpts(['ResourceType'], col);

    async function runOnScope(scope: string, opts: any): Promise<{ rows: any[][]; columns: any[] }> {
        const res: any = await withRetry(() => client.query.usage(scope, opts), { label: `detailed(${scope})`, maxRetries: 3 });
        return { rows: res?.rows || [], columns: res?.columns || [] };
    }

    // Corre una query con la columna activa; si Azure rechaza CostUSD, degrada
    // (recordado por tenant en Redis) y reintenta una vez con PreTaxCost.
    async function runOnScopeWithFallback(scope: string, build: (col: CostColumn) => any, label: string): Promise<{ rows: any[][]; columns: any[] }> {
        try {
            return await runOnScope(scope, build(activeCol));
        } catch (e: any) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(e)) {
                console.warn(`[BillingService] CostUSD no soportado (detailed ${label}) para tenant ${tenantId} — degradando a PreTaxCost.`);
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                return await runOnScope(scope, build(activeCol));
            }
            throw e;
        }
    }

    const colIdx = (cols: any[], name: string) => cols.findIndex((c: any) => c.name === name);
    // La columna de costo real en la respuesta es la que Azure aceptó
    // (activeCol tras runOnScopeWithFallback), no necesariamente la que se
    // pidió al inicio de este scope.
    const costColIdx = (cols: any[]) => {
        const usd = colIdx(cols, 'CostUSD');
        return usd >= 0 ? usd : colIdx(cols, 'PreTaxCost');
    };

    async function runForScope(scope: string, subId: string): Promise<DetailedCostRow[]> {
        const out: DetailedCostRow[] = [];
        try {
            const a = await runOnScopeWithFallback(scope, buildQueryA, 'A');
            const sIdx = colIdx(a.columns, 'ServiceName');
            const rgIdx = colIdx(a.columns, 'ResourceGroupName');
            const cIdx = costColIdx(a.columns);
            const qIdx = colIdx(a.columns, 'UsageQuantity');
            for (const row of a.rows) {
                const cost = Number(row[cIdx] ?? 0);
                if (!Number.isFinite(cost) || cost === 0) continue;
                out.push({
                    kind: 'chargeback',
                    subscriptionId: subId,
                    resourceGroup: String(row[rgIdx] ?? '*'),
                    resourceLocation: '',
                    resourceType: '',
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
            const b = await runOnScopeWithFallback(scope, buildQueryB, 'B');
            const sIdx = colIdx(b.columns, 'ServiceName');
            const mIdx = colIdx(b.columns, 'Meter');
            const locIdx = colIdx(b.columns, 'ResourceLocation');
            const cIdx = costColIdx(b.columns);
            const qIdx = colIdx(b.columns, 'UsageQuantity');
            for (const row of b.rows) {
                const cost = Number(row[cIdx] ?? 0);
                if (!Number.isFinite(cost) || cost === 0) continue;
                const meterName = String(row[mIdx] ?? '');
                out.push({
                    kind: 'meter',
                    subscriptionId: subId,
                    resourceGroup: '*',
                    resourceLocation: locIdx >= 0 ? String(row[locIdx] ?? '') : '',
                    resourceType: '',
                    serviceName: String(row[sIdx] ?? ''),
                    serviceFamily: '',
                    meterCategory: '',
                    // El nombre del meter se replica en meterSubCategory porque esa
                    // columna integra la clave única de CostMeterSnapshots y alimenta
                    // detectTier()/labels de SKU aguas abajo.
                    meterSubCategory: meterName,
                    meterName,
                    cost,
                    quantity: Number(row[qIdx] ?? 0) || 0,
                    unitOfMeasure: ''
                });
            }
        } catch (e: any) {
            console.warn(`[BillingService] detailed B query failed for ${scope}:`, e.message);
        }
        try {
            const c = await runOnScopeWithFallback(scope, buildQueryC, 'C');
            const rtIdx = colIdx(c.columns, 'ResourceType');
            const cIdx = costColIdx(c.columns);
            for (const row of c.rows) {
                const cost = Number(row[cIdx] ?? 0);
                if (!Number.isFinite(cost) || cost === 0) continue;
                out.push({
                    kind: 'category',
                    subscriptionId: subId,
                    resourceGroup: '*',
                    resourceLocation: '',
                    resourceType: (rtIdx >= 0 ? String(row[rtIdx] ?? '') : '').toLowerCase(),
                    serviceName: '',
                    serviceFamily: '',
                    meterCategory: '',
                    meterSubCategory: '',
                    meterName: '',
                    cost,
                    quantity: 0,
                    unitOfMeasure: ''
                });
            }
        } catch (e: any) {
            console.warn(`[BillingService] detailed C query failed for ${scope}:`, e.message);
        }
        return out;
    }

    const results: DetailedCostRow[] = [];

    try {
        const mgScope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        const rowsA = await runOnScopeWithFallback(mgScope, buildQueryA, 'A-probe');
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

/**
 * Límite documentado de Azure Cost Management Query API: los datos de costo
 * ("ActualCost") pueden consultarse hasta 13 meses atrás desde la fecha
 * actual, sin importar el tipo de contrato (MCA/EA/CSP). Más allá de esa
 * ventana, Azure requiere Cost Management Exports programados de antemano —
 * no hay forma de recuperar retroactivamente datos más antiguos vía API.
 * Ver: https://learn.microsoft.com/azure/cost-management-billing/costs/understand-cost-mgt-data#cost-data-retention
 */
export const AZURE_COST_HISTORY_MAX_MONTHS = 13;

/**
 * Serie diaria de costo real ("ActualCost") de Azure Cost Management para un
 * rango histórico de hasta `AZURE_COST_HISTORY_MAX_MONTHS` meses atrás. Se usa
 * para completar el histograma del dashboard cuando la ventana solicitada por
 * el usuario excede lo que ya está persistido localmente en `CostSnapshots`
 * (p.ej. tenants nuevos cuyo job diario de snapshots empezó hace poco).
 */
export async function getHistoricalDailyCosts(
    tenantId: string,
    subscriptionId: string | undefined,
    monthsBack: number
): Promise<{ date: string; cost: number }[]> {
    const months = Math.min(Math.max(1, Math.round(monthsBack)), AZURE_COST_HISTORY_MAX_MONTHS);
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - months);

    // Azure Cost Management Query API rechaza rangos Custom de más de 366 días
    // ("Invalid query definition: time period cannot exceed a year"). Para 13
    // meses partimos la ventana en chunks de ≤350 días y mergeamos: una sola
    // query de 395 días fallaba entera y el histograma quedaba solo con lo
    // persistido localmente (a veces, un único día).
    const CHUNK_DAYS = 350;
    const chunks: Array<{ from: Date; to: Date }> = [];
    let cursor = new Date(from);
    while (cursor < to) {
        const chunkEnd = new Date(Math.min(cursor.getTime() + CHUNK_DAYS * 86400000, to.getTime()));
        chunks.push({ from: new Date(cursor), to: chunkEnd });
        cursor = new Date(chunkEnd.getTime() + 86400000);
    }

    const buildQueryOptions = (range: { from: Date; to: Date }, includeUsd: boolean) => ({
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from: range.from, to: range.to },
        dataset: {
            granularity: 'Daily',
            aggregation: includeUsd
                ? {
                    // CostUSD: costo normalizado a dólares por Azure. PreTaxCost
                    // viene en la MONEDA DE FACTURACIÓN de la suscripción (p.ej.
                    // ARS) — usarlo como si fueran dólares inflaba el histograma
                    // y el promedio de la proyección órdenes de magnitud para
                    // tenants no facturados en USD.
                    totalCostUSD: { name: 'CostUSD', function: 'Sum' },
                    totalCost: { name: 'PreTaxCost', function: 'Sum' }
                }
                : {
                    totalCost: { name: 'PreTaxCost', function: 'Sum' }
                }
        }
    } as any);

    const normalizeRows = (rows: any[][], columns: any[]): { date: string; cost: number }[] => {
        const dateIdx = columns.findIndex((c: any) => /usagedate|date/i.test(c?.name || ''));
        // Preferir la columna en USD; PreTaxCost (moneda de facturación) solo
        // como último recurso cuando CostUSD no está disponible para la oferta.
        const usdIdx = columns.findIndex((c: any) => /costusd/i.test(c?.name || ''));
        const preTaxIdx = columns.findIndex((c: any) => /pretaxcost/i.test(c?.name || ''));
        const costIdx = usdIdx >= 0 ? usdIdx : (preTaxIdx >= 0 ? preTaxIdx : 1);
        const byDate = new Map<string, number>();
        for (const row of rows) {
            const rawDate = String(row[dateIdx >= 0 ? dateIdx : 0]);
            const iso = /^\d{8}$/.test(rawDate)
                ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
                : rawDate.slice(0, 10);
            const cost = Number(row[costIdx]) || 0;
            byDate.set(iso, (byDate.get(iso) || 0) + cost);
        }
        return Array.from(byDate.entries())
            .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(2)) }))
            .sort((a, b) => a.date.localeCompare(b.date));
    };

    // Consulta secuencial de todos los chunks sobre un scope (secuencial para
    // no amplificar 429s del rate limit de Cost Management). El PRIMER chunk
    // propaga el error (permite el fallback MG→subscripciones); fallas en
    // chunks posteriores solo se loguean y se devuelve lo acumulado.
    // Si Azure rechaza la agregación CostUSD (ofertas que no la exponen), se
    // reintenta el chunk sin ella, se recuerda la preferencia del tenant
    // (Redis, 7 días — compartida con el resto de billingService.ts) y se
    // sigue con PreTaxCost para el resto de los chunks.
    const queryScopeAllChunks = async (scope: string, label: string): Promise<Map<string, number>> => {
        const byDate = new Map<string, number>();
        let includeUsd = (await resolveCostColumn(tenantId)) === 'CostUSD';
        for (let i = 0; i < chunks.length; i++) {
            try {
                let res: any;
                try {
                    res = await withRetry(
                        () => client.query.usage(scope, buildQueryOptions(chunks[i], includeUsd)),
                        { label: `historical(${label}, chunk ${i + 1}/${chunks.length})`, maxRetries: 3 }
                    );
                } catch (aggErr: any) {
                    if (includeUsd && isCostUsdUnsupportedError(aggErr)) {
                        console.warn(`[BillingService] CostUSD no soportado en ${label}, degradando a PreTaxCost:`, aggErr?.message?.slice(0, 150));
                        includeUsd = false;
                        await degradeCostColumn(tenantId);
                        res = await withRetry(
                            () => client.query.usage(scope, buildQueryOptions(chunks[i], false)),
                            { label: `historical(${label}, chunk ${i + 1}/${chunks.length}, sin USD)`, maxRetries: 3 }
                        );
                    } else {
                        throw aggErr;
                    }
                }
                for (const { date, cost } of normalizeRows(res?.rows || [], res?.columns || [])) {
                    byDate.set(date, (byDate.get(date) || 0) + cost);
                }
            } catch (chunkErr: any) {
                if (i === 0) throw chunkErr;
                console.warn(`[BillingService] Historical chunk ${i + 1}/${chunks.length} failed for ${label}:`, chunkErr.message);
            }
        }
        return byDate;
    };

    const toSortedSeries = (byDate: Map<string, number>) =>
        Array.from(byDate.entries())
            .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(2)) }))
            .sort((a, b) => a.date.localeCompare(b.date));

    const useSubScope = !!subscriptionId && subscriptionId.toLowerCase() !== 'all';
    try {
        const scope = useSubScope
            ? `/subscriptions/${subscriptionId}`
            : `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        const byDate = await queryScopeAllChunks(scope, `${scope}, ${months}mo`);
        if (byDate.size > 0) return toSortedSeries(byDate);
        if (useSubScope) return [];
        throw new Error('MG scope returned 0 rows, falling back to subscriptions');
    } catch (e: any) {
        if (useSubScope) {
            console.warn(`[BillingService] Historical query failed for subscription ${subscriptionId}:`, e.message);
            return [];
        }
        console.warn(`[BillingService] MG scope historical query failed for tenant ${tenantId}, falling back to subscriptions:`, e.message);
        const token = await credential.getToken('https://management.azure.com/.default');
        if (!token) throw new Error('No se pudo obtener el token de acceso de Azure.');
        const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
            headers: { 'Authorization': `Bearer ${token.token}` }
        });
        if (!subRes.ok) throw new Error(`Failed to fetch subscriptions: HTTP ${subRes.status}`);
        const subJson: any = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');

        const merged = new Map<string, number>();
        await mapWithConcurrency(subs, 2, async (sub: any) => {
            try {
                const byDate = await queryScopeAllChunks(`/subscriptions/${sub.subscriptionId}`, `sub ${sub.subscriptionId}, ${months}mo`);
                for (const [date, cost] of byDate.entries()) {
                    merged.set(date, (merged.get(date) || 0) + cost);
                }
            } catch (subErr: any) {
                console.warn(`[BillingService] Historical query failed for subscription ${sub.subscriptionId}:`, subErr.message);
            }
        });
        return toSortedSeries(merged);
    }
}

export type HistoricalDetailedCostRow = DetailedCostRow & {
    /** YYYY-MM-DD — a diferencia de DetailedCostRow (un único día "ayer"), acá
     * cada fila pertenece a un día distinto dentro de la ventana histórica. */
    date: string;
};

/**
 * Igual que getYesterdaysDetailedCosts pero para TODA una ventana histórica
 * (hasta AZURE_COST_HISTORY_MAX_MONTHS meses), con granularidad diaria en vez
 * de un solo día. Pensado para recalcular/limpiar snapshots ya persistidos
 * que se guardaron con PreTaxCost (moneda de facturación) en vez de CostUSD —
 * ver scripts/recalculate-cost-snapshots-usd.ts.
 *
 * Mismo chunking de ≤350 días que getHistoricalDailyCosts (Azure rechaza
 * rangos Custom > 366 días) y misma resolución de columna de costo
 * (CostUSD con degradación automática a PreTaxCost vía azureCostColumn.ts).
 */
export async function getHistoricalDetailedCosts(
    tenantId: string,
    monthsBack: number
): Promise<HistoricalDetailedCostRow[]> {
    const months = Math.min(Math.max(1, Math.round(monthsBack)), AZURE_COST_HISTORY_MAX_MONTHS);
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - months);

    const CHUNK_DAYS = 350;
    const chunks: Array<{ from: Date; to: Date }> = [];
    let cursor = new Date(from);
    while (cursor < to) {
        const chunkEnd = new Date(Math.min(cursor.getTime() + CHUNK_DAYS * 86400000, to.getTime()));
        chunks.push({ from: new Date(cursor), to: chunkEnd });
        cursor = new Date(chunkEnd.getTime() + 86400000);
    }

    let activeCol: CostColumn = await resolveCostColumn(tenantId);

    const buildBaseDataset = (col: CostColumn) => ({
        granularity: 'Daily',
        aggregation: {
            totalCost: { name: col, function: 'Sum' },
            totalQty: { name: 'UsageQuantity', function: 'Sum' }
        }
    });
    const buildOpts = (range: { from: Date; to: Date }, groupings: string[], col: CostColumn) => ({
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from: range.from, to: range.to },
        dataset: {
            ...buildBaseDataset(col),
            grouping: groupings.map(name => ({ type: 'Dimension', name }))
        }
    } as any);

    const buildQueryA = (range: { from: Date; to: Date }, col: CostColumn) => buildOpts(range, ['ServiceName', 'ResourceGroupName'], col);
    const buildQueryB = (range: { from: Date; to: Date }, col: CostColumn) => buildOpts(range, ['ServiceName', 'Meter', 'ResourceLocation'], col);
    const buildQueryC = (range: { from: Date; to: Date }, col: CostColumn) => buildOpts(range, ['ResourceType'], col);

    const colIdx = (cols: any[], name: string) => cols.findIndex((c: any) => c.name === name);
    const costColIdx = (cols: any[]) => {
        const usd = colIdx(cols, 'CostUSD');
        return usd >= 0 ? usd : colIdx(cols, 'PreTaxCost');
    };
    const dateColIdx = (cols: any[]) => cols.findIndex((c: any) => /usagedate/i.test(c?.name || ''));
    const normalizeDate = (raw: unknown): string => {
        const s = String(raw ?? '');
        return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10);
    };

    async function runOnScope(scope: string, opts: any): Promise<{ rows: any[][]; columns: any[] }> {
        const res: any = await withRetry(() => client.query.usage(scope, opts), { label: `histDetailed(${scope})`, maxRetries: 3 });
        return { rows: res?.rows || [], columns: res?.columns || [] };
    }

    async function runChunkWithFallback(
        scope: string,
        build: (range: { from: Date; to: Date }, col: CostColumn) => any,
        range: { from: Date; to: Date },
        label: string
    ): Promise<{ rows: any[][]; columns: any[] }> {
        try {
            return await runOnScope(scope, build(range, activeCol));
        } catch (e: any) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(e)) {
                console.warn(`[BillingService] CostUSD no soportado (historical detailed ${label}) para tenant ${tenantId} — degradando a PreTaxCost.`);
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                return await runOnScope(scope, build(range, activeCol));
            }
            throw e;
        }
    }

    async function runForScope(scope: string, subId: string): Promise<HistoricalDetailedCostRow[]> {
        const out: HistoricalDetailedCostRow[] = [];
        for (const range of chunks) {
            try {
                const a = await runChunkWithFallback(scope, buildQueryA, range, 'A');
                const sIdx = colIdx(a.columns, 'ServiceName');
                const rgIdx = colIdx(a.columns, 'ResourceGroupName');
                const cIdx = costColIdx(a.columns);
                const qIdx = colIdx(a.columns, 'UsageQuantity');
                const dIdx = dateColIdx(a.columns);
                for (const row of a.rows) {
                    const cost = Number(row[cIdx] ?? 0);
                    if (!Number.isFinite(cost) || cost === 0) continue;
                    out.push({
                        kind: 'chargeback',
                        date: normalizeDate(row[dIdx]),
                        subscriptionId: subId,
                        resourceGroup: String(row[rgIdx] ?? '*'),
                        resourceLocation: '',
                        resourceType: '',
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
                console.warn(`[BillingService] historical detailed A query failed for ${scope}:`, e.message);
            }
            try {
                const b = await runChunkWithFallback(scope, buildQueryB, range, 'B');
                const sIdx = colIdx(b.columns, 'ServiceName');
                const mIdx = colIdx(b.columns, 'Meter');
                const locIdx = colIdx(b.columns, 'ResourceLocation');
                const cIdx = costColIdx(b.columns);
                const qIdx = colIdx(b.columns, 'UsageQuantity');
                const dIdx = dateColIdx(b.columns);
                for (const row of b.rows) {
                    const cost = Number(row[cIdx] ?? 0);
                    if (!Number.isFinite(cost) || cost === 0) continue;
                    const meterName = String(row[mIdx] ?? '');
                    out.push({
                        kind: 'meter',
                        date: normalizeDate(row[dIdx]),
                        subscriptionId: subId,
                        resourceGroup: '*',
                        resourceLocation: locIdx >= 0 ? String(row[locIdx] ?? '') : '',
                        resourceType: '',
                        serviceName: String(row[sIdx] ?? ''),
                        serviceFamily: '',
                        meterCategory: '',
                        meterSubCategory: meterName,
                        meterName,
                        cost,
                        quantity: Number(row[qIdx] ?? 0) || 0,
                        unitOfMeasure: ''
                    });
                }
            } catch (e: any) {
                console.warn(`[BillingService] historical detailed B query failed for ${scope}:`, e.message);
            }
            try {
                const c = await runChunkWithFallback(scope, buildQueryC, range, 'C');
                const rtIdx = colIdx(c.columns, 'ResourceType');
                const cIdx = costColIdx(c.columns);
                const dIdx = dateColIdx(c.columns);
                for (const row of c.rows) {
                    const cost = Number(row[cIdx] ?? 0);
                    if (!Number.isFinite(cost) || cost === 0) continue;
                    out.push({
                        kind: 'category',
                        date: normalizeDate(row[dIdx]),
                        subscriptionId: subId,
                        resourceGroup: '*',
                        resourceLocation: '',
                        resourceType: (rtIdx >= 0 ? String(row[rtIdx] ?? '') : '').toLowerCase(),
                        serviceName: '',
                        serviceFamily: '',
                        meterCategory: '',
                        meterSubCategory: '',
                        meterName: '',
                        cost,
                        quantity: 0,
                        unitOfMeasure: ''
                    });
                }
            } catch (e: any) {
                console.warn(`[BillingService] historical detailed C query failed for ${scope}:`, e.message);
            }
        }
        return out;
    }

    const results: HistoricalDetailedCostRow[] = [];

    try {
        const mgScope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        const probe = await runChunkWithFallback(mgScope, buildQueryA, chunks[0], 'A-probe');
        if (probe.rows.length > 0) {
            results.push(...await runForScope(mgScope, 'mg-aggregated'));
            return results;
        }
        throw new Error('MG scope returned 0 rows in probe chunk, falling back to subs');
    } catch (e: any) {
        const token = await credential.getToken('https://management.azure.com/.default');
        if (!token) throw new Error('No se pudo obtener token Azure');
        const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
            headers: { 'Authorization': `Bearer ${token.token}` }
        });
        if (!subRes.ok) throw new Error(`Failed to fetch subscriptions: HTTP ${subRes.status}`);
        const subJson: any = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');
        await mapWithConcurrency(subs, 2, async (sub: any) => {
            const subId: string = sub.subscriptionId;
            try {
                const rows = await runForScope(`/subscriptions/${subId}`, subId);
                results.push(...rows);
            } catch (subErr: any) {
                console.warn(`[BillingService] historical detailed query failed for subscription ${subId}:`, subErr.message);
            }
        });
        return results;
    }
}
