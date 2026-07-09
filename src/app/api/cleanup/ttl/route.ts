import { NextRequest, NextResponse } from 'next/server';
import { findExpiredResources } from '@/services/ttlService';
import { AuthError, requireRequestIdentity, requireTenantTier } from '@/lib/requestAuth';

export async function GET(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const tenantId = identity.tenantId;
        // Expiraciones TTL es feature Business (ver Sidebar) — antes esta ruta
        // solo validaba identidad, no tier, así que cualquier tenant Essential/
        // Professional podía pegarle directo pese a no tener acceso en la UI.
        await requireTenantTier(request, tenantId, 'Business');

        const expiredResources = await findExpiredResources(tenantId);
        return NextResponse.json({ success: true, data: expiredResources });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('TTL API Error:', error);
        return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
}
