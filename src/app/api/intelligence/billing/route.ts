import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: 'Faltan credenciales del entorno (headers x-tenant-id y x-subscription-id)' }, { status: 400 });
        }

        // Fetch data from MySQL cost_snapshots instead of Azure Cost Management API
        let rows: any[] = [];
        if (subscriptionId.toLowerCase() === 'all') {
            const [data] = await pool.query(
                `SELECT date, resource_group, service_name, cost_usd, subscription_id
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                 ORDER BY date ASC`,
                [tenantId]
            );
            rows = data as any[];
        } else {
            const [data] = await pool.query(
                `SELECT date, resource_group, service_name, cost_usd, subscription_id
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND subscription_id = ?
                 ORDER BY date ASC`,
                [tenantId, subscriptionId]
            );
            rows = data as any[];
        }

        // Map database records to the FocusCostEntry[] structure expected by frontend
        const mappedData = rows.map((row: any) => {
            let dateStr = '';
            if (row.date) {
                // Keep date as YYYY-MM-DD or convert appropriately
                const d = new Date(row.date);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dateStr = `${y}-${m}-${day}`;
            }

            return {
                BilledCost: Number(row.cost_usd),
                EffectiveCost: Number(row.cost_usd),
                ChargeCategory: 'Usage',
                ProviderName: 'Azure',
                SubAccountId: row.subscription_id,
                ServiceName: row.service_name,
                UsageDate: dateStr
            };
        });

        return NextResponse.json({ success: true, data: mappedData });

    } catch (error: any) {
        console.error('Billing API Cache Read Error:', error);
        return NextResponse.json({ error: 'ERR_INTERNAL_SERVER', details: error.message }, { status: 500 });
    }
}
