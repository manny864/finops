// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { db, createAzureMock, chatMock, tokenProvider, insertUsageMock } = vi.hoisted(() => {
    const chatMock = vi.fn((deployment: string) => ({ deployment }));
    return {
        db: {
            tenant: null as Record<string, unknown> | null,
            settings: {} as Record<string, string>,
        },
        chatMock,
        createAzureMock: vi.fn((_options: Record<string, unknown>) => ({ chat: chatMock })),
        tokenProvider: async () => "token",
        insertUsageMock: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("FROM Tenants") && sql.includes("ai_provider")) return [db.tenant ? [db.tenant] : []];
            if (sql.includes("FROM GlobalSettings")) {
                return [Object.entries(db.settings).map(([setting_key, setting_value]) => ({ setting_key, setting_value }))];
            }
            return [[]];
        }),
    },
    insertPlatformAiUsage: insertUsageMock,
}));
vi.mock("@/lib/secretCrypto", () => ({ tryDecryptSecret: (value: string | null) => value || null }));
vi.mock("@azure/identity", () => ({
    ManagedIdentityCredential: vi.fn(),
    getBearerTokenProvider: vi.fn(() => tokenProvider),
}));
vi.mock("@ai-sdk/azure", () => ({ createAzure: createAzureMock }));
vi.mock("ai", () => ({
    generateText: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 3, outputTokens: 2 } })),
}));

import { getAIConfig, generateFinOpsReport } from "@/services/aiService";
import { AIProviderFactory, invalidateAIConfigCache } from "@/modules/core/aiProvider";

const MI = "mi-client-id";

function env(vars: Record<string, string>) {
    const base = {
        AZURE_KEYVAULT_MI_CLIENT_ID: "",
        AZURE_OPENAI_AUTH: "",
        AZURE_OPENAI_API_KEY: "",
        AZURE_AI_API_KEY: "",
        AZURE_OPENAI_ENDPOINT: "",
        AZURE_OPENAI_RESOURCE_NAME: "",
        AZURE_OPENAI_DEPLOYMENT: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
    };
    for (const [k, v] of Object.entries({ ...base, ...vars })) vi.stubEnv(k, v);
}

