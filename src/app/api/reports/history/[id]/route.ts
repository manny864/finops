/**
 * Endpoint de Detalle y Eliminación de Reporte Histórico Individual.
 *
 * GET /api/reports/history/[id]?tenantId=...
 * DELETE /api/reports/history/[id]?tenantId=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import {
    rehydrateReportData,
    deleteReportFromHistory,
} from '@/services/executiveReportHistory.service';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
        }

        const data = await rehydrateReportData(tenantId, id);
        return NextResponse.json({ success: true, ...data });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/history/[id]] GET error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al obtener reporte' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (!isMockTenant(tenantId)) {
            await initializeDatabase();
            await requireTenantAccess(request, tenantId);
        }

        const deleted = await deleteReportFromHistory(tenantId, id);
        if (!deleted) {
            return NextResponse.json({ error: 'Reporte no encontrado' }, { status: 404 });
        }

        return NextResponse.json({ success: true, deletedId: id });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/history/[id]] DELETE error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al eliminar reporte' }, { status: 500 });
    }
}
