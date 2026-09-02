import { getAzureCredential, getCostManagementClient, isSubscriptionStateEligible } from '@/lib/azure';
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, type CostColumn } from '@/lib/azureCostColumn';
import { DetailedCostRow, TagCostRow } from './billingTypes';
import { withRetry, mapWithConcurrency, throwIfAborted, isMgScopeKnownUnusable, markMgScopeUnusable, isStructuralScopeFailure } from './billingHelpers';
import { errorMessage } from '@/lib/apiErrors';

export async function getYesterdaysCost(tenantId: string, targetDate?: Date, signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    const credential = await getAzureCredential(tenantId);
    const client = await getCostManagementClient(tenantId);

    const yesterday = targetDate ?? (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();
    const yyyy = yesterday.getFullYear();
    const mm = yesterday.getMonth();
    const dd = yesterday.getDate();
    const fromDate = new Date(yyyy, mm, dd, 0, 0, 0);
    const toDate = new Date(yyyy, mm, dd, 23, 59, 59);

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
                totalCost: { name: col, function: "Sum" }
            }
        }
    }) as any;

    let activeCol: CostColumn = await resolveCostColumn(tenantId);
    let totalCost = 0;

    const runForScope = async (scope: string, label: string): Promise<number> => {
        try {
            const res = await withRetry(
                () => client.query.usage(scope, buildQueryOptions(activeCol)),
                { label: `yesterday(${label})`, maxRetries: 2, baseDelayMs: 1500, signal }
            );
            if (res.rows && res.rows.length > 0 && res.rows[0].length > 0) {
                return Number(res.rows[0][0]) || 0;
            }
            return 0;
        } catch (err) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(err)) {
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                const retryRes = await withRetry(
                    () => client.query.usage(scope, buildQueryOptions(activeCol)),
                    { label: `yesterday(${label}, PreTaxCost)`, maxRetries: 2, baseDelayMs: 1500, signal }
                );
                if (retryRes.rows && retryRes.rows.length > 0 && retryRes.rows[0].length > 0) {
                    return Number(retryRes.rows[0][0]) || 0;
                }
                return 0;
            }
            throw err;
        }
    };

    const token = await credential.getToken('https://management.azure.com/.default');
    if (!token) throw new Error('No se pudo obtener token Azure');

    const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
        headers: { 'Authorization': `Bearer ${token.token}` },
        signal,
    });
    const subJson: any = await subRes.json();
    const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && isSubscriptionStateEligible(s.state));

    await mapWithConcurrency(subs, 1, async (sub: any, idx: number) => {
        if (idx > 0) {
            await new Promise((r) => setTimeout(r, 300));
        }
        try {
            const subCost = await runForScope(`/subscriptions/${sub.subscriptionId}`, sub.subscriptionId);
            totalCost += subCost;
        } catch (subErr) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(subErr)) {
                try {
                    await degradeCostColumn(tenantId);
                    activeCol = 'PreTaxCost';
                    const subCost = await runForScope(`/subscriptions/${sub.subscriptionId}`, `${sub.subscriptionId}-pretax`);
                    totalCost += subCost;
                    return;
                } catch (retryErr) {
                    subErr = retryErr;
                }
            }
            console.warn(`Failed to query yesterday's cost for subscription ${sub.subscriptionId}:`, errorMessage(subErr));
        }}, signal);
    return totalCost;
}

