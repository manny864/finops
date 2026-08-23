/**
 * Endpoint para recuperar tareas activas en curso por tenant.
 *
 * GET /api/reports/executive/active-job?tenantId={id}
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import { getActiveExecutiveReportJob } from '@/services/executiveReportJob.service';

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

        const activeJob = await getActiveExecutiveReportJob(tenantId);
        return NextResponse.json({ success: true, activeJob });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/executive/active-job] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al obtener tarea activa' }, { status: 500 });
    }
}
