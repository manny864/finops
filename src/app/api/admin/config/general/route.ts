/**
 * Configuración Global — pestaña General.
 *
 * GET  ?tenantId=  → tema + marca + estado de integraciones (sin secretos).
 * PUT                → guarda tema y/o configuración ITSM.
 *
 * RBAC:
 *   - GET: `requireTenantAccess` (cualquier miembro del tenant ve su config).
 *   - PUT: `requireTenantRole(['Admin','Owner'])` — cambia integraciones y credenciales.
 *
 * Directiva 24: el check `isMockTenant` va ANTES del guard y de la DB porque la
 * rama mock devuelve exclusivamente literales sintéticos (getMockDataForRoute),
 * sin tocar MySQL, Azure ni Redis.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant, getMockDataForRoute } from '@/lib/mockData';
import {
    getTenantConfiguration,
    saveItsmConfiguration,
    saveThemePreference,
} from '@/services/tenantConfiguration.service';
import { isItsmSystem } from '@/types/tenantConfiguration.types';
import { assertPublicHttpsUrl } from '@/lib/webhookSecurity';

function originOf(request: NextRequest): string {
    return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (isMockTenant(tenantId)) {
            const payload = getMockDataForRoute('tenant_config', tenantId);
            return NextResponse.json({
                success: true,
                mock: true,
                config: { ...payload, tenantId, integrations: { ...payload.integrations, powerBiExportUrl: `${originOf(request)}/api/exports/powerbi-feed?dataset=costs&days=90` } },
            });
        }

        await initializeDatabase();
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const config = await getTenantConfiguration(tenantId, originOf(request));
        if (!config) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

        return NextResponse.json({ success: true, config });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error('[/api/admin/config/general] GET error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, theme, itsm } = body as {
            tenantId?: string;
            theme?: string;
            itsm?: { system?: string; baseUrl?: string; apiKey?: string; userEmail?: string; projectKey?: string };
        };

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (isMockTenant(tenantId)) {
            // El tenant demo no persiste nada: confirmar sin escribir mantiene la
            // demo navegable sin inventar un estado que después no se relee.
            return NextResponse.json({ success: true, mock: true });
        }

        await initializeDatabase();
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        if (theme !== undefined) {
            await saveThemePreference(tenantId, String(theme));
        }

        if (itsm !== undefined) {
            if (!isItsmSystem(itsm.system)) {
                return NextResponse.json(
                    { error: 'Sistema ITSM inválido. Valores: JIRA, AZURE_DEVOPS, SERVICENOW, NONE.' },
                    { status: 400 }
                );
            }
            if (itsm.system !== 'NONE') {
                if (!itsm.baseUrl?.trim()) {
                    return NextResponse.json({ error: 'La URL base del sistema ITSM es obligatoria.' }, { status: 400 });
                }
                // SSRF: la URL la elige un admin del tenant, pero el request lo hace
                // nuestro servidor. Sin esto, apuntarla a 169.254.169.254 convertiría
                // la prueba de conexión en una lectura del metadata endpoint de Azure.
                try {
                    await assertPublicHttpsUrl(itsm.baseUrl.trim(), 'La URL base de ITSM');
                } catch (urlErr) {
                    return NextResponse.json({ error: errorMessage(urlErr) }, { status: 400 });
                }
            }
            await saveItsmConfiguration(tenantId, {
                system: itsm.system,
                baseUrl: itsm.baseUrl || '',
                apiKey: itsm.apiKey,
                userEmail: itsm.userEmail,
                projectKey: itsm.projectKey,
            });
        }

        const config = await getTenantConfiguration(tenantId, originOf(request));
        return NextResponse.json({ success: true, config });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error('[/api/admin/config/general] PUT error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
