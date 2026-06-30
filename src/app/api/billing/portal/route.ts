import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Fetch subscription ID
        const [tenantRows] = await pool.query('SELECT paddle_subscription_id, tier, subscription_status FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
        const tenant = (tenantRows as any[])[0];

        if (!tenant) {
            return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
        }

        if (tenant.tier === 'Enterprise') {
            return NextResponse.json({ isEnterprise: true });
        }

        if (!tenant.paddle_subscription_id) {
            return NextResponse.json({ error: 'No hay suscripción activa configurada para este entorno.' }, { status: 404 });
        }

        // Fetch from Paddle API
        const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
        const PADDLE_ENV = process.env.PADDLE_ENV === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

        const paddleRes = await fetch(`${PADDLE_ENV}/subscriptions/${tenant.paddle_subscription_id}`, {
            headers: {
                'Authorization': `Bearer ${PADDLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!paddleRes.ok) {
            console.error('Paddle API Error:', await paddleRes.text());
            return NextResponse.json({ error: 'Error de comunicación con Paddle.' }, { status: 502 });
        }

        const paddleData = await paddleRes.json();
        
        return NextResponse.json({ 
            success: true, 
            managementUrls: paddleData.data?.management_urls || null,
            status: paddleData.data?.status,
            tier: tenant.tier
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API GET /billing/portal error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
