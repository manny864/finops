import { NextRequest, NextResponse } from 'next/server';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { getCurrentMonthAmortizedCosts } from '@/modules/collectors/azure/billingService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json(
                { error: 'Faltan credenciales del entorno (headers x-tenant-id y x-subscription-id)' },
                { status: 400 }
            );
        }

        // Ensure DB schema exists before querying
        await initializeDatabase();

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
        if (rows.length === 0) {
            console.log('[Billing] No cached data, querying Azure Cost Management live...');
            try {
                const focusData = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId);
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

        return NextResponse.json({ success: true, data: mappedData });

    } catch (error: any) {
        console.error('Billing API Error:', error);
        return NextResponse.json(
            { error: 'ERR_INTERNAL_SERVER', details: error.message },
            { status: 500 }
        );
    }
}

