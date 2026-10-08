// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getPlatformGlobalAiSettings,
    savePlatformGlobalAiSettings,
    deletePlatformAiApiKey,
    testPlatformAiConnection,
} from "@/services/superAdminAiConfig.service";
import { AI_FEATURES, type AiFeature } from "@/lib/aiFeatureGate";

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
        expect(settings.nonEnterpriseConfig.provider).toBe("azure_openai");
        expect(settings.nonEnterpriseConfig.deploymentModelName).toBe("gpt-4o-mini");
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

    describe("interruptores por feature", () => {
        const settingsRows = (rows: Array<[string, string]>) =>
            mocks.mockPoolQuery.mockImplementation(async (sql: string) =>
                sql.includes("SELECT setting_key")
                    ? [rows.map(([setting_key, setting_value]) => ({ setting_key, setting_value }))]
                    : [{}]
            );

        it("sin valor guardado devuelve el default de cada feature", async () => {
            settingsRows([]);
            const settings = await getPlatformGlobalAiSettings(false);
            for (const [feature, cfg] of Object.entries(AI_FEATURES)) {
                expect(settings.featureSwitches[feature as AiFeature]).toBe(cfg.defaultEnabled);
            }
            const [, params] = mocks.mockPoolQuery.mock.calls.find(([sql]) => sql.includes("SELECT setting_key"))!;
            expect(params).toContain("ai_feature:anomaly-explanation");
        });

        it("un 'false' guardado apaga sólo esa feature", async () => {
            settingsRows([["ai_feature:anomaly-explanation", "false"]]);
            const settings = await getPlatformGlobalAiSettings(false);
            expect(settings.featureSwitches["anomaly-explanation"]).toBe(false);
            expect(settings.featureSwitches["billing-csv-column-mapping"]).toBe(true);
        });

        it("guarda las features conocidas e ignora las desconocidas", async () => {
            settingsRows([]);
            await savePlatformGlobalAiSettings(
                {
                    isPlatformMasterAiEnabled: true,
                    nonEnterpriseConfig: { provider: "azure_openai", deploymentModelName: "gpt-4o-mini" },
                    enterpriseConfig: { provider: "azure_openai", deploymentModelName: "gpt-5.1" },
                    defaultAnomalySensitivity: "MEDIUM",
                    defaultShareResourceNames: true,
                    defaultShareTags: true,
                    featureSwitches: { "anomaly-explanation": false, "no-existe": true } as never,
                },
                "superadmin@cscloudsolutions.com",
                false
            );
            const upserts = mocks.mockPoolQuery.mock.calls
                .filter(([sql]) => sql.includes("INSERT INTO GlobalSettings"))
                .map(([, params]) => params);
            expect(upserts).toContainEqual(["ai_feature:anomaly-explanation", "false"]);
            expect(upserts.some(([key]) => key === "ai_feature:no-existe")).toBe(false);
        });
    });
});
