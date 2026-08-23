/**
 * Tipos y contratos TypeScript estrictos para la API Pública REST v1.
 */

export type PublicApiScope =
    | "read:cost"
    | "read:resources"
    | "read:budgets"
    | "read:recommendations"
    | "read:anomalies"
    | "write:metrics";

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
