// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regresión: el rate limiter distribuido debe DEGRADAR a memoria cuando Redis
 * falla, no bloquear.
 *
 * `pipeline.exec()` de ioredis no lanza cuando fallan los comandos
 * individuales: devuelve `[[Error, undefined], [Error, undefined]]`. El código
 * original hacía `Number(undefined)` → NaN, y `NaN <= limite` es false, así que
 * respondía 429 a todas las requests justo cuando Redis estaba caído. Peor: no
 * hacía falta que Redis estuviera caído, alcanzaba con el primer request tras
 * arrancar el proceso, porque ioredis conecta de forma lazy y el pipeline sale
 * antes de que el socket esté listo.
 */

const pipelineMock = vi.hoisted(() => ({
    incr: vi.fn(),
    pttl: vi.fn(),
    exec: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
    redis: {
        pipeline: () => pipelineMock,
        pexpire: vi.fn().mockResolvedValue(1),
    },
}));

beforeEach(() => {
    pipelineMock.incr.mockReset();
    pipelineMock.pttl.mockReset();
    pipelineMock.exec.mockReset();
    vi.resetModules();
});

afterEach(() => {
    vi.clearAllMocks();
});

async function freshLimiter() {
    // Import dinámico + resetModules: el limitador guarda estado en memoria
    // (los contadores del fallback), así que cada test necesita el suyo.
    const mod = await import('@/lib/rateLimiter');
    return mod.default;
}

describe('rateLimiter.checkByKeyDistributed — degradado ante fallos de Redis', () => {
    it('permite la request cuando el pipeline devuelve error por comando', async () => {
        const streamError = new Error("Stream isn't writeable and enableOfflineQueue options is false");
        pipelineMock.exec.mockResolvedValue([[streamError], [streamError]]);

        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('regresion:comando-con-error', 10, 60_000);

        expect(result.allowed).toBe(true);
        expect(Number.isNaN(result.remaining)).toBe(false);
    });

    it('permite la request cuando el contador viene no numérico', async () => {
        pipelineMock.exec.mockResolvedValue([[null, undefined], [null, undefined]]);

        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('regresion:contador-invalido', 10, 60_000);

        expect(result.allowed).toBe(true);
    });

    it('permite la request cuando exec() lanza', async () => {
        pipelineMock.exec.mockRejectedValue(new Error('ECONNREFUSED'));

        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('regresion:exec-lanza', 10, 60_000);

        expect(result.allowed).toBe(true);
    });

    it('sigue bloqueando de verdad cuando Redis responde y se supera el límite', async () => {
        // El degradado no puede convertirse en "nunca limita": con Redis sano
        // el veredicto tiene que respetarse.
        pipelineMock.exec.mockResolvedValue([[null, 11], [null, 30_000]]);

        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('regresion:limite-superado', 10, 60_000);

        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
    });

    it('permite cuando Redis responde por debajo del límite', async () => {
        pipelineMock.exec.mockResolvedValue([[null, 3], [null, 30_000]]);

        const limiter = await freshLimiter();
        const result = await limiter.checkByKeyDistributed('regresion:bajo-limite', 10, 60_000);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(7);
    });
});
