/**
 * Endpoint de Generación de SAS Token para Descarga de Reportes.
 *
 * POST /api/reports/history/download { tenantId, reportId, fileType }
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { generateDownloadSas } from '@/services/executiveReportHistory.service';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, reportId, fileType = 'pdf' } = body as {
            tenantId?: string;
            reportId?: string;
            fileType?: 'pdf' | 'json';
        };

        if (!tenantId || !reportId) {
            return NextResponse.json({ error: 'Falta tenantId o reportId' }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
        }

        const res = await generateDownloadSas({ tenantId, reportId, fileType });
        return NextResponse.json({ success: true, ...res });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/history/download] POST error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al generar enlace de descarga' }, { status: 500 });
    }
}
