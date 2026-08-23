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
const VALID_SENSITIVITIES = new Set(["low", "medium", "high", "strict"]);
const GLOBAL_KEYS = [
    "ai_provider",
    "ai_api_key",
    "ai_endpoint",
    "ai_deployment",
    "enterprise_ai_provider",
    "enterprise_ai_api_key",
    "enterprise_ai_endpoint",
    "enterprise_ai_resource_name",
    "enterprise_ai_deployment",
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
            endpoint: map.ai_endpoint || process.env.AZURE_OPENAI_ENDPOINT || "",
            deployment: map.ai_deployment || process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o",
            enterpriseProvider: map.enterprise_ai_provider || "azure_openai",
            hasEnterpriseApiKey: Boolean(map.enterprise_ai_api_key),
            enterpriseEndpoint: map.enterprise_ai_endpoint || process.env.AZURE_OPENAI_ENDPOINT || "",
            enterpriseResourceName: map.enterprise_ai_resource_name || process.env.AZURE_OPENAI_RESOURCE_NAME || "",
            enterpriseDeployment: map.enterprise_ai_deployment || process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o",
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
        const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : undefined;
        const deployment = typeof body.deployment === "string" ? body.deployment.trim() : undefined;
        const enterpriseProvider = body.enterpriseProvider ? String(body.enterpriseProvider) : undefined;
        const enterpriseApiKey = typeof body.enterpriseApiKey === "string" ? body.enterpriseApiKey.trim() : "";
        const enterpriseEndpoint =
            typeof body.enterpriseEndpoint === "string" ? body.enterpriseEndpoint.trim() : undefined;
        const enterpriseResourceName =
            typeof body.enterpriseResourceName === "string" ? body.enterpriseResourceName.trim() : undefined;
        const enterpriseDeployment =
            typeof body.enterpriseDeployment === "string" ? body.enterpriseDeployment.trim() : undefined;
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

        // Endpoint URL + deployment (modelo) para Azure IA en planes no-Enterprise
        // — misma forma que enterprise_ai_endpoint / enterprise_ai_deployment.
        if (endpoint !== undefined) {
            if (endpoint) {
                await upsertGlobalSetting("ai_endpoint", endpoint);
            } else {
                await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'ai_endpoint'`);
            }
        }
        if (deployment !== undefined) {
            if (deployment) {
                await upsertGlobalSetting("ai_deployment", deployment);
            } else {
                await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'ai_deployment'`);
            }
        }

        if (enterpriseProvider) {
            await upsertGlobalSetting("enterprise_ai_provider", enterpriseProvider);
        }
        
        if (enterpriseApiKey) {
            await upsertGlobalSetting("enterprise_ai_api_key", encryptSecret(enterpriseApiKey));
        } else if (body.enterpriseApiKey === null) {
            await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'enterprise_ai_api_key'`);
        }
        if (enterpriseEndpoint !== undefined) {
            if (enterpriseEndpoint) {
                await upsertGlobalSetting("enterprise_ai_endpoint", enterpriseEndpoint);
            } else {
                await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'enterprise_ai_endpoint'`);
            }
        }
        if (enterpriseResourceName !== undefined) {
            if (enterpriseResourceName) {
                await upsertGlobalSetting("enterprise_ai_resource_name", enterpriseResourceName);
            } else {
                await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'enterprise_ai_resource_name'`);
            }
        }
        if (enterpriseDeployment !== undefined) {
            if (enterpriseDeployment) {
                await upsertGlobalSetting("enterprise_ai_deployment", enterpriseDeployment);
            } else {
                await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'enterprise_ai_deployment'`);
            }
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
