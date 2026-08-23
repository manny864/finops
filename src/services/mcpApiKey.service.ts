/**
 * Servicio para gestión y autenticación criptográfica de MCP API Keys.
 *
 * Sigue el patrón Zero-Knowledge Storage:
 *   - Al crear una key, se devuelve el texto plano UNA ÚNICA VEZ.
 *   - En la base de datos sólo se persiste el hash criptográfico SHA-256 y el prefijo.
 *   - Soporte para Demo tenants con datos sintéticos aislados.
 */

import crypto from "crypto";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { McpApiKeyItem, CreateMcpKeyResponse } from "@/types/mcpApiKey.types";

/**
 * Calcula el hash SHA-256 de una key.
 */
export function hashMcpKey(plainKey: string): string {
    return crypto.createHash("sha256").update(plainKey.trim()).digest("hex");
}

/**
 * Genera una nueva MCP API Key criptográficamente segura.
 */
export function generateSecureMcpToken(): { rawKey: string; prefix: string; hash: string } {
    const randomHex = crypto.randomBytes(24).toString("hex");
    const rawKey = `mcp_live_${randomHex}`;
    const prefix = rawKey.slice(0, 14); // ej. 'mcp_live_4a1b'
    const hash = hashMcpKey(rawKey);
    return { rawKey, prefix, hash };
}

/**
 * Enmascara una clave para visualización segura en la interfaz.
 */
export function maskMcpKey(prefix: string, rawKeyOrHash?: string): string {
    const end = rawKeyOrHash ? rawKeyOrHash.slice(-4) : "••••";
    return `${prefix}••••••••${end}`;
}

/**
 * Obtiene las keys sintéticas de demostración para un mock tenant.
 */
function getMockMcpKeys(tenantId: string): McpApiKeyItem[] {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 86400000);
    const twelveMinAgo = new Date(now.getTime() - 12 * 60000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600000);

    return [
        {
            id: "mock-key-1",
            tenantId,
            name: "Claude Desktop Demo",
            keyPrefix: "mcp_live_4a1b",
            maskedKey: "mcp_live_••••••••4a1b",
            lastUsedAtIso: twelveMinAgo.toISOString(),
            expiresAtIso: null,
            createdByEmail: "admin@cscloudsolutions.com",
            createdAtIso: twoWeeksAgo.toISOString(),
            formattedCreatedAt: twoWeeksAgo.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
            isRevoked: false,
            revokedAtIso: null,
        },
        {
            id: "mock-key-2",
            tenantId,
            name: "Power BI Production Feed",
            keyPrefix: "mcp_live_8e2c",
            maskedKey: "mcp_live_••••••••8e2c",
            lastUsedAtIso: twoHoursAgo.toISOString(),
            expiresAtIso: null,
            createdByEmail: "finops.lead@cscloudsolutions.com",
            createdAtIso: oneMonthAgo.toISOString(),
            formattedCreatedAt: oneMonthAgo.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
            isRevoked: false,
            revokedAtIso: null,
        },
    ];
}

/**
 * Lista todas las MCP API Keys de un tenant.
 */
