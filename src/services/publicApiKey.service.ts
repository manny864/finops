/**
 * Servicio para gestión y ciclo de vida de claves de API Pública REST v1.
 *
 * Sigue el patrón Zero-Knowledge Storage:
 *   - Clave pública devuelta en texto plano UNA ÚNICA VEZ en la creación.
 *   - Base de datos persiste exclusivamente el hash criptográfico SHA-256 y el prefijo.
 *   - Soporte para Demo tenants con datos sintéticos aislados.
 */

import crypto from "crypto";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import {
    PublicApiScope,
    PublicApiKeyItem,
    CreatePublicApiKeyPayload,
    CreatePublicApiKeyResponse,
} from "@/types/publicApiKey.types";

/**
 * Calcula el hash SHA-256 de una API key pública.
 */
export function hashPublicApiKey(plainKey: string): string {
    return crypto.createHash("sha256").update(plainKey.trim()).digest("hex");
}

/**
 * Genera una nueva API key pública criptográficamente segura.
 */
export function generatePublicApiKeyToken(): { rawKey: string; prefix: string; hash: string } {
    const randomHex = crypto.randomBytes(32).toString("hex");
    const rawKey = `pak_live_${randomHex}`;
    const prefix = rawKey.slice(0, 14); // ej. 'pak_live_7e8f'
    const hash = hashPublicApiKey(rawKey);
    return { rawKey, prefix, hash };
}

/**
 * Enmascara una API key para visualización segura en la interfaz.
 */
export function maskPublicApiKey(prefix: string, rawKeyOrHash?: string): string {
    const end = rawKeyOrHash ? rawKeyOrHash.slice(-4) : "••••";
    return `${prefix}••••••••${end}`;
}

/**
 * Retorna las API keys sintéticas de demostración para tenants demo.
 */
function getMockPublicApiKeys(tenantId: string): PublicApiKeyItem[] {
    const now = new Date();
    const threeWeeksAgo = new Date(now.getTime() - 21 * 86400000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 86400000);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60000);

    return [
        {
            id: "mock-pub-key-1",
            tenantId,
            name: "Production FinOps Pipeline",
            keyPrefix: "pak_live_7e8f",
            maskedKey: "pak_live_••••••••7e8f",
            rateLimitPerMinute: 120,
            scopes: ["read:cost", "read:resources", "read:budgets"],
            lastUsedAtIso: fiveMinAgo.toISOString(),
            createdByEmail: "devops.lead@cscloudsolutions.com",
            createdAtIso: threeWeeksAgo.toISOString(),
            formattedCreatedAt: threeWeeksAgo.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            }),
            isRevoked: false,
            revokedAtIso: null,
        },
        {
            id: "mock-pub-key-2",
            tenantId,
            name: "CI/CD Cost Gate",
            keyPrefix: "pak_live_9a0b",
            maskedKey: "pak_live_••••••••9a0b",
            rateLimitPerMinute: 60,
            scopes: ["read:cost", "read:anomalies"],
            lastUsedAtIso: oneHourAgo.toISOString(),
            createdByEmail: "pipeline.bot@cscloudsolutions.com",
            createdAtIso: twoMonthsAgo.toISOString(),
            formattedCreatedAt: twoMonthsAgo.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            }),
            isRevoked: false,
            revokedAtIso: null,
        },
    ];
}

/**
 * Lista todas las API keys públicas registradas para un tenant.
 */
export async function listPublicApiKeys(tenantId: string): Promise<PublicApiKeyItem[]> {
    if (!tenantId) return [];

    if (isMockTenant(tenantId)) {
        return getMockPublicApiKeys(tenantId);
    }

    const [rows]: any = await pool.query(
        `SELECT id, tenant_id, name, key_prefix, scopes, rate_limit_per_min, enabled, last_used_at, created_by, created_at FROM PublicApiKeys WHERE tenant_id = ? ORDER BY created_at DESC`,
        [tenantId]
    );

    return (rows || []).map((row: any): PublicApiKeyItem => {
        const createdAt = row.created_at ? new Date(row.created_at) : new Date();
        const lastUsedAt = row.last_used_at ? new Date(row.last_used_at).toISOString() : null;
        const prefix = row.key_prefix || "pak_live_";

        let parsedScopes: PublicApiScope[] = ["read:cost", "read:resources"];
        try {
            if (typeof row.scopes === "string") {
                parsedScopes = JSON.parse(row.scopes);
            } else if (Array.isArray(row.scopes)) {
                parsedScopes = row.scopes;
            }
        } catch {
            /* noop */
        }

        return {
            id: String(row.id),
            tenantId: row.tenant_id,
            name: row.name || "Sin nombre",
            keyPrefix: prefix,
            maskedKey: maskPublicApiKey(prefix),
            rateLimitPerMinute: Number(row.rate_limit_per_min) || 60,
            scopes: parsedScopes,
            lastUsedAtIso: lastUsedAt,
            createdByEmail: row.created_by || "Administrador",
            createdAtIso: createdAt.toISOString(),
            formattedCreatedAt: createdAt.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            }),
            isRevoked: row.enabled === 0 || row.enabled === false,
            revokedAtIso: null,
        };
    });
}

