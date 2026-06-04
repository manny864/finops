import { NextRequest, NextResponse } from 'next/server';
import { findExpiredResources } from '@/services/ttlService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenant-id en headers' }, { status: 400 });
        }

        const expiredResources = await findExpiredResources(tenantId);
        return NextResponse.json({ success: true, data: expiredResources });
    } catch (error: any) {
        console.error('TTL API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
