/**
 * Reglas de excepción de margen (CSP): alta, alternado y baja.
 *
 * RBAC: `requireTenantRole(['Admin','Owner'])` — cambian lo que se le factura
 * al cliente final.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import {
    createOverrideRule,
    deleteOverrideRule,
    listOverrideRules,
    setOverrideRuleEnabled,
} from '@/services/tenantPartnerMarkup.service';
import { isMarkupScopeType, isValidMarkupPercentage } from '@/types/tenantPartnerMarkup.types';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, ruleName, scopeType, scopeValue, overridePercentage } = body as Record<string, any>;

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true });

        await initializeDatabase();
        const identity = await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        if (!ruleName?.trim()) return NextResponse.json({ error: 'El nombre de la regla es obligatorio.' }, { status: 400 });
        if (!isMarkupScopeType(scopeType)) {
            return NextResponse.json({ error: 'Alcance inválido. Valores: SUBSCRIPTION, SERVICE_CATEGORY.' }, { status: 400 });
        }
        if (!scopeValue?.trim()) return NextResponse.json({ error: 'El objetivo de la regla es obligatorio.' }, { status: 400 });
        // 0 es válido y es el caso más común (pass-through sin margen).
        if (!isValidMarkupPercentage(overridePercentage)) {
            return NextResponse.json({ error: 'El margen debe ser un número entre 0 y 999.99.' }, { status: 400 });
        }

        try {
            await createOverrideRule(
                tenantId,
                { ruleName: ruleName.trim(), scopeType, scopeValue: scopeValue.trim(), overridePercentage },
                identity.email
            );
        } catch (err: any) {
            // UNIQUE (tenant_id, scope_type, scope_value): dos reglas para el
            // mismo alcance harían el margen dependiente del orden de lectura.
            if (err?.code === 'ER_DUP_ENTRY') {
                return NextResponse.json({ error: 'Ya existe una regla para ese alcance.' }, { status: 409 });
            }
            throw err;
        }

        return NextResponse.json({ success: true, rules: await listOverrideRules(tenantId) });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/markup/rules] POST error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, ruleId, isEnabled } = body as { tenantId?: string; ruleId?: string; isEnabled?: boolean };

        if (!tenantId || !ruleId) return NextResponse.json({ error: 'Falta tenantId o ruleId' }, { status: 400 });
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true });

        await initializeDatabase();
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        await setOverrideRuleEnabled(tenantId, ruleId, Boolean(isEnabled));
        return NextResponse.json({ success: true, rules: await listOverrideRules(tenantId) });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/markup/rules] PATCH error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const ruleId = request.nextUrl.searchParams.get('ruleId');

        if (!tenantId || !ruleId) return NextResponse.json({ error: 'Falta tenantId o ruleId' }, { status: 400 });
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true });

        await initializeDatabase();
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // El DELETE filtra por tenant_id además del id: nadie borra la regla de
        // otro tenant mandando un id ajeno.
        await deleteOverrideRule(tenantId, ruleId);
        return NextResponse.json({ success: true, rules: await listOverrideRules(tenantId) });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/markup/rules] DELETE error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
