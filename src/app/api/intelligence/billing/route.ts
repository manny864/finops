import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMonthAmortizedCosts } from '@/modules/collectors/azure/billingService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');
        const metricType = (request.headers.get('x-metric-type') as 'ActualCost' | 'AmortizedCost') || 'ActualCost';

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        const data = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, metricType);
        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Billing API Error:', error);
        let errorCode = 'ERR_INTERNAL_SERVER';
        const msg = (error.message || '').toLowerCase();
        if (error.code === 'AuthorizationFailed' || error.statusCode === 403 || msg.includes('authorization')) {
            errorCode = 'ERR_INSUFFICIENT_PERMISSIONS';
        } else if (error.statusCode === 429 || msg.includes('too many requests') || msg.includes('throttl')) {
            errorCode = 'ERR_COST_API_THROTTLED';
        }
        return NextResponse.json({ error: errorCode }, { status: error.statusCode || 500 });
    }
}
