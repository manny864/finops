/**
 * Prueba de conectividad y credenciales contra el sistema ITSM del tenant.
 *
 * Consulta el endpoint de identidad de cada sistema (Jira `/rest/api/3/myself`,
 * Azure DevOps `_apis/connectionData`, ServiceNow `/api/now/table/sys_user?...`) y
 * devuelve QUIÉN quedó autenticado. Un test que sólo dijera "OK" no distinguiría
 * una credencial correcta de un endpoint que devuelve 200 en el login HTML.
 *
 * RBAC: `requireTenantRole(['Admin','Owner'])` — usa credenciales del tenant para
 * hacer un request saliente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import { assertPublicHttpsUrl } from '@/lib/webhookSecurity';
import { getItsmCredentials } from '@/services/tenantConfiguration.service';
import type { ItsmSystemType } from '@/types/tenantConfiguration.types';

const TEST_TIMEOUT_MS = 10000;

/** Endpoint de identidad + cómo leer el nombre de la respuesta, por sistema. */
function probeFor(system: ItsmSystemType, baseUrl: string): { path: string; pick: (j: any) => string | undefined } | null {
    const base = baseUrl.replace(/\/+$/, '');
    switch (system) {
        case 'JIRA':
            return { path: `${base}/rest/api/3/myself`, pick: (j) => j?.displayName || j?.emailAddress };
        case 'AZURE_DEVOPS':
            return { path: `${base}/_apis/connectionData?api-version=7.1-preview.1`, pick: (j) => j?.authenticatedUser?.providerDisplayName };
        case 'SERVICENOW':
            return { path: `${base}/api/now/table/sys_user?sysparm_limit=1`, pick: (j) => j?.result?.[0]?.user_name || 'credencial válida' };
        default:
            return null;
    }
}

function authHeaderFor(system: ItsmSystemType, userEmail: string, apiKey: string): string {
    // Azure DevOps: PAT con usuario vacío. Jira Cloud y ServiceNow: usuario + token.
    const user = system === 'AZURE_DEVOPS' ? '' : userEmail;
    return `Basic ${Buffer.from(`${user}:${apiKey}`).toString('base64')}`;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId } = body as { tenantId?: string };
        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ ok: true, mock: true, identity: 'demo.admin@empresa-demo.com', status: 200 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Se prueba lo que está GUARDADO, no lo que viene en el body: probar un
        // secreto suelto validaría credenciales que después no son las que usa
        // el Action Center para crear tickets.
        const creds = await getItsmCredentials(tenantId);
        if (!creds) {
            return NextResponse.json({ ok: false, error: 'No hay integración ITSM configurada. Guardá las credenciales primero.' }, { status: 400 });
        }
        if (!creds.baseUrl || !creds.apiKey) {
            return NextResponse.json({ ok: false, error: 'Faltan la URL base o el token de la integración ITSM.' }, { status: 400 });
        }

        try {
            await assertPublicHttpsUrl(creds.baseUrl, 'La URL base de ITSM');
        } catch (urlErr) {
            return NextResponse.json({ ok: false, error: errorMessage(urlErr) }, { status: 400 });
        }

        const probe = probeFor(creds.system, creds.baseUrl);
        if (!probe) {
            return NextResponse.json({ ok: false, error: `Sistema ITSM no soportado: ${creds.system}` }, { status: 400 });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        try {
            const res = await fetch(probe.path, {
                method: 'GET',
                headers: {
                    Authorization: authHeaderFor(creds.system, creds.userEmail, creds.apiKey),
                    Accept: 'application/json',
                },
                signal: controller.signal,
                redirect: 'error', // evita que un redirect arrastre el header Authorization a otro host
            });

            if (!res.ok) {
                // 401/403 = credencial; 404 = URL base equivocada. Distinguirlos ahorra el
                // ciclo de "probar de nuevo con el mismo token".
                const hint = res.status === 401 || res.status === 403
                    ? 'Credenciales rechazadas: revisá el token y el usuario.'
                    : res.status === 404
                        ? 'La URL base no expone la API esperada: revisá el dominio.'
                        : `El sistema respondió ${res.status}.`;
                return NextResponse.json({ ok: false, status: res.status, error: hint });
            }

            const json = await res.json().catch(() => ({}));
            return NextResponse.json({ ok: true, status: res.status, identity: probe.pick(json) || 'credencial válida' });
        } catch (fetchErr) {
            const aborted = (fetchErr as Error).name === 'AbortError';
            return NextResponse.json({
                ok: false,
                error: aborted ? `El sistema ITSM no respondió en ${TEST_TIMEOUT_MS / 1000}s.` : errorMessage(fetchErr),
            });
        } finally {
            clearTimeout(timer);
        }
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error('[/api/admin/config/integrations/test-itsm] error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
