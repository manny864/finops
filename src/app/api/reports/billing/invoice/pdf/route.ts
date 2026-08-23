/**
 * Endpoint de Generación de Factura / Estado de Cuenta Individual en PDF (A4).
 *
 * GET /api/reports/billing/invoice/pdf?tenantId=...&period=...&customerId=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { getBillingReportData, generateCustomerInvoicePdf } from '@/services/billingReport.service';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const period = searchParams.get('period') || 'last30d';
        const customerId = searchParams.get('customerId');

        if (!tenantId || !customerId) {
            return NextResponse.json({ error: 'Falta tenantId o customerId' }, { status: 400 });
        }

        let tenantName = 'CSCloudSolutions';
        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
            const [tRows] = await pool.query<any[]>('SELECT name FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
            tenantName = tRows[0]?.name || tenantId;
        }

        const reportData = await getBillingReportData(tenantId, period);
        const pdfBuffer = await generateCustomerInvoicePdf(reportData, customerId, tenantName);

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Factura-${customerId}-${period}.pdf"`,
            },
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/billing/invoice/pdf] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al generar factura PDF' }, { status: 500 });
    }
}
