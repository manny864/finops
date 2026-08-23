/**
 * Endpoint para obtener el último reporte completado en caché / base de datos.
 *
 * GET /api/reports/executive/latest?tenantId={id}
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import { getLatestCompletedReport } from '@/services/executiveReportJob.service';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await requireTenantAccess(request, tenantId);
        }

        const latest = await getLatestCompletedReport(tenantId);
        return NextResponse.json({ success: true, latest });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/executive/latest] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al obtener último reporte' }, { status: 500 });
    }
}
