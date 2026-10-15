// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Rate limiter distribuido: contrato atómico (PERIM-06) y degradado ante fallos.
 *
 * Regresión original: con `pipeline.exec()` los errores por comando venían en
 * el resultado y `Number(undefined)` → NaN hacía responder 429 a todo justo
 * cuando Redis caía (o en el primer request, con ioredis conectando lazy).
 * Ahora un único EVAL hace INCR + PTTL + PEXPIRE; cualquier resultado que no
 * sea `[count≥1, ttl≥0]` enteros se trata como backend caído, nunca como
 * veredicto. Con la política por defecto (`memory`) sigue degradando a memoria;
 * con `reject` lanza RateLimitUnavailable.
 */

const redisMock = vi.hoisted(() => ({
    eval: vi.fn(),
    pipeline: vi.fn(),
    pexpire: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({ redis: redisMock }));

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    redisMock.eval.mockReset();
    redisMock.pipeline.mockReset();
    redisMock.pexpire.mockReset();
    vi.resetModules();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function freshModule() {
    // Import dinámico + resetModules: el limitador guarda estado en memoria
    // (contadores del fallback y tope de logs), cada test necesita el suyo.
    return import('@/lib/rateLimiter');
}

async function freshLimiter() {
    return (await freshModule()).default;
}

describe('rateLimiter.checkByKeyDistributed — contrato atómico', () => {
    it('usa un único EVAL con INCR/PTTL/PEXPIRE sobre rl:<key> y la ventana como ARGV', async () => {
        redisMock.eval.mockResolvedValue([1, 60_000]);
        const limiter = await freshLimiter();
        await limiter.checkByKeyDistributed('atomico:k', 10, 60_000);

        expect(redisMock.eval).toHaveBeenCalledTimes(1);
        const [script, numKeys, key, windowMs] = redisMock.eval.mock.calls[0];
        expect(numKeys).toBe(1);
        expect(key).toBe('rl:atomico:k');
        expect(windowMs).toBe(60_000);
        expect(script).toMatch(/INCR/);
        expect(script).toMatch(/PTTL/);
        expect(script).toMatch(/PEXPIRE/);
        // Nada de comandos sueltos que dejen un contador sin TTL.
        expect(redisMock.pipeline).not.toHaveBeenCalled();
        expect(redisMock.pexpire).not.toHaveBeenCalled();
    });

    it('sigue bloqueando de verdad cuando Redis responde y se supera el límite', async () => {
        redisMock.eval.mockResolvedValue([11, 30_000]);
        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('regresion:limite-superado', 10, 60_000);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
    });

    it('permite cuando Redis responde por debajo del límite y usa el TTL real', async () => {
        redisMock.eval.mockResolvedValue([3, 30_000]);
        const limiter = await freshLimiter();
        const before = Date.now();
        const result = await limiter.checkByKeyDistributed('regresion:bajo-limite', 10, 60_000);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(7);
        expect(result.resetAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
        expect(result.resetAt.getTime()).toBeLessThan(before + 31_000);
    });

    it.each([
        [0, 1],
        [-1, 60_000],
        [1.5, 60_000],
        [Number.NaN, 60_000],
        [10, 0],
        [10, 1.5],
    ])('configuración inválida (limit=%s, window=%s) → RangeError sin tocar Redis', async (limit, windowMs) => {
        const limiter = await freshLimiter();
        await expect(limiter.checkByKeyDistributed('cfg', limit, windowMs)).rejects.toBeInstanceOf(RangeError);
        expect(redisMock.eval).not.toHaveBeenCalled();
    });
});

describe('rateLimiter.checkByKeyDistributed — política memory (por defecto)', () => {
    it.each([
        ['eval lanza', () => redisMock.eval.mockRejectedValue(new Error('ECONNREFUSED'))],
        ['stream no escribible (lazy connect)', () => redisMock.eval.mockRejectedValue(new Error("Stream isn't writeable and enableOfflineQueue options is false"))],
        ['resultado no array', () => redisMock.eval.mockResolvedValue('OK')],
        ['contador no numérico', () => redisMock.eval.mockResolvedValue([undefined, undefined])],
        ['contador string', () => redisMock.eval.mockResolvedValue(['3', 1000])],
        ['TTL negativo', () => redisMock.eval.mockResolvedValue([1, -1])],
        ['contador 0', () => redisMock.eval.mockResolvedValue([0, 1000])],
    ])('%s → degrada a memoria sin NaN y avisa', async (_name, arrange) => {
        arrange();
        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('fallback:k', 10, 60_000);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10);
        expect(Number.isNaN(result.resetAt.getTime())).toBe(false);
        expect(warn).toHaveBeenCalledWith(
            '[rate-limit] distributed backend unavailable',
            expect.objectContaining({ failurePolicy: 'memory' })
        );
    });

    it('el fallback en memoria sí limita por réplica', async () => {
        redisMock.eval.mockRejectedValue(new Error('down'));
        const limiter = await freshLimiter();
        for (let i = 0; i < 3; i++) {
            expect((await limiter.checkByKeyDistributed('fallback:limita', 3, 60_000)).allowed).toBe(true);
        }
        expect((await limiter.checkByKeyDistributed('fallback:limita', 3, 60_000)).allowed).toBe(false);
    });

    it('el aviso no incluye la key (puede llevar IP/email) y tiene tope de frecuencia', async () => {
        redisMock.eval.mockRejectedValue(new Error('down'));
        const limiter = await freshLimiter();
        for (let i = 0; i < 50; i++) {
            await limiter.checkByKeyDistributed(`sso-start:ip:203.0.113.${i}`, 100, 60_000);
        }
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('203.0.113');
    });

    it('tras el intervalo vuelve a avisar e informa cuántos suprimió', async () => {
        vi.useFakeTimers({ now: new Date('2026-10-15T00:00:00Z') });
        try {
            redisMock.eval.mockRejectedValue(new Error('down'));
            const limiter = await freshLimiter();
            for (let i = 0; i < 5; i++) await limiter.checkByKeyDistributed('k', 100, 60_000);
            vi.setSystemTime(new Date('2026-10-15T00:00:31Z'));
            await limiter.checkByKeyDistributed('k', 100, 60_000);
            expect(warn).toHaveBeenCalledTimes(2);
            expect(warn.mock.calls[1][1]).toEqual({ failurePolicy: 'memory', suppressed: 4 });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('rateLimiter.checkByKeyDistributed — política reject', () => {
    it('Redis caído → RateLimitUnavailable (no un 429 ni un permitido)', async () => {
        redisMock.eval.mockRejectedValue(new Error('ECONNREFUSED'));
        const mod = await freshModule();
        await expect(mod.default.checkByKeyDistributed('estricto:k', 10, 60_000, 'reject'))
            .rejects.toBeInstanceOf(mod.RateLimitUnavailable);
        expect(warn).toHaveBeenCalledWith(
            '[rate-limit] distributed backend unavailable',
            expect.objectContaining({ failurePolicy: 'reject' })
        );
    });

    it('resultado inválido → RateLimitUnavailable', async () => {
        redisMock.eval.mockResolvedValue([Number.NaN, 1000]);
        const mod = await freshModule();
        const err = await mod.default.checkByKeyDistributed('estricto:k', 10, 60_000, 'reject').catch((e) => e);
        expect(err).toBeInstanceOf(mod.RateLimitUnavailable);
        expect(err.name).toBe('RateLimitUnavailable');
    });

    it('no consume ni usa el contador en memoria', async () => {
        redisMock.eval.mockRejectedValue(new Error('down'));
        const limiter = await freshLimiter();
        for (let i = 0; i < 3; i++) {
            await limiter.checkByKeyDistributed('estricto:mem', 1, 60_000, 'reject').catch(() => {});
        }
        // Si `reject` hubiera contado en memoria, con límite 1 este ya estaría agotado.
        expect(limiter.checkByKey('estricto:mem', 1, 60_000).allowed).toBe(true);
    });

    it('con Redis sano se comporta igual que memory', async () => {
        redisMock.eval.mockResolvedValue([2, 5000]);
        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('estricto:ok', 10, 60_000, 'reject');
        expect(result).toEqual(expect.objectContaining({ allowed: true, remaining: 8 }));
    });
});
