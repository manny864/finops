/**
 * Tipos y contratos para MCP (Model Context Protocol) API Keys.
 */

export interface McpApiKeyItem {
    id: string | number;
    tenantId: string;
    name: string;
    keyPrefix: string;
    maskedKey: string;
    lastUsedAtIso?: string | null;
    expiresAtIso?: string | null;
    createdByEmail: string;
    createdAtIso: string;
    formattedCreatedAt: string;
    isRevoked: boolean;
    revokedAtIso?: string | null;
}

export interface CreateMcpKeyPayload {
    tenantId: string;
    name: string;
}

export interface CreateMcpKeyResponse {
    success: boolean;
    rawKey: string;
    keyItem: McpApiKeyItem;
    warning?: string;
}

export interface McpServerCapabilities {
    tools: {
        name: string;
        description: string;
        inputSchema: {
            type: string;
            properties: Record<string, unknown>;
            required?: string[];
        };
    }[];
}
