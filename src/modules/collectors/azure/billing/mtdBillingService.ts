import { getAzureCredential, getAllSubscriptionsForTenant, getCostManagementClient } from '@/lib/azure';
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
    setCache,
    isMgScopeKnownUnusable,
    markMgScopeUnusable,
    isStructuralScopeFailure
} from './billingHelpers';
import { errorMessage } from '@/lib/apiErrors';

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
    const client = await getCostManagementClient(tenantId);

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
            result = await withRetry(() => client.query.usage(scope, mtdOptions), { tenantId, label: `usage(MG ${tenantId})`, maxRetries: 0 });
        } catch (colErr) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(colErr)) {
                console.warn(`[BillingService] CostUSD no soportado (MG scope) para tenant ${tenantId} — degradando a PreTaxCost.`);
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                mtdOptions = buildOptions('MonthToDate', activeCol);
                result = await withRetry(() => client.query.usage(scope, mtdOptions), { tenantId, label: `usage(MG ${tenantId}, PreTaxCost)`, maxRetries: 0 });
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
            if (isStructuralScopeFailure(e)) {
                markMgScopeUnusable(tenantId, errorMessage(e));
            }
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

        await mapWithConcurrency(subs, 1, async (sub: any, idx: number) => {
            const subId: string = sub.subscriptionId;
            if (idx > 0) {
                // Escalonar llamadas entre suscripciones para no agotar la cuota simultánea
                await new Promise((r) => setTimeout(r, 450));
            }
            try {
                const res = await withRetry(
                    () => client.query.usage(`/subscriptions/${subId}`, mtdOptions),
                    { tenantId, label: `usage(sub ${subId})`, maxRetries: 4, baseDelayMs: 2500 }
                );
                diagnostics.subsSucceeded++;
                const n = processResult(res);
                if (n > 0) diagnostics.subsWithData++;
            } catch (subErr: any) {
                let recovered = false;
                if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(subErr)) {
                    try {
                        const fallbackOptions = buildOptions('MonthToDate', 'PreTaxCost');
                        const res = await withRetry(
                            () => client.query.usage(`/subscriptions/${subId}`, fallbackOptions),
                            { tenantId, label: `usage(sub ${subId}, PreTaxCost)`, maxRetries: 4, baseDelayMs: 2500 }
                        );
                        diagnostics.subsSucceeded++;
                        const n = processResult(res);
                        if (n > 0) diagnostics.subsWithData++;
                        recovered = true;
                    } catch (retryErr) {
                        subErr = retryErr;
                    }
                }

                // Fallback si 4 agrupaciones son rechazadas por la oferta de la suscripción
                if (!recovered && (subErr.statusCode === 400 || subErr.status === 400 || subErr.code === 'BadRequest')) {
                    try {
                        const simplifiedOptions: any = {
                            type: metricType === 'ActualCost' ? 'ActualCost' : 'AmortizedCost',
                            timeframe: 'MonthToDate',
                            dataset: {
                                granularity: "Daily",
                                aggregation: {
                                    totalCost: { name: activeCol === 'CostUSD' ? 'CostUSD' : 'PreTaxCost', function: "Sum" }
                                },
                                grouping: [
                                    { type: "Dimension", name: "ServiceName" },
                                    { type: "Dimension", name: "SubscriptionId" }
                                ]
                            }
                        };
                        const res = await withRetry(
                            () => client.query.usage(`/subscriptions/${subId}`, simplifiedOptions),
                            { tenantId, label: `usage(sub ${subId}, simplified 2d)`, maxRetries: 2, baseDelayMs: 1500 }
                        );
                        diagnostics.subsSucceeded++;
                        const n = processResult(res);
                        if (n > 0) diagnostics.subsWithData++;
                        recovered = true;
                    } catch {
                        try {
                            const minimalOptions: any = {
                                type: metricType === 'ActualCost' ? 'ActualCost' : 'AmortizedCost',
                                timeframe: 'MonthToDate',
                                dataset: {
                                    granularity: "Daily",
                                    aggregation: {
                                        totalCost: { name: 'PreTaxCost', function: "Sum" }
                                    },
                                    grouping: [
                                        { type: "Dimension", name: "ServiceName" }
                                    ]
                                }
                            };
                            const res = await withRetry(
                                () => client.query.usage(`/subscriptions/${subId}`, minimalOptions),
                                { tenantId, label: `usage(sub ${subId}, minimal 1d)`, maxRetries: 2, baseDelayMs: 1500 }
                            );
                            diagnostics.subsSucceeded++;
                            const n = processResult(res);
                            if (n > 0) diagnostics.subsWithData++;
                            recovered = true;
                        } catch (finalErr) {
                            subErr = finalErr;
                        }
                    }
                }

                if (!recovered) {
                    const code = subErr.code || subErr.statusCode || 'UNKNOWN';
                    const message = (subErr.message || String(subErr)).slice(0, 240);
                    diagnostics.perSubErrors.push({ subscriptionId: subId, code: String(code), message });
                    console.warn(`[BillingService] Cost query failed for sub ${subId} (code=${code}): ${message}`);
                }
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

            // Bajado de 2 a 1 (2026-09-17): igual motivo que en
            // historicalBillingService — con concurrencia 2, el stagger de
            // 350ms de abajo no sirve de nada (corren dos workers en paralelo,
            // cada uno con su propio idx 0,2,4.../1,3,5...), así que dos subs
            // seguían pegándole a Cost Management en el mismo instante. Con 1
            // el stagger sí actúa como pacing real entre subs.
            await mapWithConcurrency(diagnostics.subsList, 1, async (subId, idx) => {
                if (idx > 0) await new Promise((r) => setTimeout(r, 350));
                try {
                    const res = await withRetry(
                        () => client.query.usage(`/subscriptions/${subId}`, last30Options),
                        { tenantId, label: `fallback30d(sub ${subId})`, maxRetries: 3, baseDelayMs: 2000 }
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

const MTD_SHARED_TTL_SECONDS = 1800; // 30 minutos (sincronizado con cadencia de Azure Cost Management)
// Un minuto era demasiado corto para el caso que más se da: Cost Management
// throttleando. Reintentar cada 60 s contra un servicio que está pidiendo que
// aflojes es lo que sostiene el throttle. 5 minutos sigue siendo un reintento
// rápido para un dato que Azure consolida cada 8-24 h.
const MTD_DEGRADED_TTL_SECONDS = 300;

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
            // Throttleado y sin datos: no se guarda este vacío Y --desde el
            // arreglo en `cache.ts`-- tampoco se borra el último valor bueno.
            // Antes se borraba, y era el bucle: cada 429 dejaba el caché vacío,
            // la request siguiente volvía a consultar, Azure seguía throttleado.
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
