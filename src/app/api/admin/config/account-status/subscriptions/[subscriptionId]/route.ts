/**
 * MEJ-25 — Desvincular / revincular una suscripción Azure del tenant.
 *
 * DELETE: la excluye. POST: la vuelve a vincular.
 *
 * No borra nada: la lista de suscripciones se descubre en cada sync
 * (`getAllSubscriptionsForTenant`), así que un DELETE real reaparecería en el
 * siguiente ciclo. Lo que se persiste es una EXCLUSIÓN, que ese mismo
 * descubrimiento respeta. El histórico de CostSnapshots se conserva: el gasto
 * de meses cerrados es información contable.
 *
 * RBAC: `requireTenantRole(['Owner'])` (SuperAdmin incluido por el helper).
 * Afecta los totales de todos los cockpits del tenant, no es una acción de
 * Admin operativo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { invalidateCache, invalidateCachePattern, costGroupsCacheKeys } from '@/lib/cache';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Todo lo cacheado para el tenant, no sólo los totales de costo.
 *
 * Antes se invalidaban tres claves puntuales de costo. Pero desvincular una
 * suscripción cambia CUALQUIER payload cacheado que la mencione, y varios
 * cachean por 15 minutos: el inventario de cómputo
 * (`compute:workloads:vN:{tenant}:*`) seguía listando las VMs de la suscripción
 * dada de baja mucho después de la acción, y el usuario lo veía como que el
 * borrado no había funcionado.
 *
 * Se barre por patrón sobre el tenant en vez de enumerar prefijos: la lista de
 * cachés crece con cada módulo nuevo, y enumerarlos deja el mismo agujero
 * abierto para el siguiente. Recalcular de más en una acción administrativa que
 * ocurre pocas veces es más barato que mostrar datos de una suscripción que el
 * cliente ya dio de baja.
 *
 * Las claves del proyecto llevan el tenant como segmento (`prefijo:vN:tenant:…`),
 * así que este patrón las alcanza a todas.
 */
async function invalidateTenantCostCaches(tenantId: string): Promise<void> {
    await Promise.all([
        invalidateCachePattern(`*:${tenantId}:*`),
        invalidateCachePattern(`*:${tenantId}`),
        invalidateCache(...costGroupsCacheKeys(tenantId)),
    ]);
}

async function audit(
    tenantId: string,
    request: NextRequest,
    email: string,
    action: 'UNLINK_SUBSCRIPTION' | 'RELINK_SUBSCRIPTION',
    subscriptionId: string,
    reason: string | null,
): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO AuditTrailLogs
                (tenant_id, user_email, user_name, ip_address, user_agent, action_type, resource_target_id, resource_target_name, status, metadata_json, created_at)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'SUCCESS', ?, NOW())`,
            [
                tenantId,
                email,
                request.headers.get('x-forwarded-for') || '',
                (request.headers.get('user-agent') || '').slice(0, 500),
                action,
                `/subscriptions/${subscriptionId}`,
                subscriptionId,
                JSON.stringify({ subscriptionId, reason, historicalDataKept: true }),
            ],
        );
    } catch (err) {
        // La auditoría no debe tumbar una acción ya aplicada, pero sí dejar rastro.
        console.warn('[account-status/subscriptions] audit log falló:', errorMessage(err));
    }
}

async function resolve(request: NextRequest, params: Promise<{ subscriptionId: string }>) {
    const { subscriptionId } = await params;
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) throw new AuthError('Falta tenantId', 400);
    if (!GUID.test(subscriptionId)) throw new AuthError('subscriptionId inválido', 400);
    return { tenantId, subscriptionId: subscriptionId.toLowerCase() };
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ subscriptionId: string }> }) {
    try {
        const { tenantId, subscriptionId } = await resolve(request, params);
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, subscriptionId, message: 'Desvinculación simulada en el tenant de demostración.' });
        }

        await initializeDatabase();
        const identity = await requireTenantRole(request, tenantId, ['Owner']);

        const reason = ((await request.json().catch(() => ({}))) as { reason?: string })?.reason?.slice(0, 500) || null;

        await pool.query(
            `INSERT INTO TenantExcludedSubscriptions (tenant_id, subscription_id, excluded_by_email, reason)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE excluded_at = NOW(), excluded_by_email = VALUES(excluded_by_email), reason = VALUES(reason)`,
            [tenantId, subscriptionId, identity.email || 'desconocido', reason],
        );

        await invalidateTenantCostCaches(tenantId);
        await audit(tenantId, request, identity.email, 'UNLINK_SUBSCRIPTION', subscriptionId, reason);

        return NextResponse.json({ success: true, subscriptionId, historicalDataKept: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/account-status/subscriptions] DELETE:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ subscriptionId: string }> }) {
    try {
        const { tenantId, subscriptionId } = await resolve(request, params);
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, subscriptionId });
        }

        await initializeDatabase();
        const identity = await requireTenantRole(request, tenantId, ['Owner']);

        await pool.query(
            `DELETE FROM TenantExcludedSubscriptions WHERE tenant_id = ? AND subscription_id = ?`,
            [tenantId, subscriptionId],
        );

        await invalidateTenantCostCaches(tenantId);
        await audit(tenantId, request, identity.email, 'RELINK_SUBSCRIPTION', subscriptionId, null);

        return NextResponse.json({ success: true, subscriptionId });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/account-status/subscriptions] POST:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
