/**
 * Endpoint de Despacho de Correo para Reporte Ejecutivo FinOps.
 *
 * POST /api/reports/executive/send-email
 * Body: { tenantId, recipientEmail, reportMarkdown, scope?, scopeId?, introMessage? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import {
    aggregateExecutiveTelemetry,
    dispatchExecutiveReportEmail,
} from '@/services/executiveReportGenerator.service';
import { compileExecutiveReportPdfBuffer } from '@/services/pdfCompiler.service';
import type { ExecutiveReportScope } from '@/types/executiveReport.types';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const {
            tenantId,
            recipientEmail,
            reportMarkdown = '',
            scope = 'TENANT_ALL',
            scopeId = 'All',
            introMessage,
        } = body as {
            tenantId?: string;
            recipientEmail?: string;
            reportMarkdown?: string;
            scope?: ExecutiveReportScope;
            scopeId?: string;
            introMessage?: string;
        };

        if (!tenantId || !recipientEmail) {
            return NextResponse.json({ error: 'Falta tenantId o recipientEmail' }, { status: 400 });
        }

        let tenantName = 'Organización';
        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
            const [tRows] = await pool.query<any[]>('SELECT name FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
            tenantName = tRows[0]?.name || tenantId;
        }

        const data = await aggregateExecutiveTelemetry(tenantId, scope, scopeId);
        const pdfBuffer = await compileExecutiveReportPdfBuffer(data, reportMarkdown);
        const pdfBase64 = pdfBuffer.toString('base64');
        const fileBaseName = `Reporte-Ejecutivo-FinOps-${tenantId}`;

        await dispatchExecutiveReportEmail({
            tenantName,
            recipientEmail,
            reportMarkdown,
            pdfBufferBase64: pdfBase64,
            fileBaseName,
            scopeDisplayName: data.scopeDisplayName,
            introMessage,
            kpiSnapshot: data.kpiMetrics,
        });

        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/executive/send-email] POST error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al despachar el correo' }, { status: 500 });
    }
}
