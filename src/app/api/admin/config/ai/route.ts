import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifySubscription } from '@/lib/apiSecurity';
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { encryptSecret } from '@/lib/secretCrypto';
import { invalidateAIConfigCache } from '@/modules/core/aiProvider';

const VALID_SENSITIVITIES = new Set(['low', 'medium', 'high']);

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        const [rows] = await pool.query(
            `SELECT ai_provider, ai_api_key, ai_enabled, ai_anomaly_sensitivity,
                    ai_share_resource_names, ai_share_tags
             FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        const row = (rows as any[])[0];
        if (!row) {
            return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
        }

        return NextResponse.json({
            aiProvider: row.ai_provider || 'system',
            // La API key nunca se devuelve al cliente, solo si hay una guardada.
            hasApiKey: Boolean(row.ai_api_key),
            aiEnabled: Boolean(row.ai_enabled ?? true),
            anomalySensitivity: row.ai_anomaly_sensitivity || 'medium',
            shareResourceNames: Boolean(row.ai_share_resource_names ?? true),
            shareTags: Boolean(row.ai_share_tags ?? true),
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API GET /admin/config/ai error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            tenantId,
            aiProvider,
            aiApiKey,
            aiEnabled,
            anomalySensitivity,
            shareResourceNames,
            shareTags,
        } = body;

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        if (anomalySensitivity !== undefined && !VALID_SENSITIVITIES.has(anomalySensitivity)) {
            return NextResponse.json({ error: 'anomalySensitivity debe ser low, medium o high' }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        const isAuthorized = await verifySubscription(tenantId);
        if (!isAuthorized) {
            return NextResponse.json({ error: 'Forbidden: Active subscription required' }, { status: 403 });
        }

        const setClauses = [
            'ai_provider = ?',
            'ai_enabled = ?',
            'ai_anomaly_sensitivity = ?',
            'ai_share_resource_names = ?',
            'ai_share_tags = ?',
        ];
        const params: any[] = [
            aiProvider || 'system',
            aiEnabled ?? true,
            anomalySensitivity || 'medium',
            shareResourceNames ?? true,
            shareTags ?? true,
        ];

        // aiApiKey solo se toca si el cliente lo mandó explícitamente (incluido
        // `null` para limpiarla al volver a "system"). Si el campo viene
        // ausente del body (el usuario solo cambió toggles de esta pantalla,
        // sin re-escribir la key) NO se pisa la key ya guardada — cifrarla de
        // nuevo cada save era imposible de todos modos porque nunca se
        // devuelve en claro al cliente (GET solo manda hasApiKey).
        if (Object.prototype.hasOwnProperty.call(body, 'aiApiKey')) {
            setClauses.push('ai_api_key = ?');
            params.push(aiApiKey ? encryptSecret(aiApiKey) : null);
        }

        params.push(tenantId);
        await pool.query(`UPDATE Tenants SET ${setClauses.join(', ')} WHERE tenant_id = ?`, params);

        // Invalida el cache in-memory de config IA (5 min) para que la nueva
        // provider/key surta efecto de inmediato y no queden 5 min usando la
        // key vieja tras una rotación (IA-7).
        invalidateAIConfigCache(tenantId);

        return NextResponse.json({ success: true, message: 'Configuración guardada exitosamente.' });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('API PATCH /admin/config/ai error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
