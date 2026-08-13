import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getAllSubscriptionsForTenant } from '@/lib/azure';
import { FocusCostEntry, mapAzureToFocus } from '@/modules/core/focusMapper';
import { getWithStaleWhileRevalidate } from '@/lib/cache';
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, type CostColumn } from '@/lib/azureCostColumn';

import { CostQueryDiagnostics } from './billingTypes';
import {
    is429,
    withRetry,
    mapWithConcurrency,
    COST_INFLIGHT,
    getFromCache,
    setCache
} from './billingHelpers';

class MgScopeBypass extends Error {
    constructor() { super('MG scope no existe para este tenant: se itera por suscripción'); }
}

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

    const isAllScope = subscriptionId === 'All' || subscriptionId.toLowerCase() === 'all';

    try {
        if (isAllScope) throw new MgScopeBypass();

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

        const isAll = isAllScope;
        const isBypass = e instanceof MgScopeBypass;

        if (isBypass) {
            diagnostics.scopeAttempted = 'per-subscription';
        } else if (isAll && (isAuthOrNotFound || is429err)) {
            diagnostics.isFallback = true;
            console.log(`[BillingService] MG scope failed (${is429err ? '429 throttled' : e.code || e.statusCode}), iterating subscriptions...`);
        } else if (!isAll && isAuthOrNotFound) {
            console.warn(`[BillingService] Cost query unauthorized for sub ${subscriptionId} (${e.statusCode}): ${e.message?.slice(0, 120)}`);
            setCache(cacheKey, [], diagnostics);
            return { data: [], diagnostics };
        } else {
            throw e;
        }

        const subIds = await getAllSubscriptionsForTenant(tenantId, credential);
        const subs = subIds.map((subId) => ({ subscriptionId: subId }));
        diagnostics.subsDiscovered = subs.length;
        diagnostics.subsList = subIds;

        await mapWithConcurrency(subs, 2, async (sub: any) => {
            const subId: string = sub.subscriptionId;
            try {
                const res = await withRetry(
                    () => client.query.usage(`/subscriptions/${subId}`, mtdOptions),
                    { label: `usage(sub ${subId})`, maxRetries: 2 }
                );
                diagnostics.subsSucceeded++;
                const n = processResult(res);
                if (n > 0) diagnostics.subsWithData++;
            } catch (subErr: any) {
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
            }
        });

        diagnostics.totalRows = focusData.length;

        const has429Errors = diagnostics.perSubErrors.some(e => is429(e));
        if (has429Errors) {
            diagnostics.isThrottled = true;
        }

        if (focusData.length === 0 && diagnostics.subsSucceeded === 0 && has429Errors) {
            const throttleErr = new Error(`Azure Cost Management 429 Throttled (subs throttled for ${tenantId})`);
            (throttleErr as any).diagnostics = diagnostics;
            (throttleErr as any).is429 = true;
            throw throttleErr;
        }

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

const MTD_SHARED_TTL_SECONDS = 900;
const MTD_DEGRADED_TTL_SECONDS = 120;

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

    const inflight = COST_INFLIGHT.get(cacheKey);
    if (inflight) {
        console.log(`[BillingService] Reusing in-flight query for ${cacheKey}`);
        return inflight;
    }

    const promise = getWithStaleWhileRevalidate(
        `cost:mtd:shared:v1:${tenantId}:${subscriptionId.toLowerCase()}:${metricType}`,
        () => _fetchCostData(tenantId, subscriptionId, metricType, cacheKey),
        MTD_SHARED_TTL_SECONDS,
        undefined,
        (result) => {
            if (result?.diagnostics?.isThrottled && result?.data?.length === 0) {
                return 0;
            }
            return result?.data?.length ? MTD_SHARED_TTL_SECONDS : MTD_DEGRADED_TTL_SECONDS;
        }
    )
    .catch((err: any) => {
        console.warn(`[BillingService] MTD cost query failed for ${tenantId}:`, err?.message);
        const diagnostics: CostQueryDiagnostics = err?.diagnostics || {
            scopeAttempted: subscriptionId,
            isFallback: true,
            isThrottled: is429(err),
            subsDiscovered: 0,
            subsSucceeded: 0,
            subsWithData: 0,
            perSubErrors: [{ subscriptionId, code: '429', message: String(err?.message || err) }],
            totalRows: 0,
            subsList: [],
            timeframeUsed: 'MonthToDate',
        };
        return { data: [], diagnostics };
    })
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
