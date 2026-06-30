import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifySubscription } from '@/lib/apiSecurity';
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, aiProvider, aiApiKey } = body;

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        const isAuthorized = await verifySubscription(tenantId);
        if (!isAuthorized) {
            return NextResponse.json({ error: 'Forbidden: Active subscription required' }, { status: 403 });
        }

        await pool.query(
            'UPDATE Tenants SET ai_provider = ?, ai_api_key = ? WHERE tenant_id = ?',
            [aiProvider || 'system', aiApiKey || null, tenantId]
        );

        return NextResponse.json({ success: true, message: 'Configuración guardada exitosamente.' });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API PATCH /admin/config/ai error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
