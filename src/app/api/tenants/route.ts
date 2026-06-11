import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';

export async function GET(request: NextRequest) {
    try {
        const [rows] = await pool.query('SELECT tenant_id as id, company_name as name, client_id, client_secret FROM Tenants ORDER BY created_at ASC');
        return NextResponse.json({ success: true, tenants: rows });
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
