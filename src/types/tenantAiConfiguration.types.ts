/**
 * Contratos de la pestaña IA de Configuración Global.
 *
 * Regla de exposición: `ai_api_key` (cifrada con secretCrypto) NUNCA cruza al
 * cliente. La API expone `hasStoredApiKey` y `apiKeyMaskedHint` — los últimos
 * caracteres, que no permiten reconstruir la clave.
 */

export type LlmProviderType =
    | 'AZURE_OPENAI'
    | 'OPENAI_DIRECT'
    | 'ANTHROPIC_CLAUDE'
    | 'GOOGLE_VERTEX';

export type AnomalySensitivityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'STRICT';

export interface TenantAiSettings {
    tenantId: string;
    isAiEnabled: boolean;
    llmProvider: LlmProviderType;
    hasStoredApiKey: boolean;
    apiKeyMaskedHint?: string;
    azureEndpointUrl?: string;
    deploymentModelName?: string;
    anomalySensitivity: AnomalySensitivityLevel;
    shareResourceNames: boolean;
    shareTags: boolean;
    lastConnectionTestAt?: string;
    lastConnectionStatus?: 'SUCCESS' | 'FAILED';
    mock?: boolean;
}

export interface SaveAiSettingsPayload {
    isAiEnabled: boolean;
    llmProvider: LlmProviderType;
    /** Omitido o vacío = conservar la clave ya cifrada. `null` explícito = borrarla. */
    apiKey?: string | null;
    azureEndpointUrl?: string;
    deploymentModelName?: string;
    anomalySensitivity: AnomalySensitivityLevel;
    shareResourceNames: boolean;
    shareTags: boolean;
}

export interface TestAiConnectionResult {
    success: boolean;
    latencyMs: number;
    modelName?: string;
    message: string;
    testedAt: string;
}

/**
 * El ENUM en base es `('low','medium','high')` desde 20260719-001 y lo consume
 * `anomalyDetectionService` para elegir el umbral de Z-score. `STRICT` es un
 * nivel de UI que todavía no existe en la columna, así que se degrada a `high`
 * al persistir en vez de romper el INSERT — el usuario obtiene el umbral más
 * estricto disponible, que es lo que pidió.
 */
export const ANOMALY_SENSITIVITY_LEVELS: AnomalySensitivityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'STRICT'];

export const LLM_PROVIDERS: LlmProviderType[] = [
    'AZURE_OPENAI',
    'OPENAI_DIRECT',
    'ANTHROPIC_CLAUDE',
    'GOOGLE_VERTEX',
];

/** Mapa UI → valores que ya usa `Tenants.ai_provider` (`aiService.getAIConfig`). */
const PROVIDER_TO_DB: Record<LlmProviderType, string> = {
    AZURE_OPENAI: 'azure_openai',
    OPENAI_DIRECT: 'openai',
    ANTHROPIC_CLAUDE: 'anthropic',
    GOOGLE_VERTEX: 'google',
};

const DB_TO_PROVIDER: Record<string, LlmProviderType> = {
    azure_openai: 'AZURE_OPENAI',
    openai: 'OPENAI_DIRECT',
    chatgpt: 'OPENAI_DIRECT',
    anthropic: 'ANTHROPIC_CLAUDE',
    google: 'GOOGLE_VERTEX',
};

export function isLlmProvider(value: unknown): value is LlmProviderType {
    return typeof value === 'string' && (LLM_PROVIDERS as string[]).includes(value);
}

export function isAnomalySensitivity(value: unknown): value is AnomalySensitivityLevel {
    return typeof value === 'string' && (ANOMALY_SENSITIVITY_LEVELS as string[]).includes(value);
}

export function providerToDb(provider: LlmProviderType): string {
    return PROVIDER_TO_DB[provider] ?? 'system';
}

/** `system` y los proveedores no mapeados caen a Azure, el default de la plataforma. */
export function providerFromDb(raw: string | null | undefined): LlmProviderType {
    if (!raw) return 'AZURE_OPENAI';
    return DB_TO_PROVIDER[raw.toLowerCase()] ?? 'AZURE_OPENAI';
}

export function sensitivityToDb(level: AnomalySensitivityLevel): 'low' | 'medium' | 'high' {
    if (level === 'LOW') return 'low';
    if (level === 'MEDIUM') return 'medium';
    return 'high'; // HIGH y STRICT comparten el umbral más estricto disponible
}

export function sensitivityFromDb(raw: string | null | undefined): AnomalySensitivityLevel {
    const upper = (raw || 'medium').toUpperCase();
    return isAnomalySensitivity(upper) ? upper : 'MEDIUM';
}

/**
 * Pista no reversible de la clave: prefijo reconocible + últimos 4 caracteres.
 * Claves cortas se enmascaran por completo — mostrar 4 de 8 caracteres sería
 * filtrar la mitad del secreto.
 */
export function buildApiKeyHint(apiKey: string): string {
    const trimmed = apiKey.trim();
    if (trimmed.length < 12) return '••••';
    const prefix = trimmed.slice(0, 3);
    const suffix = trimmed.slice(-4);
    return `${prefix}...${suffix}`;
}