/**
 * Crea una nueva API key pública para un tenant.
 */
export async function createPublicApiKey(
    payload: CreatePublicApiKeyPayload,
    createdByEmail: string
): Promise<CreatePublicApiKeyResponse> {
    const { tenantId, name, rateLimitPerMinute, scopes } = payload;

    if (!tenantId || !name?.trim()) {
        throw new Error("Falta tenantId o nombre descriptivo para la API key");
    }

    const { rawKey, prefix, hash } = generatePublicApiKeyToken();
    const rateLimit = Math.min(Math.max(Number(rateLimitPerMinute) || 60, 10), 600);
    const validScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : (["read:cost", "read:resources"] as PublicApiScope[]);

    if (isMockTenant(tenantId)) {
        const now = new Date();
        const keyItem: PublicApiKeyItem = {
            id: `mock-pub-key-${Date.now()}`,
            tenantId,
            name: name.trim(),
            keyPrefix: prefix,
            maskedKey: maskPublicApiKey(prefix, rawKey),
            rateLimitPerMinute: rateLimit,
            scopes: validScopes,
            lastUsedAtIso: null,
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
            warning: "Tenant en modo Demo: key pública sintética generada para pruebas.",
        };
    }

    const [result]: any = await pool.query(
        `INSERT INTO PublicApiKeys (tenant_id, name, key_hash, key_prefix, scopes, rate_limit_per_min, created_by, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
            tenantId,
            name.trim(),
            hash,
            prefix,
            JSON.stringify(validScopes),
            rateLimit,
            createdByEmail || "admin@cscloudsolutions.com",
        ]
    );

    const insertId = result?.insertId;
    const now = new Date();

    const keyItem: PublicApiKeyItem = {
        id: String(insertId),
        tenantId,
        name: name.trim(),
        keyPrefix: prefix,
        maskedKey: maskPublicApiKey(prefix, rawKey),
        rateLimitPerMinute: rateLimit,
        scopes: validScopes,
        lastUsedAtIso: null,
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
        warning: "Guardá esta clave en tus secretos de CI/CD. Por motivos de seguridad, no volverá a mostrarse completa.",
    };
}

/**
 * Revoca (deshabilita) una API key pública existente.
 */
export async function revokePublicApiKey(tenantId: string, keyId: string | number): Promise<boolean> {
    if (!tenantId || !keyId) return false;

    if (isMockTenant(tenantId)) {
        return true;
    }

    const [result]: any = await pool.query(
        `UPDATE PublicApiKeys SET enabled = FALSE WHERE id = ? AND tenant_id = ?`,
        [keyId, tenantId]
    );

    return (result?.affectedRows ?? 0) > 0;
}

/**
 * Valida un token público contra la base de datos y actualiza `last_used_at`.
 */
export async function authenticatePublicApiKeyToken(
    rawToken: string
): Promise<{ tenantId: string; keyId: number; name: string; scopes: PublicApiScope[]; rateLimitPerMin: number } | null> {
    if (!rawToken || !rawToken.startsWith("pak_")) {
        return null;
    }

    const hash = hashPublicApiKey(rawToken);

    try {
        const [rows]: any = await pool.query(
            `SELECT id, tenant_id, name, scopes, rate_limit_per_min FROM PublicApiKeys WHERE key_hash = ? AND enabled = TRUE LIMIT 1`,
            [hash]
        );

        const arr = rows as Array<{
            id: number;
            tenant_id: string;
            name: string;
            scopes: string;
            rate_limit_per_min: number;
        }>;

        if (!arr || arr.length === 0) return null;

        const key = arr[0];
        let scopes: PublicApiScope[] = [];
        try {
            scopes = typeof key.scopes === "string" ? JSON.parse(key.scopes) : key.scopes;
        } catch {
            scopes = [];
        }

        // Fire-and-forget timestamp update
        void pool.query(`UPDATE PublicApiKeys SET last_used_at = NOW() WHERE id = ?`, [key.id]).catch(() => {});

        return {
            tenantId: key.tenant_id,
            keyId: key.id,
            name: key.name,
            scopes: Array.isArray(scopes) ? scopes : [],
            rateLimitPerMin: key.rate_limit_per_min,
        };
    } catch {
        return null;
    }
}
