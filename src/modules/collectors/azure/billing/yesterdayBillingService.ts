import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from '@/lib/azure';
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, type CostColumn } from '@/lib/azureCostColumn';
import { DetailedCostRow } from './billingTypes';
import { withRetry, mapWithConcurrency, throwIfAborted } from './billingHelpers';

export async function getYesterdaysCost(tenantId: string, targetDate?: Date, signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

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
                totalCost: {
                    name: col,
                    function: "Sum"
                }
            }
        }
    } as any);

    const activeCol: CostColumn = await resolveCostColumn(tenantId);
    const queryOptions = buildQueryOptions(activeCol);

    const token = await credential.getToken("https://management.azure.com/.default");
    if (!token) {
        throw new Error("No se pudo obtener el token de acceso de Azure.");
    }

    const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
        headers: { 'Authorization': `Bearer ${token.token}` },
        signal,
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
                () => client.query.usage(subScope, queryOptions, { abortSignal: signal }),
                { label: `yesterday(sub ${sub.subscriptionId})`, maxRetries: 3, signal }
            );
            if (res && res.rows && res.rows.length > 0) {
                totalCost += Number(res.rows[0][0]) || 0;
            }
        } catch (subErr: any) {
            if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(subErr)) {
                try {
                    const res = await withRetry(
                        () => client.query.usage(subScope, buildQueryOptions('PreTaxCost'), { abortSignal: signal }),
                        { label: `yesterday(sub ${sub.subscriptionId}, PreTaxCost)`, maxRetries: 3, signal }
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
    }, signal);
    return totalCost;
}

export async function getYesterdaysDetailedCosts(tenantId: string, targetDate?: Date, signal?: AbortSignal): Promise<DetailedCostRow[]> {
    throwIfAborted(signal);
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

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
        const token = await credential.getToken('https://management.azure.com/.default');
        if (!token) throw new Error('No se pudo obtener token Azure');
        const subRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
            headers: { 'Authorization': `Bearer ${token.token}` },
            signal,
        });
        const subJson: any = await subRes.json();
        const subs = (subJson.value || []).filter((s: any) => s.subscriptionId && s.state === 'Enabled');
        await mapWithConcurrency(subs, 3, async (sub: any) => {
            const subId: string = sub.subscriptionId;
            const rows = await runForScope(`/subscriptions/${subId}`, subId);
            results.push(...rows);
        }, signal);
        return results;
    }
}
