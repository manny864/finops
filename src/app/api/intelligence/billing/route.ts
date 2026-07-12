import { NextRequest, NextResponse } from 'next/server';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { getCurrentMonthAmortizedCosts } from '@/modules/collectors/azure/billingService';
import { getWithStaleWhileRevalidate } from '@/lib/cache';
import { requireTenantRole, AuthError } from '@/lib/requestAuth';
import { redis } from '@/lib/redis';
import { serverError } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        // Auth: tenantId MUST come from the JWT, not from client headers.
        const subscriptionId = request.headers.get('x-subscription-id') || 'All';
        const metricTypeHeader = (request.headers.get('x-metric-type') || 'ActualCost') as 'ActualCost' | 'AmortizedCost';
        const metricType: 'ActualCost' | 'AmortizedCost' = metricTypeHeader === 'AmortizedCost' ? 'AmortizedCost' : 'ActualCost';

        // Read tenantId from query param (for compatibility), then validate via JWT.
        const tenantId = request.headers.get('x-tenant-id') || new URL(request.url).searchParams.get('tenantId');
        if (!tenantId || !subscriptionId) {
            return NextResponse.json(
                { error: 'Faltan credenciales del entorno (tenantId y subscriptionId)' },
                { status: 400 }
            );
        }

        // Validate JWT identity and assert caller belongs to this tenant.
        await requireTenantRole(request, tenantId, ['Admin', 'Owner', 'Reader', 'Colaborador', 'Analista FinOps', 'Admin Cloud', 'Auditor de Seguridad', 'Product Owner']);

        // Ensure DB schema exists before querying
        await initializeDatabase();

        // Redis cache: fast path for Consumo Real data (15-min TTL, bust on new month).
        const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
        const billingCacheKey = `billing:data:v1:${tenantId}:${subscriptionId.toLowerCase()}:${metricType}:${ym}`;
        try {
            const cached = await redis.get(billingCacheKey);
            if (cached) {
                return NextResponse.json(JSON.parse(cached));
            }
        } catch (_) { /* Redis miss → continue */ }

        // 1. Try to read cached data from MySQL CostSnapshots
        let rows: any[] = [];
        try {
            if (subscriptionId.toLowerCase() === 'all') {
                const [data] = await pool.query(
                    `SELECT date, resource_group, service_name, cost_usd, subscription_id, 
                            ChargePeriodStart, ChargePeriodEnd, ProviderName, PublisherName, SubAccountId, BilledCost, EffectiveCost, CommitmentDiscountId, Tags
                     FROM CostSnapshots
                     WHERE tenant_id = ?
                     ORDER BY date ASC`,
                    [tenantId]
                );
                rows = data as any[];
            } else {
                const [data] = await pool.query(
                    `SELECT date, resource_group, service_name, cost_usd, subscription_id,
                            ChargePeriodStart, ChargePeriodEnd, ProviderName, PublisherName, SubAccountId, BilledCost, EffectiveCost, CommitmentDiscountId, Tags
                     FROM CostSnapshots
                     WHERE tenant_id = ? AND subscription_id = ?
                     ORDER BY date ASC`,
                    [tenantId, subscriptionId]
                );
                rows = data as any[];
            }
        } catch (dbErr: any) {
            console.warn('[Billing] DB read failed, will fallback to live query:', dbErr.code);
            rows = [];
        }

        // 2. If cache is empty, fallback to live Azure Cost Management query
        //    (wrapped en Redis SWR para evitar pegarle a Azure en cada refresh).
        if (rows.length === 0) {
            console.log('[Billing] No cached data, querying Azure Cost Management live (Redis SWR)...');
            try {
                const cacheKey = `billing:live:${tenantId}:${subscriptionId}:${metricType}`;
                // ttl=30min, softTtl=10min → 10m de cache duro + 20m de stale-while-revalidate
                const focusData = await getWithStaleWhileRevalidate(
                    cacheKey,
                    () => getCurrentMonthAmortizedCosts(tenantId, subscriptionId, metricType),
                    1800,
                    600
                );
                return NextResponse.json({ success: true, data: focusData });
            } catch (azureErr: any) {
                console.error('[Billing] Azure Cost Management query failed:', azureErr.message);
                // Return empty array gracefully
                return NextResponse.json({ success: true, data: [] });
            }
        }

        // 3. Map cached DB records to FocusCostEntry[] structure
        const mappedData = rows.map((row: any) => {
            let dateStr = '';
            if (row.date) {
                const d = new Date(row.date);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dateStr = `${y}-${m}-${day}`;
            }

            return {
                BilledCost: row.BilledCost !== null ? Number(row.BilledCost) : Number(row.cost_usd),
                EffectiveCost: row.EffectiveCost !== null ? Number(row.EffectiveCost) : Number(row.cost_usd),
                ChargeCategory: 'Usage',
                ProviderName: row.ProviderName || 'Azure',
                SubAccountId: row.SubAccountId || row.subscription_id,
                ServiceName: row.service_name,
                UsageDate: dateStr,
                ChargePeriodStart: row.ChargePeriodStart ? new Date(row.ChargePeriodStart).toISOString() : dateStr,
                ChargePeriodEnd: row.ChargePeriodEnd ? new Date(row.ChargePeriodEnd).toISOString() : dateStr,
                PublisherName: row.PublisherName || 'Microsoft',
                CommitmentDiscountId: row.CommitmentDiscountId || 'None',
                Tags: row.Tags || '{}'
            };
        });

        const response = { success: true, data: mappedData };
        // Cache computed billing response for 15 min so subsequent loads skip the DB query.
        redis.set(billingCacheKey, JSON.stringify(response), 'EX', 900)
            .catch((e: any) => console.warn('[Billing] Redis cache write failed:', e?.message));
        return NextResponse.json(response);

    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('Billing API Error:', error);
        return serverError(error, { message: 'ERR_INTERNAL_SERVER', status: 500 });
    }
}

