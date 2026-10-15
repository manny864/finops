/**
 * AISEC-05: único punto de acceso a `AiCache`.
 *
 * - La fila lleva `tenant_id` y toda lectura filtra por él: un fallo en la clave no
 *   alcanza para servir la respuesta de otro tenant (segunda capa).
 * - `expires_at` físico: la purga la hace el cron `ai-cache-purge`; la baja del tenant
 *   borra sus filas (tenantTeardownService, DELETE /api/tenants).
 * - Clave HMAC con prefijo de longitud por parte (sin ambigüedad de separadores). Si la
 *   clave cambia, sólo se pierden aciertos de caché.
 */
import { createHmac, hkdfSync } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";

/** Respuestas que no dependen del tenant y sólo las genera el modelo de la plataforma. */
export const AI_CACHE_PLATFORM_SCOPE = "__platform__";

let cachedKey: Buffer | null = null;

function hmacKey(): Buffer {
    if (cachedKey) return cachedKey;
    const explicit = process.env.AI_CACHE_HMAC_KEY;
    const master = process.env.MFA_ENCRYPTION_KEY;
    cachedKey = explicit
        ? Buffer.from(explicit, "utf8")
        : master
          ? Buffer.from(hkdfSync("sha256", master, "", "finops/ai-cache/v1", 32))
          : // Sin secreto la clave es un hash con dominio propio: el aislamiento lo da tenant_id.
            Buffer.from("finops/ai-cache/v1/unkeyed", "utf8");
    return cachedKey;
}

/** 64 hex (VARCHAR(64)). `parts` debe incluir la versión del prompt y el modelo. */
export function aiCacheKey(tenantId: string, ...parts: string[]): string {
    const h = createHmac("sha256", hmacKey());
    for (const p of [tenantId, ...parts]) h.update(`${Buffer.byteLength(p)}:`).update(p);
    return h.digest("hex");
}

export async function aiCacheGet(tenantId: string, key: string): Promise<string | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT response_text FROM AiCache WHERE hash_prompt = ? AND tenant_id = ? AND expires_at > UTC_TIMESTAMP()",
        [key, tenantId],
    );
    return rows[0]?.response_text ?? null;
}

/** No pisa una fila de otro tenant (ni una legada sin tenant_id) con la misma clave. */
export async function aiCacheSet(tenantId: string, key: string, text: string, ttlHours = 24): Promise<void> {
    await pool.query(
        `INSERT INTO AiCache (hash_prompt, tenant_id, response_text, created_at, expires_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))
         ON DUPLICATE KEY UPDATE
            response_text = IF(tenant_id = VALUES(tenant_id), VALUES(response_text), response_text),
            created_at = IF(tenant_id = VALUES(tenant_id), VALUES(created_at), created_at),
            expires_at = IF(tenant_id = VALUES(tenant_id), VALUES(expires_at), expires_at)`,
        [key, tenantId, text, ttlHours],
    );
}

/** Vencidas y legadas (sin tenant_id: ya no se leen). Por tandas para no bloquear la tabla. */
export async function aiCachePurgeExpired(batch = 5000): Promise<number> {
    const [res] = await pool.query<ResultSetHeader>(
        "DELETE FROM AiCache WHERE tenant_id IS NULL OR expires_at IS NULL OR expires_at < UTC_TIMESTAMP() LIMIT ?",
        [batch],
    );
    return res.affectedRows;
}
