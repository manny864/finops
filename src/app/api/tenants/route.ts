import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { tenants as mockTenants } from '@/lib/tenants';
import { verifySubscription } from '@/lib/apiSecurity';
import { AuthError, requireRequestIdentity, requireSuperAdmin } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const identity = await requireRequestIdentity(request);
        const email = identity.email;
        let isSuperAdmin = false;
        try {
            await requireSuperAdmin(request);
            isSuperAdmin = true;
        } catch {
            isSuperAdmin = false;
        }

        let query = 'SELECT tenant_id as id, company_name as name, client_id, client_secret, tier, trial_ends_at, subscription_status, is_onboarded FROM Tenants ORDER BY created_at ASC';
        let queryParams: any[] = [];

        if (!isSuperAdmin && email) {
            query = `SELECT t.tenant_id as id, t.company_name as name, t.client_id, t.client_secret, t.tier, t.trial_ends_at, t.subscription_status, t.is_onboarded 
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
                    `SELECT tenant_id as id, company_name as name, client_id, client_secret, tier, trial_ends_at, subscription_status, is_onboarded
                     FROM Tenants WHERE tenant_id = ? LIMIT 1`,
                    [identity.tenantId]
                );
                const created = newRows as Array<{ id: string; name: string; client_id?: string; client_secret?: string; tier?: string; subscription_status?: string; is_onboarded?: boolean }>;
                if (created.length > 0) tenantRows = [...tenantRows, ...created];
            }
        }
        
        // Inyectar datos mock para demos de tiers o forzar tiers de Admins
        const allTenants = [...tenantRows];
        for (const mock of mockTenants) {
            const existing = allTenants.find(t => t.id === mock.id);
            if (!existing) {
                allTenants.push(mock);
            } else if (mock.tier) {
                existing.tier = mock.tier;
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

        // INSERT IGNORE ensures we don't duplicate clients that already logged in
        await pool.query(
            'INSERT IGNORE INTO Tenants (tenant_id, company_name) VALUES (?, ?)',
            [tenantId, name || 'Organización Desconocida']
        );

        return NextResponse.json({ success: true, message: 'Tenant sincronizado exitosamente.' });
    } catch (error: any) {
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

        await pool.query(
            'INSERT INTO Tenants (tenant_id, company_name, client_id, client_secret) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), client_id = VALUES(client_id), client_secret = VALUES(client_secret)',
            [tenantId, name, clientId || null, clientSecret || null]
        );

        return NextResponse.json({ success: true });
    } catch (error: any) {
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
        console.error('API DELETE /tenants error:', error);
        return NextResponse.json({ error: 'Fallo al eliminar Tenant' }, { status: 500 });
    }
}
