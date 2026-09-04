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
import { backfillTenantHistoricalGaps } from '@/lib/historicalGapBackfill';
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

        const jobId = crypto.randomUUID();
        const startedAt = new Date().toISOString();

        // Marca optimista para que la UI y cualquier otra pestaña vean el estado
        // en curso apenas se dispara, sin esperar a que el job termine.
        await pool.query(
            "UPDATE Tenants SET sync_status = 'syncing' WHERE tenant_id = ?",
            [tenantId]
        ).catch(() => { /* el estado visual no debe impedir el sync */ });

        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            if (process.env.NODE_ENV === 'development') {
                // En desarrollo local sin CRON_SECRET, correr backfill directo en background
                void backfillTenantHistoricalGaps(tenantId)
                    .then(async () => {
                        await pool.query("UPDATE Tenants SET sync_status = 'ok', last_sync_at = NOW() WHERE tenant_id = ?", [tenantId]).catch(() => {});
                    })
                    .catch(async (err) => {
                        console.error('[account-status/sync-now dev] error:', errorMessage(err));
                        await pool.query("UPDATE Tenants SET sync_status = 'error', last_error_message = ? WHERE tenant_id = ?", [errorMessage(err), tenantId]).catch(() => {});
                    });

                return NextResponse.json({
                    success: true,
                    jobId,
                    message: 'Sincronización directa en desarrollo iniciada.',
                    startedAt,
                });
            }

            return NextResponse.json(
                { error: 'La sincronización manual no está configurada en este entorno (CRON_SECRET ausente o débil).' },
                { status: 503 }
            );
        }


        // Loopback, NO el dominio publico. `NEXT_PUBLIC_APP_URL` no esta definida
        // en ningun entorno --ni build arg ni variable de runtime-- asi que esto
        // caia siempre en `request.nextUrl.origin`, y el proceso terminaba
        // haciendo un self-fetch contra su propio dominio publico: sale por el
        // proxy a Internet y vuelve a entrar por la misma IP. Es hairpin NAT, no
        // lo soportan todos los proveedores, y falla al instante --de ahi el
        // `fetch failed` crudo de undici que la UI mostraba como
        // "No se pudo iniciar la sincronizacion manual".
        //
        // `/api/cron/sync` corre en ESTE mismo proceso, asi que el salto HTTP no
        // sale a ningun lado: 127.0.0.1 le pega directo al server de Node. Mismo
        // criterio que `admin/load-test/run` (ver el comentario ahi, que explica
        // el hairpin en detalle) y que el healthcheck del docker-compose.
        const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;

        // Fire-and-forget: el sync completo tarda minutos y la UI hace polling
        // del estado. Esperarlo acá agotaría el timeout del request.
        const marcarError = async (detalle: string) => {
            console.error('[account-status/sync-now] el job de sync falló al arrancar:', detalle);
            await pool.query(
                "UPDATE Tenants SET sync_status = 'error', last_error_message = ? WHERE tenant_id = ?",
                [`No se pudo iniciar la sincronización manual: ${detalle}`, tenantId]
            ).catch(() => {});
        };

        void fetch(`${origin}/api/cron/sync?tenantId=${encodeURIComponent(tenantId)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cronSecret}` },
        })
            // Un `.catch` solo no alcanza: `fetch` solo rechaza por fallos de
            // TRANSPORTE. Con un 401 (CRON_SECRET distinto entre los dos lados) o
            // un 503 resuelve normalmente, nadie miraba el status, y el tenant se
            // quedaba en 'syncing' para siempre --peor que el error, porque no
            // hay nada que mirar para saber que no arrancó.
            .then(async (res) => {
                if (!res.ok) await marcarError(`el job respondió ${res.status}`);
            })
            .catch((err) => marcarError(errorMessage(err)));

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