export async function getYesterdaysDetailedCosts(tenantId: string, targetDate?: Date, signal?: AbortSignal): Promise<DetailedCostRow[]> {
    throwIfAborted(signal);
    const credential = await getAzureCredential(tenantId);
    const client = await getCostManagementClient(tenantId);

    const yesterday = targetDate ?? (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();
    const yyyy = yesterday.getFullYear();
    const mm = yesterday.getMonth();
    const dd = yesterday.getDate();
    const fromDate = new Date(yyyy, mm, dd, 0, 0, 0);
    const toDate = new Date(yyyy, mm, dd, 23, 59, 59);

    let activeCol: CostColumn = await resolveCostColumn(tenantId);

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

    const buildQueryA = (col: CostColumn) => buildOpts(['ServiceName', 'ResourceGroupName'], col);
    const buildQueryB = (col: CostColumn) => buildOpts(['ServiceName', 'Meter', 'ResourceLocation'], col);
    const buildQueryC = (col: CostColumn) => buildOpts(['ResourceType'], col);

    async function runOnScope(scope: string, opts: any): Promise<{ rows: any[][]; columns: any[] }> {
        const res: any = await withRetry(
            () => client.query.usage(scope, opts, { abortSignal: signal }),
            { label: `detailed(${scope})`, maxRetries: 3, signal },
        );
        return { rows: res?.rows || [], columns: res?.columns || [] };
    }

    async function runOnScopeWithFallback(scope: string, build: (col: CostColumn) => any, label: string): Promise<{ rows: any[][]; columns: any[] }> {
        try {
            return await runOnScope(scope, build(activeCol));
        } catch (e) {
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
        } catch (e) {
            console.warn(`[BillingService] detailed A query failed for ${scope}:`, errorMessage(e));
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
                    meterSubCategory: meterName,
                    meterName,
                    cost,
                    quantity: Number(row[qIdx] ?? 0) || 0,
                    unitOfMeasure: ''
                });
            }
        } catch (e) {
            console.warn(`[BillingService] detailed B query failed for ${scope}:`, errorMessage(e));
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
        } catch (e) {
            console.warn(`[BillingService] detailed C query failed for ${scope}:`, errorMessage(e));
        }
        return out;
    }

    const results: DetailedCostRow[] = [];

    // Ver billingHelpers: en tenants sin management group utilizable, este probe
    // se lleva 3 reintentos con backoff contra la cuota antes de fallar, en cada
    // corrida. Si ya se comprobó, se salta directo a suscripciones.
    const skipMgProbe = isMgScopeKnownUnusable(tenantId);
    try {
        if (skipMgProbe) throw new Error('MG scope marcado como inutilizable para este tenant');
        const mgScope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        const rowsA = await runOnScopeWithFallback(mgScope, buildQueryA, 'A-probe');
        if (rowsA.rows.length > 0) {
            results.push(...await runForScope(mgScope, 'mg-aggregated'));
            return results;
        }
        throw new Error('MG scope returned 0 rows, falling back to subs');
    } catch (probeErr) {
        if (!skipMgProbe && isStructuralScopeFailure(probeErr)) {
            markMgScopeUnusable(tenantId, errorMessage(probeErr));
        }
        const token = await credential.getToken('https://management.azure.com/.default');
        if (!token) throw new Error('No se pudo obtener token Azure');
        const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
            headers: { 'Authorization': `Bearer ${token.token}` },
            signal,
        });
        const subJson: any = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');
        await mapWithConcurrency(subs, 1, async (sub: any, idx: number) => {
            if (idx > 0) {
                await new Promise((r) => setTimeout(r, 300));
            }
            const subId: string = sub.subscriptionId;
            const rows = await runForScope(`/subscriptions/${subId}`, subId);
            results.push(...rows);
        }, signal);
        return results;
    }
}

/**
 * MEJ-30 paso 2: costo del día desglosado por el VALOR de una etiqueta.
 *
 * Para tenants sin export FOCUS configurado, que es el único camino por el que
 * hoy llegan etiquetas (`costExportIngestionService`). Un tenant con export no
 * debe llamar acá: ya tiene el dato exacto y más barato.
 *
 * POR QUÉ UNA CONSULTA POR CLAVE DE ETIQUETA
 * La Query API admite 2 agrupaciones. Traer la etiqueta gasta una en `TagKey`,
 * y la otra se usa en `ResourceGroupName` (la dimensión por la que matchean
 * las reglas de Cost Groups). No entra `ServiceName`: ese desglose ya lo cubre
 * `CostSnapshots`, y pedir 3 agrupaciones haría fallar la consulta entera.
 *
 * El costo en llamadas es `claves × scopes`, por eso el llamador acota
 * `tagKeys` a las que alguna regla usa de verdad -- no a todas las del tenant.
 */
