import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { AIProviderFactory, invalidateAIConfigCache, extractAiErrorMessage } from "@/modules/core/aiProvider";
import { insertPlatformAiUsage } from "@/modules/storage/db";

/**
 * Prueba de conexión real contra el proveedor de IA de ESTE tenant (BYOK en
 * /admin/ai-config) — mismo patrón que /api/admin/config/ai-global/test
 * pero pasando tenantId, para que use la key propia del tenant (o el
 * fallback global si el tenant no configuró la suya).
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId } = body as { tenantId?: string };

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Nunca servir un resultado cacheado de un intento anterior — el test
        // debe reflejar la config guardada AHORA MISMO.
        invalidateAIConfigCache(tenantId);

        const overrideProvider = body.provider;
        const overrideApiKey = body.apiKey;
        const overrideEndpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : undefined;
        const overrideDeployment = typeof body.deployment === "string" ? body.deployment.trim() : undefined;
        const overrideConfig = overrideProvider && overrideApiKey
            ? {
                provider: overrideProvider,
                apiKey: overrideApiKey,
                source: 'byok' as const,
                azureOpenAIEndpoint: overrideEndpoint,
                azureOpenAIDeployment: overrideDeployment,
            }
            : undefined;

        const { model, modelName, config } = await AIProviderFactory.getGeminiModel(tenantId, false, overrideConfig);
        const { text, usage } = await generateText({
            model: model as any,
            prompt: "Say OK.",
        });

        insertPlatformAiUsage({
            tenantId,
            source: config.source,
            provider: config.provider,
            modelName,
            feature: 'admin-test-tenant',
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
        });

        return NextResponse.json({ success: true, reply: text.trim().slice(0, 100) });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        const message = extractAiErrorMessage(error);
        console.error("[admin/config/ai/test] error:", message, error);
        return NextResponse.json({ success: false, error: message }, { status: 200 });
    }
}
