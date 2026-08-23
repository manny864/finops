/**
 * Endpoint Principal de Consulta de Reporte de Facturación Cloud con Markup.
 *
 * GET /api/reports/billing?tenantId=...&period=...&subscriptionId=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { getBillingReportData } from '@/services/billingReport.service';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const period = searchParams.get('period') || 'last3m';
        const subscriptionId = searchParams.get('subscriptionId') || undefined;

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
        }

        const data = await getBillingReportData(tenantId, period, subscriptionId);
        return NextResponse.json(data);
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/billing] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al obtener facturación' }, { status: 500 });
    }
}
