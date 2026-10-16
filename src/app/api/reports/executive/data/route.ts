/**
 * Endpoint de Datos Agregados para el Reporte Ejecutivo FinOps.
 *
 * GET /api/reports/executive/data?tenantId=...&scope=...&scopeId=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { exigirSuscripcionDelTenant } from '@/lib/scopeDelTenant';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { aggregateExecutiveTelemetry } from '@/services/executiveReportGenerator.service';
import type { ExecutiveReportScope } from '@/types/executiveReport.types';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const scope = (request.nextUrl.searchParams.get('scope') || 'TENANT_ALL') as ExecutiveReportScope;
        const scopeId = request.nextUrl.searchParams.get('scopeId') || undefined;

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        // Directiva 24: isMockTenant PRIMERO si devuelve sólo sintéticos
        if (isMockTenant(tenantId)) {
            const mockData = await aggregateExecutiveTelemetry(tenantId, scope, scopeId);
            return NextResponse.json({ success: true, mock: true, data: mockData });
        }

        await initializeDatabase();
        await requireTenantAccess(request, tenantId);
        if (scope !== 'TENANT_ALL') await exigirSuscripcionDelTenant(tenantId, scopeId);

        const liveData = await aggregateExecutiveTelemetry(tenantId, scope, scopeId);
        await requireTenantAccess(request, tenantId);
        if (scope !== 'TENANT_ALL') await exigirSuscripcionDelTenant(tenantId, scopeId);
        return NextResponse.json({ success: true, data: liveData });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/executive/data] GET error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
