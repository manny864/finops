/**
 * Da de baja el registro de una delegación de Azure Lighthouse.
 *
 * QUE BORRA Y QUE NO
 * Borra NUESTRA fila de `TenantDelegations`. NO revoca la delegación en Azure:
 * el `registrationAssignment` vive en la suscripción del cliente y sólo se
 * quita desde su directorio, o desde el nuestro si la delegación incluyera el
 * rol "Managed Services Registration Assignment Delete Role" --que la plantilla
 * no pide--.
 *
 * Por eso la respuesta distingue los dos casos. Borrar una delegación que sigue
 * viva en Azure deja al cliente delegando acceso que nosotros creemos no tener:
 * no es peligroso, pero es una discrepancia que alguien tiene que resolver, y
 * callarla seria repetir el patron que veniamos arreglando toda la noche.
 *
 * RBAC: Owner. Afecta como accede la plataforma al tenant, no es una accion de
 * Admin operativo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        if (!/^\d+$/.test(id)) {
            // Las filas que vienen de Resource Graph traen el assignmentId de ARM
            // como id, no un entero: esas no se pueden borrar de acá porque no
            // son nuestras, son lo que Azure reporta.
            return NextResponse.json({
                error: 'Esa delegación la reporta Azure, no es un registro nuestro. Se quita desde el directorio del cliente.',
            }, { status: 400 });
        }

        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true, id });

        await initializeDatabase();
        await requireTenantRole(request, tenantId, ['Owner']);

        const [filas]: any = await pool.query(
            'SELECT status, managed_subscription_id FROM TenantDelegations WHERE id = ? AND tenant_id = ? LIMIT 1',
            [id, tenantId],
        );
        if (!filas?.length) return NextResponse.json({ error: 'No existe esa delegación' }, { status: 404 });
        const estabaActiva = String(filas[0].status || '').toLowerCase() === 'active';

        await pool.query('DELETE FROM TenantDelegations WHERE id = ? AND tenant_id = ?', [id, tenantId]);

        // Un tenant en modo lighthouse sin ninguna delegación se queda sin forma
        // de llegar a Azure: la credencial apunta a nuestro directorio y ya no
        // hay suscripciones delegadas detrás. Vuelve al modelo de app
        // registration, que es lo que habia antes de la delegacion.
        const [quedan]: any = await pool.query(
            'SELECT COUNT(*) AS n FROM TenantDelegations WHERE tenant_id = ?',
            [tenantId],
        );
        let modeloRevertido = false;
        if (Number(quedan?.[0]?.n || 0) === 0) {
            const [r]: any = await pool.query(
                "UPDATE Tenants SET access_model = 'app_registration' WHERE tenant_id = ? AND access_model = 'lighthouse'",
                [tenantId],
            );
            modeloRevertido = Number(r?.affectedRows || 0) > 0;
        }

        return NextResponse.json({
            success: true,
            id,
            modeloRevertido,
            seguiaActivaEnAzure: estabaActiva,
            subscriptionId: filas[0].managed_subscription_id || null,
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/onboard/lighthouse/[id]] DELETE:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
