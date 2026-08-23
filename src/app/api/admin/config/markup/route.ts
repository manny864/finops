/**
 * Motor de facturación de partner (CSP): configuración global de margen.
 *
 * GET  ?tenantId= → settings + reglas de excepción + simulación.
 * PUT             → guarda porcentaje global, tarifa fija e interruptor.
 *
 * RBAC: `requireTenantRole(['Admin','Owner'])` en ambos. No es una lectura
 * inocua: el margen es información comercial del partner, no del cliente final.
 * El tier gate Enterprise se mantiene igual que en /api/admin/billing-markup.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, hasSystemRole, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import pool, { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { hasAccess } from '@/lib/tierLogic';
import {
    getMarkupSettings,
    listOverrideRules,
    saveMarkupSettings,
    simulateBilling,
} from '@/services/tenantPartnerMarkup.service';
import { isValidFixedFee, isValidMarkupPercentage } from '@/types/tenantPartnerMarkup.types';
import { enforceMfaIfEnabled } from '@/lib/requireMfaChallenge';

const MOCK_SETTINGS = {
    globalMarkupPercentage: 15,
    fixedManagementFeeUSD: 500,
    isMarkupEnabled: true,
};

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        // Directiva 24: literales sintéticos, sin tocar DB/Azure/Redis.
        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                mock: true,
                settings: { tenantId, ...MOCK_SETTINGS, updatedAt: new Date().toISOString() },
                rules: [
                    { id: 'demo-1', tenantId, ruleName: 'Marketplace sin margen', scopeType: 'SERVICE_CATEGORY', scopeValue: 'Marketplace', overridePercentage: 0, isEnabled: true, createdAt: new Date().toISOString() },
                    { id: 'demo-2', tenantId, ruleName: 'Suscripción Producción', scopeType: 'SUBSCRIPTION', scopeValue: 'sub-prod-001', overridePercentage: 5, isEnabled: true, createdAt: new Date().toISOString() },
                ],
                simulation: simulateBilling(MOCK_SETTINGS.globalMarkupPercentage, MOCK_SETTINGS.fixedManagementFeeUSD),
            });
        }

        await initializeDatabase();
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        const settings = await getMarkupSettings(tenantId);
        const rules = await listOverrideRules(tenantId);

        return NextResponse.json({
            success: true,
            settings,
            rules,
            simulation: simulateBilling(settings.globalMarkupPercentage, settings.fixedManagementFeeUSD),
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/markup] GET error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, globalMarkupPercentage, fixedManagementFeeUSD, isMarkupEnabled } = body as {
            tenantId?: string;
            globalMarkupPercentage?: number;
            fixedManagementFeeUSD?: number;
            isMarkupEnabled?: boolean;
        };

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true });

        await initializeDatabase();
        const identity = await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Paridad con /api/admin/billing-markup, el endpoint que este reemplaza:
        // cambiar el margen altera lo que se le factura al cliente final, así
        // que exige MFA si el usuario tiene 2FA activo. Migrar sin esto habría
        // sido una regresión de seguridad silenciosa.
        await enforceMfaIfEnabled(request, identity.email, identity.tenantId, 'change_billing_config', { tenantId });

        // Rango validado contra el tipo real de la columna: DECIMAL(5,2) y
        // DECIMAL(12,2) truncan en silencio lo que no entra, así que un 1500%
        // se guardaría como otra cosa sin avisar. La ruta previa
        // (/api/admin/billing-markup) sólo chequeaba `typeof === 'number'`.
        if (!isValidMarkupPercentage(globalMarkupPercentage)) {
            return NextResponse.json(
                { error: 'El margen debe ser un número entre 0 y 999.99.' },
                { status: 400 }
            );
        }
        if (!isValidFixedFee(fixedManagementFeeUSD)) {
            return NextResponse.json(
                { error: 'La tarifa fija debe ser un número mayor o igual a 0.' },
                { status: 400 }
            );
        }

        const [tenants] = await pool.query<any[]>('SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
        const tier = String(tenants?.[0]?.tier || '');
        const isSuperAdmin = Boolean(identity?.isCorporateDomain) && await hasSystemRole(identity.email, 'SUPERADMIN');
        if (!hasAccess(tier, 'Enterprise') && !isSuperAdmin) {
            return NextResponse.json({ error: 'Feature bloqueada. Requiere plan Enterprise.' }, { status: 403 });
        }

        await saveMarkupSettings(tenantId, {
            globalMarkupPercentage,
            fixedManagementFeeUSD,
            isMarkupEnabled: isMarkupEnabled ?? true,
        });

        const settings = await getMarkupSettings(tenantId);
        return NextResponse.json({
            success: true,
            settings,
            simulation: simulateBilling(settings.globalMarkupPercentage, settings.fixedManagementFeeUSD),
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/markup] PUT error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
