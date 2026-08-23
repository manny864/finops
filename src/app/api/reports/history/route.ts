/**
 * Endpoint de Consulta de Historial de Reportes Ejecutivos FinOps.
 *
 * GET /api/reports/history?tenantId=...&page=...&pageSize=...&search=...&scopeFilter=...&emailFilter=...&sortBy=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { getExecutiveReportHistory } from '@/services/executiveReportHistory.service';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const page = Math.max(1, Number(searchParams.get('page')) || 1);
        const pageSize = [15, 30, 45, 60].includes(Number(searchParams.get('pageSize')))
            ? Number(searchParams.get('pageSize'))
            : 15;
        const search = searchParams.get('search') || '';
        const scopeFilter = searchParams.get('scopeFilter') || 'ALL';
        const emailFilter = searchParams.get('emailFilter') || 'ALL';
        const sortBy = (searchParams.get('sortBy') || 'date') as 'date' | 'cost' | 'savings';

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        // Directiva 24: isMockTenant evaluado primero si no toca datos reales
        if (isMockTenant(tenantId)) {
            const mockData = await getExecutiveReportHistory({
                tenantId,
                page,
                pageSize,
                search,
                scopeFilter,
                emailFilter,
                sortBy,
            });
            return NextResponse.json({ success: true, mock: true, ...mockData });
        }

        await initializeDatabase();
        await requireTenantAccess(request, tenantId);

        const liveData = await getExecutiveReportHistory({
            tenantId,
            page,
            pageSize,
            search,
            scopeFilter,
            emailFilter,
            sortBy,
        });

        return NextResponse.json({ success: true, ...liveData });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/history] GET error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
