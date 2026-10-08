// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { credentialMock, providerMock } = vi.hoisted(() => ({
    credentialMock: vi.fn(),
    providerMock: vi.fn(() => async () => "token"),
}));
vi.mock("@azure/identity", () => ({
    ManagedIdentityCredential: credentialMock,
    getBearerTokenProvider: providerMock,
}));

beforeEach(() => {
    vi.resetModules();
    credentialMock.mockClear();
    providerMock.mockClear();
});

describe("azureAiCredential", () => {
    it("usa la identidad del stamp con el scope de Cognitive Services, una sola vez", async () => {
        vi.stubEnv("AZURE_KEYVAULT_MI_CLIENT_ID", "mi-client-id");
        const { cognitiveServicesTokenProvider } = await import("@/lib/azureAiCredential");
        const first = cognitiveServicesTokenProvider();
        expect(cognitiveServicesTokenProvider()).toBe(first);
        expect(credentialMock).toHaveBeenCalledTimes(1);
        expect(credentialMock).toHaveBeenCalledWith({ clientId: "mi-client-id" });
        expect(providerMock).toHaveBeenCalledWith(expect.anything(), "https://cognitiveservices.azure.com/.default");
        vi.unstubAllEnvs();
    });

    it("sin AZURE_KEYVAULT_MI_CLIENT_ID no hay identidad administrada", async () => {
        vi.stubEnv("AZURE_KEYVAULT_MI_CLIENT_ID", "");
        const { hasAiManagedIdentity } = await import("@/lib/azureAiCredential");
        expect(hasAiManagedIdentity()).toBe(false);
        vi.unstubAllEnvs();
    });
});
