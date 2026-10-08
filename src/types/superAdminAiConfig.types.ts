/**
 * Tipos y contratos TypeScript para la Gobernanza y Configuración Global de IA (SuperAdmin).
 */
import type { AiFeature } from "@/lib/aiFeatureGate";

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
    /** Interruptor de cada feature del gate de IA (`aiFeatureGate.ts`), ya resuelto con su default. */
    featureSwitches: Record<AiFeature, boolean>;
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
    /** Sólo se guardan las features que vienen; las desconocidas se ignoran. */
    featureSwitches?: Partial<Record<AiFeature, boolean>>;
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
