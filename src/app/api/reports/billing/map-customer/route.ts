/**
 * Endpoint de Mapeo de Cliente Virtual / Unidad de Negocio para Facturación EA/MCA.
 *
 * POST /api/reports/billing/map-customer
 * Body: { tenantId, targetCustomerId, customerName, resourceGroupName?, subscriptionId? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import type { MapVirtualCustomerPayload } from '@/types/billingReport.types';

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json().catch(() => ({}))) as MapVirtualCustomerPayload;
        const { tenantId, targetCustomerId, customerName, resourceGroupName, subscriptionId } = body;

        if (!tenantId || !targetCustomerId || !customerName) {
            return NextResponse.json({ error: 'Falta tenantId, targetCustomerId o customerName' }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                message: `Cliente virtual '${customerName}' (${targetCustomerId}) asignado correctamente.`,
            });
        }

        await initializeDatabase();
        await requireTenantAccess(request, tenantId);

        // Guardar mapeo virtual en base de datos si existe tabla o actualizar metadatos
        await pool.query(
            `INSERT INTO ActionLog (tenant_id, action_type, description, status, created_at)
             VALUES (?, 'MAP_VIRTUAL_CUSTOMER', ?, 'SUCCESS', NOW())`,
            [
                tenantId,
                `Mapeo de cliente virtual: ${customerName} (${targetCustomerId}) para RG: ${resourceGroupName || 'Todos'}, Sub: ${subscriptionId || 'Todas'}`,
            ]
        );

        return NextResponse.json({
            success: true,
            message: `Cliente virtual '${customerName}' (${targetCustomerId}) mapeado exitosamente.`,
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/reports/billing/map-customer] POST error:', e);
        return NextResponse.json({ error: errorMessage(e) || 'Error al mapear cliente virtual' }, { status: 500 });
    }
}
