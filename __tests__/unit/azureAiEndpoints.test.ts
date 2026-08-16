import { describe, it, expect, vi } from "vitest";
import { resolveAzureAiModel } from "@/modules/core/aiProvider";

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn().mockResolvedValue([[]]) },
    insertPlatformAiUsage: vi.fn(),
}));

describe("Azure AI Endpoints & Anthropic Resolver", () => {
    it("should correctly resolve Anthropic on Azure AI Foundry with full messages endpoint", () => {
        const result = resolveAzureAiModel({
            apiKey: "test-azure-ai-key",
            azureOpenAIEndpoint: "https://mchavez-8282-resource.services.ai.azure.com/anthropic/v1/messages",
            azureOpenAIDeployment: "claude-3-5-sonnet",
            provider: "azure_openai"
        });

        expect(result).toBeDefined();
        expect(result.modelName).toBe("claude-3-5-sonnet");
        expect(result.model).toBeDefined();
    });

    it("should correctly resolve Anthropic on Azure AI Foundry with root /anthropic path", () => {
        const result = resolveAzureAiModel({
            apiKey: "test-azure-ai-key",
            azureOpenAIEndpoint: "https://mchavez-8282-resource.services.ai.azure.com/anthropic",
            azureOpenAIDeployment: "claude-3-5-haiku",
            provider: "anthropic"
        });

        expect(result).toBeDefined();
        expect(result.modelName).toBe("claude-3-5-haiku");
    });

    it("should correctly resolve Azure AI Model Catalog / Serverless endpoint", () => {
        const result = resolveAzureAiModel({
            apiKey: "test-azure-ai-key",
            azureOpenAIEndpoint: "https://mchavez-8282-resource.services.ai.azure.com/models",
            azureOpenAIDeployment: "DeepSeek-R1",
            provider: "azure_openai"
        });

        expect(result).toBeDefined();
        expect(result.modelName).toBe("DeepSeek-R1");
        expect(result.model).toBeDefined();
    });

    it("should correctly resolve standard Azure OpenAI endpoint", () => {
        const result = resolveAzureAiModel({
            apiKey: "test-azure-ai-key",
            azureOpenAIEndpoint: "https://my-resource.openai.azure.com",
            azureOpenAIDeployment: "gpt-4o",
            provider: "azure_openai"
        });

        expect(result).toBeDefined();
        expect(result.modelName).toBe("gpt-4o");
    });

    it("should correctly resolve Azure OpenAI using resourceName", () => {
        const result = resolveAzureAiModel({
            apiKey: "test-azure-ai-key",
            azureOpenAIResourceName: "my-azure-resource",
            azureOpenAIDeployment: "gpt-4o-mini",
            provider: "azure_openai"
        });

        expect(result).toBeDefined();
        expect(result.modelName).toBe("gpt-4o-mini");
    });

    it("should throw a clear error when neither endpoint nor resource name is provided", () => {
        expect(() => {
            resolveAzureAiModel({
                apiKey: "test-key",
                provider: "azure_openai"
            });
        }).toThrow("Azure AI / Azure OpenAI no configurado");
    });
});
