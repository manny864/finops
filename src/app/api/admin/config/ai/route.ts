import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifySubscription } from '@/lib/apiSecurity';
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { encryptSecret } from '@/lib/secretCrypto';
import { invalidateAIConfigCache } from '@/modules/core/aiProvider';

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, aiProvider, aiApiKey } = body;

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        const isAuthorized = await verifySubscription(tenantId);
        if (!isAuthorized) {
            return NextResponse.json({ error: 'Forbidden: Active subscription required' }, { status: 403 });
        }

        // La API key se cifra en reposo (AES-256-GCM, IA-2). Se guarda null si
        // viene vacía. encryptSecret es idempotente si ya viniera cifrada.
        const encryptedKey = aiApiKey ? encryptSecret(aiApiKey) : null;

        await pool.query(
            'UPDATE Tenants SET ai_provider = ?, ai_api_key = ? WHERE tenant_id = ?',
            [aiProvider || 'system', encryptedKey, tenantId]
        );

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
