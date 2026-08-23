/**
 * Endpoint de Generación del Conector Power BI Data Source (.pbids).
 *
 * GET /api/reports/billing/export/pbids?tenantId=...&period=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import { generatePbidsConnector } from '@/services/billingReport.service';

export async function GET(request: NextRequest) {
    try {
        const { searchParams, origin } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const period = searchParams.get('period') || 'last30d';

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await requireTenantAccess(request, tenantId);
        }

        const pbidsContent = generatePbidsConnector(tenantId, period, origin);

        return new NextResponse(pbidsContent, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="invoicing-${tenantId}-${period}.pbids"`,
            },
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/billing/export/pbids] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al generar conector PBIDS' }, { status: 500 });
    }
}
