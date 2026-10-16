/**
 * Endpoint de Despacho de Correo para Reporte Ejecutivo FinOps.
 *
 * POST /api/reports/executive/send-email
 * Body: { tenantId, recipientEmail, reportMarkdown, scope?, scopeId?, introMessage? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { exigirSuscripcionDelTenant } from '@/lib/scopeDelTenant';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import {
    aggregateExecutiveTelemetry,
    dispatchExecutiveReportEmail,
} from '@/services/executiveReportGenerator.service';
import { compileExecutiveReportPdfBuffer } from '@/services/pdfCompiler.service';
import type { ExecutiveReportScope } from '@/types/executiveReport.types';
import type { RowDataPacket } from 'mysql2';

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
            // Fuera de TENANT_ALL el scopeId llega como suscripción a Azure.
            if (scope !== 'TENANT_ALL') await exigirSuscripcionDelTenant(tenantId, scopeId);
            const [tRows] = await pool.query<RowDataPacket[]>('SELECT company_name FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
            tenantName = tRows[0]?.company_name || tenantId;
        }

        const data = await aggregateExecutiveTelemetry(tenantId, scope, scopeId);
        const pdfBuffer = await compileExecutiveReportPdfBuffer(data, reportMarkdown);
        const pdfBase64 = pdfBuffer.toString('base64');
        // AISEC-05: el adjunto no lleva el tenantId (se reenvía fuera de la plataforma).
        const fileBaseName = `Reporte-Ejecutivo-FinOps-${new Date().toISOString().slice(0, 10)}`;

        if (!isMockTenant(tenantId)) {
            await requireTenantAccess(request, tenantId);
            if (scope !== 'TENANT_ALL') await exigirSuscripcionDelTenant(tenantId, scopeId);
        }
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
