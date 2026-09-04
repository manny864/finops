/**
 * Verifica contra Azure si la delegación de Lighthouse de un tenant está viva.
 *
 * Es la contraparte de la ruta que EMITE la plantilla. Esa deja una fila en
 * `TenantDelegations` con status 'pending' que nadie actualizaba nunca, así que
 * el panel mostraba "delegación registrada" tanto si el cliente la había
 * desplegado como si el JSON seguía en su bandeja de entrada.
 *
 * Confirmada la delegación, el tenant pasa a `access_model = 'lighthouse'` y a
 * partir de ahí las consultas se autentican contra NUESTRO directorio. Ver
 * `verificarDelegacion`.
 *
 * RBAC: Admin/Owner del tenant. No cambia nada en Azure --sólo lee Resource
 * Graph-- pero sí decide cómo se autentica el tenant de ahí en más.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { verificarDelegacion } from '@/services/lighthouseVerification.service';
import { tierPuedeUsarLighthouse, LIGHTHOUSE_TIER_ERROR, LIGHTHOUSE_ERRORS } from '@/lib/lighthouseTier';

export async function POST(request: NextRequest) {
    try {
        const tenantId = new URL(request.url).searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true, mock: true, activa: true,
                suscripciones: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
                roles: ['Reader', 'Cost Management Reader'],
            });
        }

        await initializeDatabase();
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Mismo gate que la ruta que emite la plantilla: verificar es lo que
        // enciende `access_model = 'lighthouse'`, asi que sin este chequeo un
        // tenant de otro tier podria quedar en un modo de acceso que su plan no
        // incluye.
        const [tierRows]: any = await pool.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId],
        );
        if (!tierPuedeUsarLighthouse(tierRows?.[0]?.tier)) {
            return NextResponse.json({ error: LIGHTHOUSE_TIER_ERROR, errorCode: LIGHTHOUSE_ERRORS.TIER }, { status: 403 });
        }

        const resultado = await verificarDelegacion(tenantId);
        return NextResponse.json({ success: true, ...resultado });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/onboard/lighthouse/verify] error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
