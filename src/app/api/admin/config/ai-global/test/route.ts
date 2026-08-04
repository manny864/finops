import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { AIProviderFactory, invalidateAIConfigCache } from "@/modules/core/aiProvider";
import { insertPlatformAiUsage } from "@/modules/storage/db";

/**
 * Prueba de conexión real contra el proveedor de IA global (GlobalSettings)
 * — un prompt trivial, sin tenantId (usa exclusivamente el fallback global,
 * nunca una key BYOK de tenant), para confirmar que la key guardada
 * realmente funciona antes de depender de ella en producción.
 */
export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        // Nunca servir un resultado cacheado de un intento anterior (con o
        // sin key) — el test debe reflejar el estado guardado AHORA MISMO.
        invalidateAIConfigCache();
        const body = await request.json().catch(() => ({}));
        const isEnterprise = body.testType === 'enterprise';
        const overrideProvider = isEnterprise ? body.enterpriseProvider : body.provider;
        const overrideApiKey = isEnterprise ? body.enterpriseApiKey : body.apiKey;
        const overrideEndpoint = isEnterprise ? body.enterpriseEndpoint : body.endpoint;
        const overrideResourceName = isEnterprise ? body.enterpriseResourceName : undefined;
        const overrideDeployment = isEnterprise ? body.enterpriseDeployment : body.deployment;

        const overrideConfig = overrideProvider && overrideApiKey 
            ? {
                provider: overrideProvider,
                apiKey: overrideApiKey,
                source: 'platform' as const,
                azureOpenAIEndpoint: overrideEndpoint,
                azureOpenAIResourceName: overrideResourceName,
                azureOpenAIDeployment: overrideDeployment,
            }
            : undefined;

        const { model, modelName, config } = await AIProviderFactory.getGeminiModel(undefined, isEnterprise, overrideConfig);
        const { text, usage } = await generateText({
            model: model as any,
            system: "You are a test bot. You must only reply with the word OK.",
            prompt: "Test connection.",
        });

        insertPlatformAiUsage({
            tenantId: null,
            source: config.source,
            provider: config.provider,
            modelName,
            feature: 'admin-test-global',
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
        });

        return NextResponse.json({ success: true, reply: text.trim().slice(0, 100) });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const message = error instanceof Error ? error.message : String(error);
        console.error("[admin/config/ai-global/test] error:", message);
        return NextResponse.json({ success: false, error: message }, { status: 200 });
    }
}
