/**
 * Servicio backend para Gobernanza y Configuración Global de IA (SuperAdmin).
 */

import pool, { initializeDatabase, insertPlatformAiUsage } from "@/modules/storage/db";
import { encryptSecret } from "@/lib/secretCrypto";
import { AIProviderFactory, invalidateAIConfigCache, extractAiErrorMessage } from "@/modules/core/aiProvider";
import { generateText } from "ai";
import {
    PlatformGlobalAiSettings,
    SavePlatformAiPayload,
    TestPlatformAiPayload,
    TestPlatformAiResponse,
    AnomalySensitivityLevel,
} from "@/types/superAdminAiConfig.types";

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

const MOCK_SETTINGS: PlatformGlobalAiSettings = {
    isPlatformMasterAiEnabled: true,
    nonEnterpriseConfig: {
        provider: "azure_openai",
        hasStoredApiKey: false,
        azureEndpointUrl: "",
        deploymentModelName: "gpt-4o-mini",
        resourceName: "",
    },
    enterpriseConfig: {
        provider: "azure_openai",
        hasStoredApiKey: false,
        azureEndpointUrl: "",
        deploymentModelName: "gpt-5.1",
        resourceName: "",
    },
    defaultAnomalySensitivity: "MEDIUM",
    defaultShareResourceNames: true,
    defaultShareTags: true,
    updatedAtIso: new Date().toISOString(),
};

async function ensureGlobalSettingsTable(): Promise<void> {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS GlobalSettings (
                setting_key VARCHAR(50) PRIMARY KEY,
                setting_value TEXT NOT NULL
            )
        `);
    } catch {
        /* noop */
    }
}

async function upsertGlobalSetting(key: string, value: string): Promise<void> {
    await ensureGlobalSettingsTable();
    await pool.query(
        `INSERT INTO GlobalSettings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value]
    );
}

export async function getPlatformGlobalAiSettings(isMock = false): Promise<PlatformGlobalAiSettings> {
    if (isMock) {
        return { ...MOCK_SETTINGS };
    }

    try {
        await initializeDatabase();
        await ensureGlobalSettingsTable();
        const [rows]: any = await pool.query(
            `SELECT setting_key, setting_value FROM GlobalSettings WHERE setting_key IN (${GLOBAL_KEYS.map(() => "?").join(",")})`,
            GLOBAL_KEYS
        );
        const map: Record<string, string> = {};
        for (const r of rows || []) {
            map[r.setting_key] = r.setting_value;
        }

        const rawSens = (map.ai_anomaly_sensitivity || "medium").toUpperCase();
        const sensitivity: AnomalySensitivityLevel =
            rawSens === "LOW" || rawSens === "HIGH" || rawSens === "STRICT" ? rawSens : "MEDIUM";

        return {
            isPlatformMasterAiEnabled: map.ai_enabled !== "false",
            nonEnterpriseConfig: {
                provider: map.ai_provider || "azure_openai",
                hasStoredApiKey: Boolean(map.ai_api_key),
                azureEndpointUrl: map.ai_endpoint || "",
                deploymentModelName: map.ai_deployment || "gpt-4o-mini",
                resourceName: "",
            },
            enterpriseConfig: {
                provider: map.enterprise_ai_provider || "azure_openai",
                hasStoredApiKey: Boolean(map.enterprise_ai_api_key),
                azureEndpointUrl: map.enterprise_ai_endpoint || "",
                deploymentModelName: map.enterprise_ai_deployment || "gpt-5.1",
                resourceName: map.enterprise_ai_resource_name || "",
            },
            defaultAnomalySensitivity: sensitivity,
            defaultShareResourceNames: map.ai_share_resource_names !== "false",
            defaultShareTags: map.ai_share_tags !== "false",
            updatedAtIso: new Date().toISOString(),
        };
    } catch {
        return { ...MOCK_SETTINGS };
    }
}

