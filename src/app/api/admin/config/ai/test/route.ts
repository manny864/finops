import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { AIProviderFactory, invalidateAIConfigCache, extractAiErrorMessage } from "@/modules/core/aiProvider";
import pool, { insertPlatformAiUsage } from "@/modules/storage/db";
import { tryDecryptSecret } from "@/lib/secretCrypto";
import { RowDataPacket } from "mysql2";

/**
 * Sella el resultado de la prueba en `Tenants`. Nunca lanza: perder el registro
 * del test es peor que devolverle al admin el resultado que sí obtuvo, y si
 * 20260822-007 todavía no corrió la columna no existe.
 */
async function recordConnectionTest(tenantId: string, status: 'SUCCESS' | 'FAILED'): Promise<void> {
    try {
        await pool.query(
            'UPDATE Tenants SET ai_last_connection_test_at = NOW(), ai_last_connection_status = ? WHERE tenant_id = ?',
            [status, tenantId]
        );
    } catch (err) {
        console.warn('[admin/config/ai/test] no se pudo registrar el resultado de la prueba:', err);
    }
}

/**
 * Prueba de conexión real contra el proveedor de IA de ESTE tenant (BYOK en
 * /admin/ai-config) — mismo patrón que /api/admin/config/ai-global/test
 * pero pasando tenantId, para que use la key propia del tenant (o el
 * fallback global si el tenant no configuró la suya).
 */
export async function POST(request: NextRequest) {
    // Fuera del try: el catch lo necesita para sellar el fallo, y el body ya
    // fue consumido para entonces (request.clone() después de leerlo no sirve).
    let testedTenantId: string | undefined;
    let usedOverride = false;
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId } = body as { tenantId?: string };
        testedTenantId = tenantId;

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Nunca servir un resultado cacheado de un intento anterior — el test
        // debe reflejar la config guardada AHORA MISMO.
        invalidateAIConfigCache(tenantId);

        const overrideProvider = body.provider;
        const overrideApiKey = body.apiKey;
        let overrideEndpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : undefined;
        let overrideDeployment = typeof body.deployment === "string" ? body.deployment.trim() : undefined;

        let effectiveApiKey = overrideApiKey;
        if (!effectiveApiKey && overrideProvider && overrideProvider !== 'system') {
            const [tenantRows] = await pool.query<RowDataPacket[]>(
                'SELECT ai_api_key, ai_endpoint, ai_deployment FROM Tenants WHERE tenant_id = ? LIMIT 1',
                [tenantId]
            );
            if (tenantRows.length > 0 && tenantRows[0].ai_api_key) {
                effectiveApiKey = tryDecryptSecret(tenantRows[0].ai_api_key, `tenant ${tenantId} ai_api_key`) || undefined;
                if (!overrideEndpoint) overrideEndpoint = tenantRows[0].ai_endpoint || undefined;
                if (!overrideDeployment) overrideDeployment = tenantRows[0].ai_deployment || undefined;
            }
        }

        const overrideConfig = (overrideProvider && overrideProvider !== 'system' && effectiveApiKey)
            ? {
                provider: overrideProvider,
                apiKey: effectiveApiKey,
                source: 'byok' as const,
                azureOpenAIEndpoint: overrideEndpoint,
                azureOpenAIDeployment: overrideDeployment,
            }
            : undefined;
        usedOverride = Boolean(overrideConfig);

        const startedAt = Date.now();
        const { model, modelName, config } = await AIProviderFactory.getGeminiModel(tenantId, false, overrideConfig);
        const { text, usage } = await generateText({
            model: model as any,
            prompt: "Say OK.",
        });
        const latencyMs = Date.now() - startedAt;

        insertPlatformAiUsage({
            tenantId,
            source: config.source,
            provider: config.provider,
            modelName,
            feature: 'admin-test-tenant',
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
        });

        // Sólo se sella el resultado cuando se probó la config GUARDADA. Con
        // overrides el test valida credenciales que todavía no están
        // persistidas, y registrarlo diría que la configuración vigente
        // funciona cuando puede no ser la que se probó.
        if (!overrideConfig) await recordConnectionTest(tenantId, 'SUCCESS');

        return NextResponse.json({
            success: true,
            latencyMs,
            modelName,
            message: text.trim().slice(0, 100),
            reply: text.trim().slice(0, 100),
            testedAt: new Date().toISOString(),
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        const message = extractAiErrorMessage(error);
        console.error("[admin/config/ai/test] error:", message, error);
        if (testedTenantId && !usedOverride) await recordConnectionTest(testedTenantId, 'FAILED');
        return NextResponse.json({ success: false, latencyMs: 0, error: message, message, testedAt: new Date().toISOString() }, { status: 200 });
    }
}
