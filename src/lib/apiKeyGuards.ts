/**
 * Fronteras de las APIs autenticadas por clave (PERIM-03).
 *
 * - `preAuthAllowed`: presupuesto por IP confiable ANTES de tocar MySQL, para que
 *   claves inventadas con prefijo válido no se conviertan en consultas.
 * - `looksLikeKey`: descarta sin consultar tokens con forma imposible.
 * - `touchKeyLastUsed`: el UPDATE de `last_used_at` va después de admitir la
 *   llamada, como mucho uno por clave y minuto por réplica, y loguea errores.
 */
import pool from "@/modules/storage/db";
import rateLimiter, { type RateLimitFailurePolicy } from "@/lib/rateLimiter";
import { trustedClientIp } from "@/lib/trustedClientIp";

export const PREAUTH_LIMIT_PER_MIN = 120;
const TOUCH_INTERVAL_MS = 60_000;
const TOUCH_MAX_TRACKED = 10_000;

/**
 * Con `failurePolicy: "reject"` y Redis caído lanza `RateLimitUnavailable`
 * (PERIM-06); el default `memory` conserva el comportamiento de /api/v1.
 */
export async function preAuthAllowed(
  request: Request,
  bucket: string,
  failurePolicy: RateLimitFailurePolicy = "memory"
): Promise<boolean> {
  const ip = trustedClientIp(request);
  // Sin IP confiable no hay clave de cuota que el cliente no pueda rotar; quedan
  // la validación de formato y la cuota por clave.
  if (!ip) return true;
  const { allowed } = await rateLimiter.checkByKeyDistributed(
    `preauth:${bucket}:${ip}`,
    PREAUTH_LIMIT_PER_MIN,
    60_000,
    failurePolicy
  );
  return allowed;
}

/** Prefijo conocido + alfabeto y largo acotados; no reemplaza la búsqueda por hash. */
export function looksLikeKey(token: string, prefix: "pak_" | "mcp_"): boolean {
  return token.startsWith(prefix) && /^[A-Za-z0-9_]{16,128}$/.test(token);
}

type KeyTable = "PublicApiKeys" | "MCPApiKeys";
const lastTouch = new Map<string, number>();

export function touchKeyLastUsed(table: KeyTable, keyId: number): void {
  const k = `${table}:${keyId}`;
  const now = Date.now();
  const prev = lastTouch.get(k);
  if (prev !== undefined && now - prev < TOUCH_INTERVAL_MS) return;
  if (lastTouch.size >= TOUCH_MAX_TRACKED) lastTouch.clear();
  lastTouch.set(k, now);
  const sql =
    table === "PublicApiKeys"
      ? "UPDATE PublicApiKeys SET last_used_at = NOW() WHERE id = ?"
      : "UPDATE MCPApiKeys SET last_used_at = NOW() WHERE id = ?";
  // Promise.resolve().then: un throw síncrono del driver tampoco corta la petición.
  void Promise.resolve().then(() => pool.query(sql, [keyId])).catch((e: unknown) => {
    lastTouch.delete(k);
    console.error("[api-key] last_used_at update failed", {
      table,
      keyId,
      reason: e instanceof Error ? e.message : String(e),
    });
  });
}

export function __resetKeyGuardsForTests(): void {
  lastTouch.clear();
}
