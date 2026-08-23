/**
 * Endpoint de Compilación y Descarga de PDF para Reporte Ejecutivo FinOps (A4 Paged Media).
 *
 * POST /api/reports/executive/export-pdf
 * Body: { tenantId, scope, scopeId, reportMarkdown, format?: 'pdf' | 'html' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import {
    aggregateExecutiveTelemetry,
    buildExecutiveReportHtmlDocument,
} from '@/services/executiveReportGenerator.service';
import { compileExecutiveReportPdfBuffer } from '@/services/pdfCompiler.service';
import type { ExecutiveReportScope } from '@/types/executiveReport.types';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const {
            tenantId,
            scope = 'TENANT_ALL',
            scopeId,
            reportMarkdown = '',
            format = 'pdf',
        } = body as {
            tenantId?: string;
            scope?: ExecutiveReportScope;
            scopeId?: string;
            reportMarkdown?: string;
            format?: 'pdf' | 'html';
        };

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
        }

        const data = await aggregateExecutiveTelemetry(tenantId, scope, scopeId);

        if (format === 'html') {
            const htmlDoc = buildExecutiveReportHtmlDocument(data, reportMarkdown);
            return new NextResponse(htmlDoc, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Disposition': `attachment; filename="Reporte-Ejecutivo-FinOps-${tenantId}.html"`,
                },
            });
        }

        // Formato PDF A4
        const pdfBuffer = await compileExecutiveReportPdfBuffer(data, reportMarkdown);
        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Reporte-Ejecutivo-FinOps-${tenantId}.pdf"`,
            },
        });

    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/executive/export-pdf] POST error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al compilar documento' }, { status: 500 });
    }
}
