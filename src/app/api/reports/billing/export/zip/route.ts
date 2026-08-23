/**
 * Endpoint de Exportación Completa en Archivo ZIP (CSVs, JSON, PBIDS).
 *
 * GET /api/reports/billing/export/zip?tenantId=...&period=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { getBillingReportData, generateBillingZipPackage } from '@/services/billingReport.service';

export async function GET(request: NextRequest) {
    try {
        const { searchParams, origin } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const period = searchParams.get('period') || 'last30d';

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
        }

        const reportData = await getBillingReportData(tenantId, period);
        const zipBuffer = await generateBillingZipPackage(reportData, tenantId, period, origin);

        return new NextResponse(new Uint8Array(zipBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="Facturacion-FinOps-${tenantId}-${period}.zip"`,
            },
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/billing/export/zip] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al generar paquete ZIP' }, { status: 500 });
    }
}
