import { getBearerTokenProvider, ManagedIdentityCredential } from "@azure/identity";

/**
 * Token de Entra ID para Azure AI (OpenAI y Document Intelligence) con la
 * identidad user-assigned del stamp, la misma que lee Key Vault.
 *
 * ManagedIdentityCredential directo y no DefaultAzureCredential: el proceso
 * tiene AZURE_CLIENT_ID del app registration multitenant y la cadena lo
 * tomaría primero (ver src/lib/secrets/keyvault.ts).
 */
const SCOPE = "https://cognitiveservices.azure.com/.default";

let provider: (() => Promise<string>) | undefined;

/** Fuera de Azure (local, VPS) no hay identidad administrada. */
export const hasAiManagedIdentity = (): boolean => Boolean(process.env.AZURE_KEYVAULT_MI_CLIENT_ID);

export function cognitiveServicesTokenProvider(): () => Promise<string> {
    provider ??= getBearerTokenProvider(
        new ManagedIdentityCredential({ clientId: process.env.AZURE_KEYVAULT_MI_CLIENT_ID }),
        SCOPE
    );
    return provider;
}
