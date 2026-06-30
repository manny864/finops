interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private limits = new Map<number, RateLimitEntry>();
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

  // Cleanup old entries periodically (every 5 minutes)
  cleanup(): void {
    const now = Date.now();
    for (const [keyId, entry] of this.limits.entries()) {
      if (now > entry.resetAt + 60000) {
        this.limits.delete(keyId);
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
