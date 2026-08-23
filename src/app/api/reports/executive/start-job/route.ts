/**
 * Endpoint para Iniciar Tarea Asíncrona de Reporte Ejecutivo FinOps.
 *
 * POST /api/reports/executive/start-job
 * Body: { tenantId, scope, scopeId, scopeName, locale, triggerAiAnalysis, sendEmailNotification }
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import { startExecutiveReportJob } from '@/services/executiveReportJob.service';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const {
            tenantId,
            scope = 'TENANT_ALL',
            scopeId = 'All',
            scopeName = 'Tenant completo (todas las suscripciones)',
            locale = 'es',
            triggerAiAnalysis = true,
            sendEmailNotification = false,
        } = body as {
            tenantId?: string;
            scope?: 'TENANT_ALL' | 'SUBSCRIPTION' | 'RESOURCE_GROUP';
            scopeId?: string;
            scopeName?: string;
            locale?: string;
            triggerAiAnalysis?: boolean;
            sendEmailNotification?: boolean;
        };

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        let requesterEmail = 'demo@cscloudsolutions.com.ar';

        if (!isMockTenant(tenantId)) {
            const identity = await requireTenantAccess(request, tenantId);
            requesterEmail = identity.email || 'user@cscloudsolutions.com';
        }

        const res = await startExecutiveReportJob({
            tenantId,
            scope,
            scopeId,
            scopeName,
            locale,
            triggerAiAnalysis,
            sendEmailNotification,
            requestedByEmail: requesterEmail,
        });

        return NextResponse.json(res);
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/executive/start-job] POST error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al iniciar tarea' }, { status: 500 });
    }
}