export async function savePlatformGlobalAiSettings(
    payload: SavePlatformAiPayload,
    _updatedBy: string,
    isMock = false
): Promise<{ success: boolean }> {
    if (isMock) {
        return { success: true };
    }

    await initializeDatabase();
    await ensureGlobalSettingsTable();

    // Master switch
    await upsertGlobalSetting("ai_enabled", payload?.isPlatformMasterAiEnabled !== false ? "true" : "false");

    // Non-enterprise config
    const nonEnt = payload?.nonEnterpriseConfig || {};
    if (nonEnt.provider) {
        await upsertGlobalSetting("ai_provider", nonEnt.provider);
    }
    if (nonEnt.apiKey && nonEnt.apiKey.trim()) {
        await upsertGlobalSetting("ai_api_key", encryptSecret(nonEnt.apiKey.trim()));
    }
    if (nonEnt.azureEndpointUrl !== undefined) {
        await upsertGlobalSetting("ai_endpoint", nonEnt.azureEndpointUrl.trim());
    }
    if (nonEnt.deploymentModelName !== undefined) {
        await upsertGlobalSetting("ai_deployment", nonEnt.deploymentModelName.trim());
    }

    // Enterprise config
    const ent = payload?.enterpriseConfig || {};
    if (ent.provider) {
        await upsertGlobalSetting("enterprise_ai_provider", ent.provider);
    }
    if (ent.apiKey && ent.apiKey.trim()) {
        await upsertGlobalSetting("enterprise_ai_api_key", encryptSecret(ent.apiKey.trim()));
    }
    if (ent.azureEndpointUrl !== undefined) {
        await upsertGlobalSetting("enterprise_ai_endpoint", ent.azureEndpointUrl.trim());
    }
    if (ent.deploymentModelName !== undefined) {
        await upsertGlobalSetting("enterprise_ai_deployment", ent.deploymentModelName.trim());
    }
    if (ent.resourceName !== undefined) {
        await upsertGlobalSetting("enterprise_ai_resource_name", ent.resourceName.trim());
    }

    // Sensitivity & defaults
    if (payload?.defaultAnomalySensitivity) {
        await upsertGlobalSetting("ai_anomaly_sensitivity", payload.defaultAnomalySensitivity.toLowerCase());
    }
    await upsertGlobalSetting("ai_share_resource_names", payload?.defaultShareResourceNames !== false ? "true" : "false");
    await upsertGlobalSetting("ai_share_tags", payload?.defaultShareTags !== false ? "true" : "false");

    invalidateAIConfigCache();
    return { success: true };
}

export async function deletePlatformAiApiKey(
    target: "non_enterprise" | "enterprise",
    _updatedBy: string,
    isMock = false
): Promise<{ success: boolean }> {
    if (isMock) {
        return { success: true };
    }

    await initializeDatabase();
    if (target === "enterprise") {
        await upsertGlobalSetting("enterprise_ai_api_key", "");
    } else {
        await upsertGlobalSetting("ai_api_key", "");
    }
    invalidateAIConfigCache();
    return { success: true };
}

export async function testPlatformAiConnection(
    payload: TestPlatformAiPayload,
    isMock = false
): Promise<TestPlatformAiResponse> {
    if (isMock) {
        return {
            success: true,
            reply: `OK (simulado: gateway ${payload.provider || "Azure IA"} activo con modelo ${payload.deploymentModelName || "gpt-5.1"}).`,
        };
    }

    try {
        invalidateAIConfigCache();
        const isEnterprise = payload.testType === "enterprise";
        const overrideConfig =
            payload.provider && payload.apiKey
                ? {
                      provider: payload.provider,
                      apiKey: payload.apiKey,
                      source: "platform" as const,
                      azureOpenAIEndpoint: payload.azureEndpointUrl,
                      azureOpenAIResourceName: payload.resourceName,
                      azureOpenAIDeployment: payload.deploymentModelName,
                  }
                : undefined;

        const { model, modelName, config } = await AIProviderFactory.getGeminiModel(
            undefined,
            isEnterprise,
            overrideConfig
        );

        const { text, usage } = await generateText({
            model: model as any,
            prompt: "Say OK.",
        });

        insertPlatformAiUsage({
            tenantId: null,
            source: config.source,
            provider: config.provider,
            modelName,
            feature: "admin-test-global",
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
        });

        return { success: true, reply: text.trim().slice(0, 100) };
    } catch (error: unknown) {
        const message = extractAiErrorMessage(error);
        return { success: false, error: message };
    }
}
