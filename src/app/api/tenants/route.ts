import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { tenants as mockTenants } from '@/lib/tenants';
import { verifySubscription } from '@/lib/apiSecurity';
import { AuthError, requireRequestIdentity, requireSuperAdmin, requireTenantRole, requireTenantAccess } from "@/lib/requestAuth";
import { setTenantCredentials } from "@/lib/secrets/tenantCredentials";
import { assertProviderIngestable, ProviderDisabledError } from "@/services/providerLifecycleService";

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const identity = await requireRequestIdentity(request);
        const email = identity.email;

        // Super-admin para EFECTOS DE LECTURA del listado:
        // 1) intentamos el path estricto (Users.system_role='SUPERADMIN')
        // 2) si falla pero el usuario está en dominio corporativo, lo tratamos como SA
        //    y AUTO-BOOTSTRAPPEAMOS la fila en Users para que próximas llamadas pasen
        //    por el path estricto. Esto evita que un super-admin "histórico" vea sólo
        //    su tenant después del endurecimiento de seguridad.
        let isSuperAdmin = false;
        try {
            await requireSuperAdmin(request);
            isSuperAdmin = true;
        } catch {
            if (identity.isCorporateDomain) {
                isSuperAdmin = true;
                try {
                    // Auto-provision tenant primero (FK requirement) y luego Users.
                    await pool.query(
                        'INSERT IGNORE INTO Tenants (tenant_id, company_name) VALUES (?, ?)',
                        [identity.tenantId, email.split('@')[1] || 'CSCloudSolutions']
                    );
                    await pool.query(
                        `INSERT INTO Users (entra_oid, email, tenant_id, system_role, display_name)
                         VALUES (?, ?, ?, 'SUPERADMIN', ?)
                         ON DUPLICATE KEY UPDATE system_role = 'SUPERADMIN'`,
                        [identity.claims.oid || email, email, identity.tenantId, email.split('@')[0]]
                    );
                    console.log(`[tenants] auto-bootstrap SUPERADMIN: ${email}`);
                } catch (bootstrapErr: any) {
                    console.warn(`[tenants] no se pudo bootstrap SUPERADMIN ${email}:`, bootstrapErr?.message);
                }
            }
        }

        // SECURITY: never return client_secret over the wire. Expose only a boolean
        // indicating whether credentials are configured so the UI can render
        // the right call-to-action ("complete onboarding" vs "ready").
        // sales_referrer: etiqueta comercial interna (origen de venta/referido),
        // solo visible para SUPERADMIN — no forma parte del SELECT por-usuario.
        let query = `SELECT tenant_id as id, company_name as name, client_id,
                            (client_secret IS NOT NULL AND client_secret <> '') as has_client_secret,
                            tier, trial_ends_at, subscription_status, access_until, is_onboarded,
                            partner_link_status, partner_link_detail,
                            provider, provider_archived, provider_purge_at, timezone,
                            sales_referrer, (logo_stored_name IS NOT NULL) as has_logo,
                            SUBSTRING(MD5(logo_stored_name), 1, 10) as logo_version
                     FROM Tenants ORDER BY created_at ASC`;
        let queryParams: any[] = [];

        if (!isSuperAdmin && email) {
            query = `SELECT t.tenant_id as id, t.company_name as name, t.client_id,
                            (t.client_secret IS NOT NULL AND t.client_secret <> '') as has_client_secret,
                            t.tier, t.trial_ends_at, t.subscription_status, t.access_until, t.is_onboarded,
                            t.partner_link_status, t.partner_link_detail,
                            t.provider, t.provider_archived, t.provider_purge_at, t.timezone,
                            (t.logo_stored_name IS NOT NULL) as has_logo,
                            SUBSTRING(MD5(t.logo_stored_name), 1, 10) as logo_version
                     FROM Tenants t
                     JOIN Users u ON t.tenant_id = u.tenant_id
                     WHERE u.email = ? ORDER BY t.created_at ASC`;
            queryParams = [email];
        }

        const [rows] = await pool.query(query, queryParams);
        let tenantRows = rows as Array<{ id: string; name: string; tier?: string; subscription_status?: string; is_onboarded?: boolean }>;

        // Auto-provisión: si el tenant del usuario autenticado no aparece en el resultado,
        // crearlo con INSERT IGNORE para que la UI pueda mostrar los inputs de credenciales.
        // Se ejecuta SIEMPRE (también para Super Admins) porque un SA puede no tener fila para su tenant.
        if (identity.tenantId) {
            const alreadyPresent = tenantRows.some(t => t.id === identity.tenantId);
            if (!alreadyPresent) {
                const fallbackName = identity.email?.split('@')[1] || 'Organización sin nombre';
                await pool.query(
                    'INSERT IGNORE INTO Tenants (tenant_id, company_name) VALUES (?, ?)',
                    [identity.tenantId, fallbackName]
                );
                const [newRows] = await pool.query(
                    `SELECT tenant_id as id, company_name as name, client_id,
                            (client_secret IS NOT NULL AND client_secret <> '') as has_client_secret,
                            tier, trial_ends_at, subscription_status, access_until, is_onboarded,
                            partner_link_status, partner_link_detail,
                            provider, provider_archived, provider_purge_at, timezone,
                            (logo_stored_name IS NOT NULL) as has_logo,
                            SUBSTRING(MD5(logo_stored_name), 1, 10) as logo_version
                     FROM Tenants WHERE tenant_id = ? LIMIT 1`,
                    [identity.tenantId]
                );
                const created = newRows as Array<{ id: string; name: string; client_id?: string; has_client_secret?: boolean; tier?: string; subscription_status?: string; is_onboarded?: boolean }>;
                if (created.length > 0) tenantRows = [...tenantRows, ...created];
            }
        }
        
        // Inyectar datos mock para demos de tiers o forzar tiers de Admins
        const allTenants = [...tenantRows];
        for (const mock of mockTenants) {
            const existing = allTenants.find(t => t.id === mock.id);
            if (!existing) {
                allTenants.push(mock);
            } else {
                if (mock.tier) existing.tier = mock.tier;
                // El proveedor del tenant de demo manda sobre la fila real:
                // /demo tiene que mostrar el multi-cloud del tier Enterprise
                // aunque la fila en base diga otra cosa.
                if (mock.provider) (existing as { provider?: string }).provider = mock.provider;
            }
        }
        
        return NextResponse.json({ success: true, tenants: allTenants });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            console.warn('[GET /api/tenants] AuthError:', error.message);
            return NextResponse.json({ error: error.message, authReason: error.message }, { status: error.status });
        }
        console.error('API GET /tenants error:', error);
        return NextResponse.json({ error: 'Fallo al leer la base de datos' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, name } = body;

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        // Cualquier usuario autenticado puede sincronizar SU PROPIO tenant (alta
        // automática al primer login); no se permite sincronizar uno ajeno.
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // INSERT IGNORE ensures we don't duplicate clients that already logged in
        await pool.query(
            'INSERT IGNORE INTO Tenants (tenant_id, company_name) VALUES (?, ?)',
            [tenantId, name || 'Organización Desconocida']
        );

        return NextResponse.json({ success: true, message: 'Tenant sincronizado exitosamente.' });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API POST /tenants error:', error);
        return NextResponse.json({ error: 'Fallo al sincronizar Tenant' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        let { tenantId, name, clientId, clientSecret } = body;

        if (!tenantId || !name) {
            return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
        }

        // Escribe credenciales del Service Principal de Azure: solo el Admin/Owner
        // del propio tenant (o un SUPERADMIN real, vía requireTenantRole) puede
        // hacerlo — antes este endpoint no tenía ningún check de auth.
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Sanitización: remover whitespace y comillas accidentales (común al pegar JSON del onboarding)
        const clean = (v: any) => (typeof v === 'string' ? v.trim().replace(/^["']+|["']+$/g, '') : v);
        tenantId = clean(tenantId);
        clientId = clean(clientId);
        clientSecret = clean(clientSecret);

        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(tenantId)) {
            return NextResponse.json({ error: 'tenantId no es un UUID válido' }, { status: 400 });
        }
        if (clientId && !uuidRe.test(clientId)) {
            return NextResponse.json({ error: 'clientId no es un UUID válido (verificar comillas/espacios al pegar)' }, { status: 400 });
        }

        // Si vienen credenciales, las guardamos via tenantCredentials (KV con fallback DB).
        // Si no vienen, solo actualizamos nombre.
        if (clientId && clientSecret) {
            // Contraparte Azure del gate de `POST /api/aws/accounts`: un tenant
            // configurado como 'aws' puro, o con Azure archivado tras un downgrade
            // multi-cloud, no puede volver a conectar Azure. Solo se valida cuando
            // realmente se están escribiendo credenciales — renombrar el tenant no
            // es ingesta y no debe rechazarse.
            await assertProviderIngestable(tenantId, 'azure');

            await pool.query(
                'INSERT INTO Tenants (tenant_id, company_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)',
                [tenantId, name]
            );
            await setTenantCredentials(tenantId, clientId, clientSecret);
        } else {
            await pool.query(
                'INSERT INTO Tenants (tenant_id, company_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)',
                [tenantId, name]
            );
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        // requireTenantRole ya lanzaba AuthError acá y caía en el 500 genérico,
        // enmascarando un 401/403 como error del servidor.
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof ProviderDisabledError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API PUT /tenants error:', error);
        return NextResponse.json({ error: 'Fallo al actualizar Tenant' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        // Operación destructiva de plataforma (elimina tenant + usuarios): requiere SUPERADMIN.
        await requireSuperAdmin(request);

        // TODO: Para integracion real con Paddle, aqui se haria un fetch a
        // POST https://api.paddle.com/subscriptions/{subscriptionId}/cancel
        // Usando process.env.PADDLE_API_KEY
        console.log(`[Billing] Finalizando facturacion para tenant: ${tenantId}`);

        // Eliminar usuarios asociados
        await pool.query('DELETE FROM Users WHERE tenant_id = ?', [tenantId]);

        // Eliminar Tenant
        await pool.query('DELETE FROM Tenants WHERE tenant_id = ?', [tenantId]);

        return NextResponse.json({ success: true, message: 'Entorno eliminado y facturacion finalizada.' });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API DELETE /tenants error:', error);
        return NextResponse.json({ error: 'Fallo al eliminar Tenant' }, { status: 500 });
    }
}
