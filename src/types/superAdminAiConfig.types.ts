/**
 * Tipos y contratos TypeScript para la Gobernanza y Configuración Global de IA (SuperAdmin).
 */

export type AnomalySensitivityLevel = "LOW" | "MEDIUM" | "HIGH" | "STRICT";

export interface PlatformAiProviderConfig {
    provider: string;
    hasStoredApiKey: boolean;
    azureEndpointUrl?: string;
    deploymentModelName: string;
    resourceName?: string;
}

export interface PlatformGlobalAiSettings {
    isPlatformMasterAiEnabled: boolean;
    nonEnterpriseConfig: PlatformAiProviderConfig;
    enterpriseConfig: PlatformAiProviderConfig;
    defaultAnomalySensitivity: AnomalySensitivityLevel;
    defaultShareResourceNames: boolean;
    defaultShareTags: boolean;
    updatedAtIso?: string;
}

export interface SavePlatformAiPayload {
    isPlatformMasterAiEnabled: boolean;
    nonEnterpriseConfig: {
        provider: string;
        apiKey?: string;
        azureEndpointUrl?: string;
        deploymentModelName: string;
        resourceName?: string;
    };
    enterpriseConfig: {
        provider: string;
        apiKey?: string;
        azureEndpointUrl?: string;
        deploymentModelName: string;
        resourceName?: string;
    };
    defaultAnomalySensitivity: string;
    defaultShareResourceNames: boolean;
    defaultShareTags: boolean;
}

export interface TestPlatformAiPayload {
    testType: "non_enterprise" | "enterprise";
    provider?: string;
    apiKey?: string;
    azureEndpointUrl?: string;
    deploymentModelName?: string;
    resourceName?: string;
}

export interface TestPlatformAiResponse {
    success: boolean;
    reply?: string;
    error?: string;
}
