/**
 * Endpoint de Descarga Segura / Generación de SAS Token para Reporte Histórico.
 *
 * GET /api/reports/history/[id]/download?tenantId=...&fileType=pdf|json
 * POST /api/reports/history/download { tenantId, reportId, fileType }
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import {
    rehydrateReportData,
    generateDownloadSas,
} from '@/services/executiveReportHistory.service';
import { jsPDF } from 'jspdf';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const fileType = (searchParams.get('fileType') || 'pdf').toLowerCase();

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
        }

        const data = await rehydrateReportData(tenantId, id);

        if (fileType === 'json') {
            return new NextResponse(JSON.stringify(data, null, 2), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Disposition': `attachment; filename="Reporte-FinOps-${tenantId}-${id}.json"`,
                },
            });
        }

        // PDF Generation
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(0, 84, 166);
        doc.text('CSCloudSolutions - Reporte Ejecutivo FinOps (Snapshot)', 20, 20);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(70, 70, 70);
        doc.text(`Tenant: ${tenantId}`, 20, 28);
        doc.text(`Snapshot ID: ${id} | Generado: ${new Date(data.metadata.createdAt).toLocaleString('es-AR')}`, 20, 34);

        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        const cleanBody = (data.report || '').replace(/[#*`_]/g, '');
        const lines = doc.splitTextToSize(cleanBody, 170);
        let y = 44;
        for (const line of lines) {
            if (y > 275) {
                doc.addPage('a4', 'portrait');
                y = 20;
            }
            doc.text(line, 20, y);
            y += 6;
        }

        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Reporte-FinOps-${tenantId}-${id}.pdf"`,
            },
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/history/[id]/download] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al descargar reporte' }, { status: 500 });
    }
}
