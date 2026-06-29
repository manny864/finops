import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantId, name, tier } = body;

        if (!tenantId || !name) {
            return NextResponse.json({ error: 'Faltan datos obligatorios (tenantId, name)' }, { status: 400 });
        }

        const selectedTier = tier || 'Essential';

        await pool.query(
            'INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), tier = VALUES(tier), subscription_status = VALUES(subscription_status)',
            [tenantId, name, selectedTier, 'ACTIVE']
        );

        return NextResponse.json({ success: true, message: 'Tenant manual creado exitosamente.' });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API POST /admin/tenants error:', error);
        return NextResponse.json({ error: 'Fallo al crear Tenant manual', details: error.message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantId, tier } = body;

        if (!tenantId || !tier) {
            return NextResponse.json({ error: 'Faltan datos (tenantId, tier)' }, { status: 400 });
        }

        await pool.query(
            'UPDATE Tenants SET tier = ? WHERE tenant_id = ?',
            [tier, tenantId]
        );

        return NextResponse.json({ success: true, message: 'Tier actualizado exitosamente.' });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API PATCH /admin/tenants error:', error);
        return NextResponse.json({ error: 'Fallo al actualizar Tier', details: error.message }, { status: 500 });
    }
}
