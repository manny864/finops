import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { serverError } from '@/lib/apiErrors';
import { applyTierChange } from "@/services/providerLifecycleService";

async function hasTenantColumn(columnName: string): Promise<boolean> {
    const [rows] = await pool.query(
        `SELECT 1
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'Tenants'
            AND COLUMN_NAME = ?
          LIMIT 1`,
        [columnName]
    );
    return Array.isArray(rows) && rows.length > 0;
}

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantId, name, tier } = body;

        if (!tenantId || !name) {
            return NextResponse.json({ error: 'Faltan datos obligatorios (tenantId, name)' }, { status: 400 });
        }

        const selectedTier = tier || 'Professional';

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
        const { tenantId, tier, subscriptionStatus, salesReferrer, salesCommissionPct } = body;

        if (!tenantId || (!tier && !subscriptionStatus && salesReferrer === undefined && salesCommissionPct === undefined)) {
            return NextResponse.json({ error: 'Faltan datos (tenantId y al menos tier, subscriptionStatus, salesReferrer o salesCommissionPct)' }, { status: 400 });
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
        let cleanSalesCommissionPct: string | null | undefined;
        if (salesCommissionPct !== undefined) {
            const trimmed = typeof salesCommissionPct === 'string'
                ? salesCommissionPct.trim()
                : (typeof salesCommissionPct === 'number' && Number.isFinite(salesCommissionPct) ? String(salesCommissionPct) : '');
            if (trimmed.length === 0) {
                cleanSalesCommissionPct = null;
            } else {
                if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
                    return NextResponse.json({ error: 'salesCommissionPct debe ser un decimal con hasta 2 decimales' }, { status: 400 });
                }
                const numericValue = Number(trimmed);
                if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                    return NextResponse.json({ error: 'salesCommissionPct debe estar entre 0 y 100' }, { status: 400 });
                }
                cleanSalesCommissionPct = trimmed;
            }
        }

        const hasSalesReferrerColumn = await hasTenantColumn('sales_referrer');
        const hasSalesCommissionColumn = await hasTenantColumn('sales_commission_pct');

        if (cleanSalesReferrer !== undefined && !hasSalesReferrerColumn) {
            return NextResponse.json(
                { error: 'La columna sales_referrer no existe aún en Tenants. Ejecutar migraciones pendientes.' },
                { status: 409 }
            );
        }
        if (cleanSalesCommissionPct !== undefined && cleanSalesCommissionPct !== null && !hasSalesCommissionColumn) {
            return NextResponse.json(
                { error: 'La columna sales_commission_pct no existe aún en Tenants. Ejecutar migraciones pendientes.' },
                { status: 409 }
            );
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
        if (cleanSalesCommissionPct !== undefined && hasSalesCommissionColumn) {
            sets.push('sales_commission_pct = ?', 'sales_commission_updated_by = ?', 'sales_commission_updated_at = NOW()');
            params.push(cleanSalesCommissionPct, identity.email || null);
        }

        if (sets.length === 0) {
            return NextResponse.json({ error: 'No hay cambios aplicables para persistir.' }, { status: 400 });
        }

        params.push(tenantId);

        // Tier previo, necesario para reconciliar el modelo de proveedor si
        // este PATCH baja de tier a un tenant Enterprise (el único tier que
        // prometía multi-cloud antes del pivot a Azure-only).
        let previousTier: string | null = null;
        if (tier) {
            const [tierRows] = await pool.query('SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
            previousTier = (tierRows as Array<{ tier?: string }>)[0]?.tier ?? null;
        }

        await pool.query(
            `UPDATE Tenants SET ${sets.join(', ')} WHERE tenant_id = ?`,
            params
        );

        let providerChange = null;
        if (tier && previousTier) {
            providerChange = await applyTierChange({
                tenantId,
                previousTier,
                nextTier: tier,
                actor: identity.email,
            });
        }

        return NextResponse.json({ success: true, message: 'Tenant actualizado exitosamente.', providerChange });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API PATCH /admin/tenants error:', error);
        return serverError(error, { message: 'Fallo al actualizar Tenant', status: 500 });
    }
}
