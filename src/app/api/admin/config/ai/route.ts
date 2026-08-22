import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifySubscription } from '@/lib/apiSecurity';
import { requireTenantRole, hasSystemRole, AuthError } from "@/lib/requestAuth";
import { encryptSecret } from '@/lib/secretCrypto';
import { invalidateAIConfigCache } from '@/modules/core/aiProvider';
import { buildApiKeyHint } from '@/types/tenantAiConfiguration.types';

const VALID_SENSITIVITIES = new Set(['low', 'medium', 'high']);

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Fallback de esquema: 20260822-007 agrega hint y metadatos de la última
        // prueba. Si todavía no corrió en esta réplica se lee el esquema previo
        // en vez de devolver 500. Filtrado por ER_BAD_FIELD_ERROR: un timeout
        // debe propagarse, no disfrazarse de "esquema viejo".
        let row: any;
        try {
            const [rows] = await pool.query(
                `SELECT ai_provider, ai_api_key, ai_endpoint, ai_deployment, ai_enabled, ai_anomaly_sensitivity,
                        ai_share_resource_names, ai_share_tags,
                        ai_api_key_hint, ai_last_connection_test_at, ai_last_connection_status
                 FROM Tenants WHERE tenant_id = ? LIMIT 1`,
                [tenantId]
            );
            row = (rows as any[])[0];
        } catch (err: any) {
            if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
            const [legacyRows] = await pool.query(
                `SELECT ai_provider, ai_api_key, ai_endpoint, ai_deployment, ai_enabled, ai_anomaly_sensitivity,
                        ai_share_resource_names, ai_share_tags
                 FROM Tenants WHERE tenant_id = ? LIMIT 1`,
                [tenantId]
            );
            row = (legacyRows as any[])[0];
        }

        if (!row) {
            return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
        }

        return NextResponse.json({
            aiProvider: row.ai_provider || 'system',
            // La API key nunca se devuelve al cliente, solo si hay una guardada.
            hasApiKey: Boolean(row.ai_api_key),
            // Pista no reversible (últimos 4 caracteres) para reconocer cuál está cargada.
            apiKeyMaskedHint: row.ai_api_key_hint || null,
            aiEndpoint: row.ai_endpoint || '',
            aiDeployment: row.ai_deployment || 'gpt-4o',
            aiEnabled: Boolean(row.ai_enabled ?? true),
            anomalySensitivity: row.ai_anomaly_sensitivity || 'medium',
            shareResourceNames: Boolean(row.ai_share_resource_names ?? true),
            shareTags: Boolean(row.ai_share_tags ?? true),
            lastConnectionTestAt: row.ai_last_connection_test_at || null,
            lastConnectionStatus: row.ai_last_connection_status || null,
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
            aiEndpoint,
            aiDeployment,
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

        const identity = await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        const isAuthorized = (await verifySubscription(tenantId)) || (await hasSystemRole(identity.email, 'SUPERADMIN'));
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
        let hintUpdate: string | null = null;
        let hintTouched = false;

        // aiApiKey solo se toca si el cliente lo mandó explícitamente (incluido
        // `null` para limpiarla al volver a "system"). Si el campo viene
        // ausente del body (el usuario solo cambió toggles de esta pantalla,
        // sin re-escribir la key) NO se pisa la key ya guardada — cifrarla de
        // nuevo cada save era imposible de todos modos porque nunca se
        // devuelve en claro al cliente (GET solo manda hasApiKey).
        if (Object.prototype.hasOwnProperty.call(body, 'aiApiKey')) {
            setClauses.push('ai_api_key = ?');
            params.push(aiApiKey ? encryptSecret(aiApiKey) : null);
            // La pista viaja junto con la clave: si se rota, la pista vieja
            // señalaría una credencial que ya no está cargada. Tolerante a que
            // 20260822-007 no haya corrido (ver hasHintColumn más abajo).
            hintUpdate = aiApiKey ? buildApiKeyHint(aiApiKey) : null;
            hintTouched = true;
        }

        // Azure IA BYOK: endpoint URL + deployment (modelo).
        if (Object.prototype.hasOwnProperty.call(body, 'aiEndpoint')) {
            setClauses.push('ai_endpoint = ?');
            params.push(typeof aiEndpoint === 'string' && aiEndpoint.trim() ? aiEndpoint.trim() : null);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'aiDeployment')) {
            setClauses.push('ai_deployment = ?');
            params.push(typeof aiDeployment === 'string' && aiDeployment.trim() ? aiDeployment.trim() : null);
        }

        if (hintTouched) {
            setClauses.push('ai_api_key_hint = ?');
            params.push(hintUpdate);
        }

        params.push(tenantId);
        try {
            await pool.query(`UPDATE Tenants SET ${setClauses.join(', ')} WHERE tenant_id = ?`, params);
        } catch (err: any) {
            // 20260822-007 pendiente en esta réplica: reintentar sin la pista.
            // Guardar la configuración importa más que la ayuda visual.
            if (err?.code !== 'ER_BAD_FIELD_ERROR' || !hintTouched) throw err;
            const idx = setClauses.indexOf('ai_api_key_hint = ?');
            setClauses.splice(idx, 1);
            params.splice(idx, 1);
            await pool.query(`UPDATE Tenants SET ${setClauses.join(', ')} WHERE tenant_id = ?`, params);
        }

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
