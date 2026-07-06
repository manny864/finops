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
   * entre instancias y sobrevive a reinicios del contenedor. Usa INCR + EXPIRE
   * (atómico vía pipeline) sobre `rl:<key>`. Si Redis no responde (offline,
   * timeout), degrada de forma transparente al limitador en memoria — nunca
   * bloquea la request por un problema de infraestructura de rate limiting.
   */
  async checkByKeyDistributed(key: string, limitPerWindow: number, windowMs = this.windowMs): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    try {
      const pipeline = redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.pttl(redisKey);
      const res = await pipeline.exec();
      // res: [[err, incrValue], [err, pttl]]
      if (!res) throw new Error('redis pipeline returned null');
      const count = Number(res[0][1]);
      let pttl = Number(res[1][1]);
      if (pttl < 0) {
        // Primera vez en la ventana (o sin TTL): setear expiración.
        await redis.pexpire(redisKey, windowMs);
        pttl = windowMs;
      }
      const allowed = count <= limitPerWindow;
      return {
        allowed,
        remaining: Math.max(0, limitPerWindow - count),
        resetAt: new Date(Date.now() + pttl),
      };
    } catch {
      // Fallback a memoria si Redis no está disponible.
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
