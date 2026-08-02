import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { encryptSecret } from "@/lib/secretCrypto";
import { invalidateAIConfigCache } from "@/modules/core/aiProvider";

/**
 * Fallback global de proveedor de IA (GlobalSettings.ai_provider/ai_api_key)
 * — usado por cualquier tenant que NO configuró su propia key en
 * /admin/ai-config (BYOK per-tenant). Antes esta tabla solo se LEÍA
 * (getAIConfig en src/services/aiService.ts) — no existía ningún endpoint
 * para escribirla, la única forma de setearla era a mano en la DB o vía
 * GEMINI_API_KEY en el .env del VPS.
 *
 * ai_enabled acá es un interruptor maestro de PLATAFORMA: si está apagado,
 * la IA se apaga para TODOS los tenants sin importar su propio toggle en
 * /admin/ai-config (ver el AND de ambos en los gates de copilot/ai-report).
 * ai_anomaly_sensitivity / ai_share_resource_names / ai_share_tags son los
 * valores por default que se le asignan a un tenant nuevo al darlo de alta
 * (ver INSERT INTO Tenants en /api/onboard) — cada tenant puede después
 * ajustarlos por su cuenta en su propia Configuración de IA.
 */

const PROVIDERS = new Set(["google", "openai", "azure_openai", "anthropic", "deepseek", "chatgpt", "kimi", "mistral", "cohere"]);
const VALID_SENSITIVITIES = new Set(["low", "medium", "high"]);
const GLOBAL_KEYS = [
    "ai_provider",
    "ai_api_key",
    "enterprise_ai_provider",
    "enterprise_ai_api_key",
    "ai_enabled",
    "ai_anomaly_sensitivity",
    "ai_share_resource_names",
    "ai_share_tags",
];

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const [rows]: any = await pool.query(
            `SELECT setting_key, setting_value FROM GlobalSettings WHERE setting_key IN (${GLOBAL_KEYS.map(() => "?").join(",")})`,
            GLOBAL_KEYS
        );
        const map: Record<string, string> = {};
        for (const r of rows || []) map[r.setting_key] = r.setting_value;

        return NextResponse.json({
            success: true,
            provider: map.ai_provider || "google",
            hasApiKey: Boolean(map.ai_api_key),
            enterpriseProvider: map.enterprise_ai_provider || "azure_openai",
            hasEnterpriseApiKey: Boolean(map.enterprise_ai_api_key),
            aiEnabled: map.ai_enabled !== "false",
            anomalySensitivity: (map.ai_anomaly_sensitivity as string) || "medium",
            shareResourceNames: map.ai_share_resource_names !== "false",
            shareTags: map.ai_share_tags !== "false",
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/config/ai-global] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

async function upsertGlobalSetting(key: string, value: string) {
    await pool.query(
        `INSERT INTO GlobalSettings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value]
    );
}

export async function PATCH(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const body = await request.json().catch(() => ({}));
        const provider = String(body.provider || "google");
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        const enterpriseProvider = body.enterpriseProvider ? String(body.enterpriseProvider) : undefined;
        const enterpriseApiKey = typeof body.enterpriseApiKey === "string" ? body.enterpriseApiKey.trim() : "";
        const { aiEnabled, anomalySensitivity, shareResourceNames, shareTags } = body;

        if (!PROVIDERS.has(provider)) {
            return NextResponse.json({ error: `Proveedor inválido. Debe ser uno de: ${[...PROVIDERS].join(", ")}` }, { status: 400 });
        }
        if (enterpriseProvider && !PROVIDERS.has(enterpriseProvider)) {
            return NextResponse.json({ error: `Proveedor enterprise inválido. Debe ser uno de: ${[...PROVIDERS].join(", ")}` }, { status: 400 });
        }
        if (anomalySensitivity !== undefined && !VALID_SENSITIVITIES.has(anomalySensitivity)) {
            return NextResponse.json({ error: "anomalySensitivity debe ser low, medium o high" }, { status: 400 });
        }

        await upsertGlobalSetting("ai_provider", provider);

        // apiKey vacío = no tocar la key existente (solo se actualiza el
        // proveedor). Para borrarla explícitamente, mandar apiKey: null.
        if (apiKey) {
            await upsertGlobalSetting("ai_api_key", encryptSecret(apiKey));
        } else if (body.apiKey === null) {
            await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'ai_api_key'`);
        }

        if (enterpriseProvider) {
            await upsertGlobalSetting("enterprise_ai_provider", enterpriseProvider);
        }
        
        if (enterpriseApiKey) {
            await upsertGlobalSetting("enterprise_ai_api_key", encryptSecret(enterpriseApiKey));
        } else if (body.enterpriseApiKey === null) {
            await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'enterprise_ai_api_key'`);
        }

        if (aiEnabled !== undefined) await upsertGlobalSetting("ai_enabled", aiEnabled ? "true" : "false");
        if (anomalySensitivity !== undefined) await upsertGlobalSetting("ai_anomaly_sensitivity", anomalySensitivity);
        if (shareResourceNames !== undefined) await upsertGlobalSetting("ai_share_resource_names", shareResourceNames ? "true" : "false");
        if (shareTags !== undefined) await upsertGlobalSetting("ai_share_tags", shareTags ? "true" : "false");

        // Cache in-memory de 5 min en aiProvider.ts — invalidar para que el
        // cambio surta efecto de inmediato (mismo criterio que el PATCH per-tenant).
        invalidateAIConfigCache();

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/config/ai-global] PATCH error:", error);
        const msg = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
