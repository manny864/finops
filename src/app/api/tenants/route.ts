import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { tenants as mockTenants } from '@/lib/tenants';
import { verifySubscription } from '@/lib/apiSecurity';

import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        let email = "";
        let isSuperAdmin = false;

        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            const decoded = jwt.decode(token) as any;
            if (decoded) {
                email = decoded.unique_name || decoded.preferred_username || decoded.email || "";
            }
        }

        if (email) {
            const isCorpDomain = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");
            if (isCorpDomain) {
                const [userRows] = await pool.query('SELECT system_role FROM Users WHERE email = ? LIMIT 1', [email]);
                if ((userRows as any[]).length > 0 && (userRows as any[])[0].system_role === 'SUPERADMIN') {
                    isSuperAdmin = true;
                }
            }
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
        
        // Inyectar datos mock para demos de tiers o forzar tiers de Admins
        const allTenants = [...(rows as any[])];
        for (const mock of mockTenants) {
            const existing = allTenants.find(t => t.id === mock.id);
            if (!existing) {
                allTenants.push(mock);
            } else if (mock.tier) {
                existing.tier = mock.tier;
            }
        }
        
        return NextResponse.json({ success: true, tenants: allTenants });
    } catch (error: any) {
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

        const isAuthorized = await verifySubscription(tenantId);
        if (!isAuthorized) {
            return NextResponse.json({ error: 'Forbidden: Active subscription required' }, { status: 403 });
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
        const { tenantId, name, clientId, clientSecret } = body;

        if (!tenantId || !name) {
            return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
        }

        const isAuthorized = await verifySubscription(tenantId);
        if (!isAuthorized) {
            return NextResponse.json({ error: 'Forbidden: Active subscription required' }, { status: 403 });
        }

        await pool.query(
            'UPDATE Tenants SET company_name = ?, client_id = ?, client_secret = ? WHERE tenant_id = ?',
            [name, clientId || null, clientSecret || null, tenantId]
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