export async function getYesterdaysTagCosts(
    tenantId: string,
    tagKeys: string[],
    targetDate?: Date,
    signal?: AbortSignal,
): Promise<TagCostRow[]> {
    throwIfAborted(signal);
    if (tagKeys.length === 0) return [];

    const credential = await getAzureCredential(tenantId);
    const client = await getCostManagementClient(tenantId);

    const yesterday = targetDate ?? (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();
    const fromDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
    const toDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);

    let activeCol: CostColumn = await resolveCostColumn(tenantId);

    const buildOpts = (tagKey: string, col: CostColumn) => ({
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from: fromDate, to: toDate },
        dataset: {
            granularity: 'None',
            aggregation: { totalCost: { name: col, function: 'Sum' } },
            // Exactamente 2: el máximo que admite la Query API.
            grouping: [
                { type: 'TagKey', name: tagKey },
                { type: 'Dimension', name: 'ResourceGroupName' },
            ],
        },
    }) as any;

    const colIdx = (cols: any[], name: string) => cols.findIndex((c: any) => c.name === name);

    async function runOne(scope: string, tagKey: string): Promise<TagCostRow[]> {
        const exec = async (col: CostColumn) => {
            const res: any = await withRetry(
                () => client.query.usage(scope, buildOpts(tagKey, col), { abortSignal: signal }),
                { label: `tagCost(${tagKey})`, maxRetries: 2, baseDelayMs: 1500, signal },
            );
            return { rows: res?.rows || [], columns: res?.columns || [] };
        };

        let res;
        try {
            res = await exec(activeCol);
        } catch (e) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(e)) {
                await degradeCostColumn(tenantId);
                activeCol = 'PreTaxCost';
                res = await exec(activeCol);
            } else {
                throw e;
            }
        }

        // El nombre de la columna del valor varía según versión de API: unas
        // devuelven `TagValue`, otras la clave pedida. Se resuelve por nombre y
        // recién como último recurso por descarte, para no leer la columna
        // equivocada en silencio.
        const usdIdx = colIdx(res.columns, 'CostUSD');
        const cIdx = usdIdx >= 0 ? usdIdx : colIdx(res.columns, 'PreTaxCost');
        const rgIdx = colIdx(res.columns, 'ResourceGroupName');
        let valIdx = colIdx(res.columns, 'TagValue');
        if (valIdx < 0) valIdx = colIdx(res.columns, tagKey);
        if (valIdx < 0) {
            valIdx = res.columns.findIndex((_: any, i: number) => i !== cIdx && i !== rgIdx);
        }
        if (cIdx < 0 || valIdx < 0) {
            throw new Error(`Respuesta sin las columnas esperadas para TagKey=${tagKey}: ${res.columns.map((c: any) => c.name).join(', ')}`);
        }

        const out: TagCostRow[] = [];
        for (const row of res.rows) {
            const cost = Number(row[cIdx] ?? 0);
            if (!Number.isFinite(cost) || cost === 0) continue;
            out.push({
                subscriptionId: '',
                resourceGroup: rgIdx >= 0 ? String(row[rgIdx] ?? '*') : '*',
                tagKey,
                // Azure devuelve el valor como `clave:valor` en algunas
                // versiones; se queda con el valor. Vacío = recurso sin esa
                // etiqueta, que es un dato válido (gasto sin asignar).
                tagValue: String(row[valIdx] ?? '').replace(new RegExp(`^${tagKey}:`, 'i'), ''),
                cost,
            });
        }
        return out;
    }

    const results: TagCostRow[] = [];

    // Se reusa lo que el sync principal ya aprendió del scope de management
    // group: si lo marcó inutilizable, se va directo a suscripciones en vez de
    // pagar otra vez 3 reintentos con backoff contra la cuota.
    if (!isMgScopeKnownUnusable(tenantId)) {
        const mgScope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
        try {
            for (const key of tagKeys) {
                throwIfAborted(signal);
                results.push(...(await runOne(mgScope, key)).map(r => ({ ...r, subscriptionId: 'mg-aggregated' })));
            }
            return results;
        } catch (mgErr) {
            if (isStructuralScopeFailure(mgErr)) markMgScopeUnusable(tenantId, errorMessage(mgErr));
            results.length = 0; // No mezclar un MG a medias con el barrido por suscripción.
        }
    }

    const token = await credential.getToken('https://management.azure.com/.default');
    if (!token) throw new Error('No se pudo obtener token Azure');
    const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
        headers: { 'Authorization': `Bearer ${token.token}` },
        signal,
    });
    const subJson: any = await subRes.json();
    const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && isSubscriptionStateEligible(s.state));

    await mapWithConcurrency(subs, 1, async (sub: any, idx: number) => {
        if (idx > 0) await new Promise((r) => setTimeout(r, 300));
        for (const key of tagKeys) {
            throwIfAborted(signal);
            const rows = await runOne(`/subscriptions/${sub.subscriptionId}`, key);
            results.push(...rows.map(r => ({ ...r, subscriptionId: sub.subscriptionId })));
        }
    }, signal);

    return results;
}
