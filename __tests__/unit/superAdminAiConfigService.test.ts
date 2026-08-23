// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getPlatformGlobalAiSettings,
    savePlatformGlobalAiSettings,
    deletePlatformAiApiKey,
    testPlatformAiConnection,
} from "@/services/superAdminAiConfig.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: mocks.mockPoolQuery,
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
    insertPlatformAiUsage: vi.fn(),
}));

vi.mock("@/lib/secretCrypto", () => ({
    encryptSecret: vi.fn((s: string) => `encrypted_${s}`),
    decryptSecret: vi.fn((s: string) => s.replace("encrypted_", "")),
}));

vi.mock("@/modules/core/aiProvider", () => ({
    AIProviderFactory: {
        getGeminiModel: vi.fn().mockResolvedValue({
            model: {},
            modelName: "test-model",
            config: { source: "platform", provider: "azure_openai" },
        }),
    },
    invalidateAIConfigCache: vi.fn(),
    extractAiErrorMessage: vi.fn((e: any) => e?.message || "Unknown error"),
}));

describe("superAdminAiConfig.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("getPlatformGlobalAiSettings returns mock settings when isMock is true", async () => {
        const settings = await getPlatformGlobalAiSettings(true);

        expect(settings.isPlatformMasterAiEnabled).toBe(true);
        expect(settings.nonEnterpriseConfig.provider).toBe("anthropic");
        expect(settings.nonEnterpriseConfig.deploymentModelName).toBe("claude-3-5-sonnet");
        expect(settings.enterpriseConfig.provider).toBe("azure_openai");
        expect(settings.enterpriseConfig.deploymentModelName).toBe("gpt-5.1");
        expect(settings.defaultAnomalySensitivity).toBe("MEDIUM");
    });

    it("savePlatformGlobalAiSettings executes correctly in mock mode", async () => {
        const result = await savePlatformGlobalAiSettings(
            {
                isPlatformMasterAiEnabled: true,
                nonEnterpriseConfig: {
                    provider: "anthropic",
                    deploymentModelName: "claude-3-5-sonnet",
                },
                enterpriseConfig: {
                    provider: "azure_openai",
                    deploymentModelName: "gpt-5.1",
                },
                defaultAnomalySensitivity: "HIGH",
                defaultShareResourceNames: true,
                defaultShareTags: true,
            },
            "superadmin@cscloudsolutions.com",
            true
        );

        expect(result.success).toBe(true);
    });

    it("deletePlatformAiApiKey resets enterprise key in database", async () => {
        mocks.mockPoolQuery.mockResolvedValueOnce([{}]);

        const result = await deletePlatformAiApiKey("enterprise", "superadmin@cscloudsolutions.com", false);

        expect(result.success).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO GlobalSettings"),
            ["enterprise_ai_api_key", ""]
        );
    });

    it("testPlatformAiConnection returns simulated pong when isMock is true", async () => {
        const result = await testPlatformAiConnection(
            {
                testType: "enterprise",
                provider: "azure_openai",
                deploymentModelName: "gpt-5.1",
            },
            true
        );

        expect(result.success).toBe(true);
        expect(result.reply).toContain("OK");
    });
});
