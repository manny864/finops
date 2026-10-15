import { redis } from './redis';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export type RateLimitFailurePolicy = 'memory' | 'reject';

/** Redis no respondió y la política es `reject`: indisponibilidad, no exceso (→ 503). */
export class RateLimitUnavailable extends Error {
  constructor() {
    super('Distributed rate limiting unavailable');
    this.name = 'RateLimitUnavailable';
  }
}

// PTTL < 0 cubre la clave nueva (-2 antes del INCR, -1 después) y una clave
// que quedó sin TTL por cualquier motivo.
const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/** A lo sumo un aviso cada 30 s por réplica: un outage bajo ataque no debe inundar los logs. */
const UNAVAILABLE_LOG_INTERVAL_MS = 30_000;
let lastUnavailableLogAt = 0;
let suppressedUnavailable = 0;

function reportBackendUnavailable(failurePolicy: RateLimitFailurePolicy): void {
  const now = Date.now();
  if (now - lastUnavailableLogAt < UNAVAILABLE_LOG_INTERVAL_MS) {
    suppressedUnavailable++;
    return;
  }
  console.warn('[rate-limit] distributed backend unavailable', { failurePolicy, suppressed: suppressedUnavailable });
  lastUnavailableLogAt = now;
  suppressedUnavailable = 0;
}

/** Sólo tests: reinicia el tope de frecuencia del aviso. */
export function __resetRateLimitAlertForTests(): void {
  lastUnavailableLogAt = 0;
  suppressedUnavailable = 0;
}

class RateLimiter {
  private limits = new Map<number, RateLimitEntry>();
  private stringLimits = new Map<string, RateLimitEntry>();
  private windowMs = 60000; // 1 minute

  check(keyId: number, limitPerMin: number): { allowed: boolean; remaining: number; resetAt: Date } {
    const now = Date.now();
    let entry = this.limits.get(keyId);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.limits.set(keyId, entry);
    }

    const remaining = Math.max(0, limitPerMin - entry.count);
    const allowed = entry.count < limitPerMin;

    if (allowed) {
      entry.count++;
    }

    return {
      allowed,
      remaining,
      resetAt: new Date(entry.resetAt),
    };
  }

  /**
   * String-key rate limit (for MFA, AI upload, etc.)
   * Uses a custom window in ms if provided, otherwise 1 minute.
   */
  checkByKey(key: string, limitPerWindow: number, windowMs = this.windowMs): { allowed: boolean; remaining: number; resetAt: Date } {
    const now = Date.now();
    let entry = this.stringLimits.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      this.stringLimits.set(key, entry);
    }

    const remaining = Math.max(0, limitPerWindow - entry.count);
    const allowed = entry.count < limitPerWindow;

    if (allowed) {
      entry.count++;
    }

    return {
      allowed,
      remaining,
      resetAt: new Date(entry.resetAt),
    };
  }

  /**
   * Rate limit distribuido con backend Redis (A-4): el estado se comparte
   * entre instancias y sobrevive a reinicios del contenedor.
   *
   * PERIM-06: INCR + PTTL + PEXPIRE corren en un único script Lua, así que no
   * queda un contador sin TTL si la conexión cae entre comandos (un pipeline
   * agrupa, pero no es atómico).
   *
   * Si Redis no responde, `failurePolicy` decide:
   * - `memory` (por defecto): degrada al limitador en memoria. Ojo: con N
   *   réplicas el límite efectivo puede llegar a N veces el configurado.
   * - `reject`: lanza `RateLimitUnavailable`; el consumidor debe responder 503
   *   (no 429: no se confirmó exceso) sin ejecutar el trabajo protegido.
   * En ambos casos se emite `[rate-limit] distributed backend unavailable`
   * (sin key ni IP, con tope de frecuencia) para alertar desde Log Analytics.
   */
  async checkByKeyDistributed(
    key: string,
    limitPerWindow: number,
    windowMs = this.windowMs,
    failurePolicy: RateLimitFailurePolicy = 'memory'
  ): Promise<RateLimitResult> {
    if (!Number.isSafeInteger(limitPerWindow) || limitPerWindow <= 0 ||
        !Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new RangeError('Invalid rate limit configuration');
    }
    try {
      const result: unknown = await redis.eval(RATE_LIMIT_SCRIPT, 1, `rl:${key}`, windowMs);
      // Un resultado inesperado no es un veredicto: se trata como fallo del
      // backend en vez de dejar que un NaN niegue o permita todo.
      if (!Array.isArray(result) || result.length !== 2 ||
          !Number.isSafeInteger(result[0]) || result[0] < 1 ||
          !Number.isSafeInteger(result[1]) || result[1] < 0) {
        throw new Error('Invalid distributed rate limit result');
      }
      const [count, ttl] = result as [number, number];
      return {
        allowed: count <= limitPerWindow,
        remaining: Math.max(0, limitPerWindow - count),
        resetAt: new Date(Date.now() + ttl),
      };
    } catch {
      reportBackendUnavailable(failurePolicy);
      if (failurePolicy === 'reject') throw new RateLimitUnavailable();
      return this.checkByKey(key, limitPerWindow, windowMs);
    }
  }

  // Cleanup old entries periodically (every 5 minutes)
  cleanup(): void {
    const now = Date.now();
    for (const [keyId, entry] of this.limits.entries()) {
      if (now > entry.resetAt + 60000) {
        this.limits.delete(keyId);
      }
    }
    for (const [key, entry] of this.stringLimits.entries()) {
      if (now > entry.resetAt + 60000) {
        this.stringLimits.delete(key);
      }
    }
  }
}

const rateLimiter = new RateLimiter();

// Start cleanup interval
if (typeof global !== "undefined") {
  setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);
}

export default rateLimiter;
