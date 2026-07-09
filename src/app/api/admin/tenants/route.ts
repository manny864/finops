import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { serverError } from '@/lib/apiErrors';

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
        return serverError(error, { message: 'Fallo al crear Tenant manual', status: 500 });
    }
}

const VALID_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'];

export async function PATCH(request: NextRequest) {
    try {
        await initializeDatabase();
        const identity = await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantId, tier, subscriptionStatus, salesReferrer } = body;

        if (!tenantId || (!tier && !subscriptionStatus && salesReferrer === undefined)) {
            return NextResponse.json({ error: 'Faltan datos (tenantId y al menos tier, subscriptionStatus o salesReferrer)' }, { status: 400 });
        }

        if (subscriptionStatus && !VALID_SUBSCRIPTION_STATUSES.includes(subscriptionStatus)) {
            return NextResponse.json({ error: 'subscriptionStatus inválido' }, { status: 400 });
        }

        let cleanSalesReferrer: string | null | undefined;
        if (salesReferrer !== undefined) {
            const trimmed = typeof salesReferrer === 'string' ? salesReferrer.trim() : '';
            if (trimmed.length > 255) {
                return NextResponse.json({ error: 'salesReferrer no puede superar 255 caracteres' }, { status: 400 });
            }
            // String vacío = "quitar etiqueta" (NULL), no un error.
            cleanSalesReferrer = trimmed.length > 0 ? trimmed : null;
        }

        // Construcción dinámica: el superadmin puede actualizar tier y/o
        // subscriptionStatus y/o salesReferrer en la misma llamada, o cada uno
        // por separado (ej. activar manualmente un tenant en TRIAL sin tocar su tier).
        const sets: string[] = [];
        const params: any[] = [];
        if (tier) { sets.push('tier = ?'); params.push(tier); }
        if (subscriptionStatus) { sets.push('subscription_status = ?'); params.push(subscriptionStatus); }
        if (cleanSalesReferrer !== undefined) {
            sets.push('sales_referrer = ?', 'sales_referrer_updated_by = ?', 'sales_referrer_updated_at = NOW()');
            params.push(cleanSalesReferrer, identity.email || null);
        }
        params.push(tenantId);

        await pool.query(
            `UPDATE Tenants SET ${sets.join(', ')} WHERE tenant_id = ?`,
            params
        );

        return NextResponse.json({ success: true, message: 'Tenant actualizado exitosamente.' });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API PATCH /admin/tenants error:', error);
        return serverError(error, { message: 'Fallo al actualizar Tenant', status: 500 });
    }
}
