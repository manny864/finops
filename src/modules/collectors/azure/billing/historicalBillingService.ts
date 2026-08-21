import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from '@/lib/azure';
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, type CostColumn } from '@/lib/azureCostColumn';
import { AZURE_COST_HISTORY_MAX_MONTHS, HistoricalDetailedCostRow } from './billingTypes';
import { withRetry, mapWithConcurrency } from './billingHelpers';

export { AZURE_COST_HISTORY_MAX_MONTHS };

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
    } catch {
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
