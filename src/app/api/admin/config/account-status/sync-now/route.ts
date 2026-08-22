/**
 * Disparo manual de la sincronización de telemetría desde la UI.
 *
 * El sync real vive en /api/cron/sync, que autentica con `Bearer $CRON_SECRET`
 * y por eso no es alcanzable desde el navegador. Esta ruta es el proxy con
 * sesión: valida RBAC de tenant y recién ahí invoca el job con el secreto
 * server-side, que nunca sale del servidor.
 *
 * RBAC: `requireTenantRole(['Admin','Owner'])`. Un sync consume cuota de las
 * APIs de Azure del cliente, así que no es una lectura que cualquier miembro
 * del tenant deba poder disparar a repetición.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import pool from '@/modules/storage/db';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId } = body as { tenantId?: string };
        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                mock: true,
                jobId: 'demo-sync-job',
                message: 'Sincronización simulada en el tenant de demostración.',
                startedAt: new Date().toISOString(),
            });
        }

        await initializeDatabase();
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        const cronSecret = process.env.CRON_SECRET;
        // Fail-closed, igual que el propio /api/cron/sync: sin un secreto fuerte
        // no se dispara nada en vez de intentarlo y quedar a medias.
        if (!cronSecret || cronSecret.length < 16) {
            return NextResponse.json(
                { error: 'La sincronización manual no está configurada en este entorno (CRON_SECRET ausente o débil).' },
                { status: 503 }
            );
        }

        const jobId = crypto.randomUUID();
        const startedAt = new Date().toISOString();

        // Marca optimista para que la UI y cualquier otra pestaña vean el estado
        // en curso apenas se dispara, sin esperar a que el job termine.
        await pool.query(
            "UPDATE Tenants SET sync_status = 'syncing' WHERE tenant_id = ?",
            [tenantId]
        ).catch(() => { /* el estado visual no debe impedir el sync */ });

        const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

        // Fire-and-forget: el sync completo tarda minutos y la UI hace polling
        // del estado. Esperarlo acá agotaría el timeout del request.
        void fetch(`${origin}/api/cron/sync?tenantId=${encodeURIComponent(tenantId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cronSecret}` },
        }).catch(async (err) => {
            console.error('[account-status/sync-now] el job de sync falló al arrancar:', errorMessage(err));
            await pool.query(
                "UPDATE Tenants SET sync_status = 'error', last_error_message = ? WHERE tenant_id = ?",
                [`No se pudo iniciar la sincronización manual: ${errorMessage(err)}`, tenantId]
            ).catch(() => {});
        });

        return NextResponse.json({
            success: true,
            jobId,
            message: 'Sincronización iniciada. El estado se actualiza al terminar.',
            startedAt,
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/account-status/sync-now] error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
