/**
 * Endpoint de Polling de Estado de Tarea Asíncrona de Reporte Ejecutivo.
 *
 * GET /api/reports/executive/job-status?jobId={id}&tenantId={id}
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import { getExecutiveReportJobStatus } from '@/services/executiveReportJob.service';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const jobId = searchParams.get('jobId');
        const tenantId = searchParams.get('tenantId');

        if (!jobId || !tenantId) {
            return NextResponse.json({ error: 'Falta jobId o tenantId' }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await requireTenantAccess(request, tenantId);
        }

        const status = await getExecutiveReportJobStatus(jobId, tenantId);
        return NextResponse.json(status);
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/executive/job-status] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al consultar estado de tarea' }, { status: 500 });
    }
}
