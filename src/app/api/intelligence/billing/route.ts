import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMonthAmortizedCosts } from '@/services/billingService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        const data = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId);
        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Billing API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
