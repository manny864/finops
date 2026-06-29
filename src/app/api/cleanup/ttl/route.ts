import { NextRequest, NextResponse } from 'next/server';
import { findExpiredResources } from '@/services/ttlService';
import { AuthError, requireRequestIdentity } from '@/lib/requestAuth';

export async function GET(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const tenantId = identity.tenantId;

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
