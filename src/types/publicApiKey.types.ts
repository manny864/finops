/**
 * Tipos y contratos TypeScript estrictos para la API Pública REST v1.
 */

/**
 * Fuente única de los scopes que se pueden otorgar. El tipo se deriva de acá, y
 * el panel de claves y la validación del alta leen la misma lista: un scope que
 * una ruta exige con `requireScope` pero que no está acá no se puede otorgar
 * desde ningún lado (le pasó a `write:shift-left`).
 */
export const PUBLIC_API_SCOPES = [
    "read:cost",
    "read:resources",
    "read:budgets",
    "read:recommendations",
    "read:anomalies",
    "write:metrics",
    "write:shift-left",
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export interface PublicApiKeyItem {
    id: string;
    tenantId: string;
    name: string;
    keyPrefix: string;
    maskedKey: string;
    rateLimitPerMinute: number;
    scopes: PublicApiScope[];
    lastUsedAtIso?: string | null;
    createdByEmail: string;
    createdAtIso: string;
    formattedCreatedAt: string;
    isRevoked: boolean;
    revokedAtIso?: string | null;
}

export interface CreatePublicApiKeyPayload {
    tenantId: string;
    name: string;
    rateLimitPerMinute: number;
    scopes: PublicApiScope[];
}

export interface CreatePublicApiKeyResponse {
    success: boolean;
    rawKey: string;
    keyItem: PublicApiKeyItem;
    warning?: string;
}
