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

const VALID_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'];

export async function PATCH(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantId, tier, subscriptionStatus } = body;

        if (!tenantId || (!tier && !subscriptionStatus)) {
            return NextResponse.json({ error: 'Faltan datos (tenantId y al menos tier o subscriptionStatus)' }, { status: 400 });
        }

        if (subscriptionStatus && !VALID_SUBSCRIPTION_STATUSES.includes(subscriptionStatus)) {
            return NextResponse.json({ error: 'subscriptionStatus inválido' }, { status: 400 });
        }

        // Construcción dinámica: el superadmin puede actualizar tier y/o
        // subscriptionStatus en la misma llamada, o cada uno por separado
        // (ej. activar manualmente un tenant en TRIAL sin tocar su tier).
        const sets: string[] = [];
        const params: any[] = [];
        if (tier) { sets.push('tier = ?'); params.push(tier); }
        if (subscriptionStatus) { sets.push('subscription_status = ?'); params.push(subscriptionStatus); }
        params.push(tenantId);

        await pool.query(
            `UPDATE Tenants SET ${sets.join(', ')} WHERE tenant_id = ?`,
            params
        );

        return NextResponse.json({ success: true, message: 'Tenant actualizado exitosamente.' });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API PATCH /admin/tenants error:', error);
        return NextResponse.json({ error: 'Fallo al actualizar Tenant', details: error.message }, { status: 500 });
    }
}