beforeEach(() => {
    db.tenant = null;
    db.settings = { ai_provider: "azure_openai" };
    createAzureMock.mockClear();
    chatMock.mockClear();
    insertUsageMock.mockClear();
    invalidateAIConfigCache();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("IA de plataforma con Managed Identity (Entra ID)", () => {
    it("sin key y con identidad usa Entra, con el recurso y el deployment que pone Terraform", async () => {
        env({
            AZURE_KEYVAULT_MI_CLIENT_ID: MI,
            AZURE_OPENAI_RESOURCE_NAME: "cscs-finops-prod-westus2-ai",
            AZURE_OPENAI_DEPLOYMENT: "gpt-5.4-mini",
        });
        db.settings.ai_deployment = "gpt-5.1";

        const config = await getAIConfig();
        expect(config).toMatchObject({
            provider: "azure_openai",
            apiKey: "",
            azureOpenAIEndpoint: "",
            azureOpenAIResourceName: "cscs-finops-prod-westus2-ai",
            azureOpenAIDeployment: "gpt-5.4-mini",
            authMode: "entra",
            source: "platform",
        });

        const { modelName } = await AIProviderFactory.getGeminiModel();
        expect(modelName).toBe("gpt-5.4-mini");
        expect(createAzureMock).toHaveBeenCalledWith({
            resourceName: "cscs-finops-prod-westus2-ai",
            tokenProvider,
        });
        expect(createAzureMock.mock.calls[0][0]).not.toHaveProperty("apiKey");
        expect(chatMock).toHaveBeenCalledWith("gpt-5.4-mini");
    });

    it("con key y sin AZURE_OPENAI_AUTH sigue con la key, como hoy", async () => {
        env({ AZURE_KEYVAULT_MI_CLIENT_ID: MI, AZURE_OPENAI_RESOURCE_NAME: "cscs-finops-prod-westus2-ai" });
        db.settings = {
            ai_provider: "azure_openai",
            ai_api_key: "global-key",
            enterprise_ai_resource_name: "recurso-manual",
            ai_deployment: "gpt-5.1",
        };

        const config = await getAIConfig();
        expect(config.authMode).toBeUndefined();
        expect(config.apiKey).toBe("global-key");

        await AIProviderFactory.getGeminiModel();
        expect(createAzureMock).toHaveBeenCalledWith({ apiKey: "global-key", resourceName: "recurso-manual" });
        expect(chatMock).toHaveBeenCalledWith("gpt-5.1");
    });

    it("con key y AZURE_OPENAI_AUTH=entra usa Entra; sin recurso en el entorno cae al de GlobalSettings", async () => {
        env({ AZURE_KEYVAULT_MI_CLIENT_ID: MI, AZURE_OPENAI_AUTH: "entra" });
        db.settings = {
            ai_provider: "azure_openai",
            ai_api_key: "global-key",
            enterprise_ai_resource_name: "recurso-manual",
            ai_deployment: "gpt-5.1",
        };

        const config = await getAIConfig();
        expect(config).toMatchObject({
            apiKey: "",
            authMode: "entra",
            azureOpenAIResourceName: "recurso-manual",
            azureOpenAIDeployment: "gpt-5.1",
        });

        await AIProviderFactory.getGeminiModel();
        expect(createAzureMock).toHaveBeenCalledWith({ resourceName: "recurso-manual", tokenProvider });
    });

    it("sin identidad (desarrollo local) AZURE_OPENAI_AUTH no cambia nada", async () => {
        env({ AZURE_OPENAI_AUTH: "entra", AZURE_OPENAI_API_KEY: "env-key", AZURE_OPENAI_RESOURCE_NAME: "recurso" });

        const config = await getAIConfig();
        expect(config.authMode).toBeUndefined();
        expect(config.apiKey).toBe("env-key");

        await AIProviderFactory.getGeminiModel();
        expect(createAzureMock).toHaveBeenCalledWith({ apiKey: "env-key", resourceName: "recurso" });
    });

    it("sin identidad y sin key sigue fallando como hoy", async () => {
        env({ AZURE_OPENAI_RESOURCE_NAME: "recurso" });
        await expect(AIProviderFactory.getGeminiModel()).rejects.toThrow("AI API Key not configured.");
        await expect(generateFinOpsReport("t1", {})).rejects.toThrow("AI API Key not configured");
    });

    it("BYOK nunca usa la identidad, aunque esté el flag", async () => {
        env({ AZURE_KEYVAULT_MI_CLIENT_ID: MI, AZURE_OPENAI_AUTH: "entra", AZURE_OPENAI_RESOURCE_NAME: "cscs-finops-prod-westus2-ai" });
        db.tenant = {
            tier: "Professional",
            ai_provider: "azure_openai",
            ai_api_key: "tenant-key",
            ai_endpoint: "https://cliente.openai.azure.com",
            ai_deployment: "gpt-4o",
        };

        const config = await getAIConfig("t1");
        expect(config.source).toBe("byok");
        expect(config.authMode).toBeUndefined();
        expect(config.apiKey).toBe("tenant-key");

        await AIProviderFactory.getGeminiModel("t1");
        expect(createAzureMock).not.toHaveBeenCalled();
    });

    it("otro proveedor de plataforma no usa la identidad", async () => {
        env({ AZURE_KEYVAULT_MI_CLIENT_ID: MI, AZURE_OPENAI_AUTH: "entra" });
        db.settings = { ai_provider: "google" };

        const config = await getAIConfig();
        expect(config.authMode).toBeUndefined();
        await expect(AIProviderFactory.getGeminiModel()).rejects.toThrow("AI API Key not configured.");
    });

    it("Entra sin nombre de recurso falla con un error que dice qué falta", async () => {
        env({ AZURE_KEYVAULT_MI_CLIENT_ID: MI });
        await expect(AIProviderFactory.getGeminiModel()).rejects.toThrow(/AZURE_OPENAI_RESOURCE_NAME/);
    });

    it("el reporte ejecutivo funciona con Entra y sigue registrando el uso de plataforma", async () => {
        env({
            AZURE_KEYVAULT_MI_CLIENT_ID: MI,
            AZURE_OPENAI_RESOURCE_NAME: "cscs-finops-prod-westus2-ai",
            AZURE_OPENAI_DEPLOYMENT: "gpt-5.4-mini",
        });

        await expect(generateFinOpsReport("t1", { cost: 1 })).resolves.toBe("ok");
        expect(createAzureMock).toHaveBeenCalledWith({ resourceName: "cscs-finops-prod-westus2-ai", tokenProvider });
        expect(insertUsageMock).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: "t1", source: "platform", provider: "azure_openai", modelName: "gpt-5.4-mini" })
        );
    });
});