export async function listMcpKeys(tenantId: string): Promise<McpApiKeyItem[]> {
    if (!tenantId) return [];

    if (isMockTenant(tenantId)) {
        return getMockMcpKeys(tenantId);
    }

    const [rows]: any = await pool.query(
        `SELECT id, tenant_id, key_prefix, label, created_by_email, created_at, last_used_at, revoked_at FROM MCPApiKeys WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
        [tenantId]
    );

    return (rows || []).map((row: any): McpApiKeyItem => {
        const createdAt = row.created_at ? new Date(row.created_at) : new Date();
        const lastUsedAt = row.last_used_at ? new Date(row.last_used_at).toISOString() : null;
        const revokedAt = row.revoked_at ? new Date(row.revoked_at).toISOString() : null;
        const prefix = row.key_prefix || "mcp_live_";

        return {
            id: String(row.id),
            tenantId: row.tenant_id,
            name: row.label || "Sin etiqueta",
            keyPrefix: prefix,
            maskedKey: maskMcpKey(prefix),
            lastUsedAtIso: lastUsedAt,
            expiresAtIso: null,
            createdByEmail: row.created_by_email || "Administrador",
            createdAtIso: createdAt.toISOString(),
            formattedCreatedAt: createdAt.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            }),
            isRevoked: Boolean(row.revoked_at),
            revokedAtIso: revokedAt,
        };
    });
}

/**
 * Crea una nueva MCP API Key para un tenant.
 */
export async function createMcpKey(
    tenantId: string,
    name: string,
    createdByEmail: string
): Promise<CreateMcpKeyResponse> {
    if (!tenantId || !name.trim()) {
        throw new Error("Falta tenantId o nombre descriptivo para la API key");
    }

    const { rawKey, prefix, hash } = generateSecureMcpToken();

    if (isMockTenant(tenantId)) {
        const now = new Date();
        const keyItem: McpApiKeyItem = {
            id: `mock-key-${Date.now()}`,
            tenantId,
            name: name.trim(),
            keyPrefix: prefix,
            maskedKey: maskMcpKey(prefix, rawKey),
            lastUsedAtIso: null,
            expiresAtIso: null,
            createdByEmail: createdByEmail || "demo.user@cscloudsolutions.com",
            createdAtIso: now.toISOString(),
            formattedCreatedAt: now.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            }),
            isRevoked: false,
            revokedAtIso: null,
        };

        return {
            success: true,
            rawKey,
            keyItem,
            warning: "Tenant en modo Demo: key sintética generada para pruebas.",
        };
    }

    const [result]: any = await pool.query(
        `INSERT INTO MCPApiKeys (tenant_id, key_prefix, key_hash, label, created_by_email) VALUES (?, ?, ?, ?, ?)`,
        [tenantId, prefix, hash, name.trim(), createdByEmail || ""]
    );

    const insertId = result?.insertId;
    const now = new Date();

    const keyItem: McpApiKeyItem = {
        id: String(insertId),
        tenantId,
        name: name.trim(),
        keyPrefix: prefix,
        maskedKey: maskMcpKey(prefix, rawKey),
        lastUsedAtIso: null,
        expiresAtIso: null,
        createdByEmail: createdByEmail || "",
        createdAtIso: now.toISOString(),
        formattedCreatedAt: now.toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }),
        isRevoked: false,
        revokedAtIso: null,
    };

    return {
        success: true,
        rawKey,
        keyItem,
        warning: "Guardá este key ahora — no se puede recuperar después.",
    };
}

/**
 * Revoca una MCP API Key existente.
 */
export async function revokeMcpKey(tenantId: string, keyId: string | number): Promise<boolean> {
    if (!tenantId || !keyId) return false;

    if (isMockTenant(tenantId)) {
        return true;
    }

    const [result]: any = await pool.query(
        `UPDATE MCPApiKeys SET revoked_at = NOW() WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`,
        [keyId, tenantId]
    );

    return (result?.affectedRows ?? 0) > 0;
}

/**
 * Valida un token MCP contra la base de datos y actualiza `last_used_at`.
 */
export async function authenticateMcpToken(
    rawToken: string
): Promise<{ tenantId: string; keyId: number } | null> {
    if (!rawToken || (!rawToken.startsWith("mcp_") && !rawToken.startsWith("mcp_live_"))) {
        return null;
    }

    const hash = hashMcpKey(rawToken);

    try {
        const [rows]: any = await pool.query(
            `SELECT id, tenant_id FROM MCPApiKeys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1`,
            [hash]
        );

        const arr = rows as Array<{ id: number; tenant_id: string }>;
        if (!arr || arr.length === 0) return null;

        const key = arr[0];
        // Fire-and-forget timestamp update
        void pool.query(`UPDATE MCPApiKeys SET last_used_at = NOW() WHERE id = ?`, [key.id]).catch(() => {});

        return { tenantId: key.tenant_id, keyId: key.id };
    } catch {
        return null;
    }
}
