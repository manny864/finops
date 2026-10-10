// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * El cliente de Redis no puede rendirse en producción.
 *
 * `retryStrategy` devolvía `null` después de 3 intentos (~1,2 s) y ioredis no reconecta nunca más
 * tras un `null`: un failover o un mantenimiento de Azure Managed Redis dejaba a la réplica sin caché
 * hasta reiniciarla. En los logs de producción hubo 2 `read ECONNRESET` en 14 días.
 */
const opciones: { current: any } = { current: null };
vi.mock("ioredis", () => ({
    default: class {
        constructor(o: unknown) { opciones.current = o; }
    },
}));

describe("estrategiaDeReintento", () => {
    it("en producción nunca devuelve null, por mucho que falle", async () => {
        const { estrategiaDeReintento } = await import("@/lib/redis");
        for (const n of [1, 2, 3, 4, 10, 100, 100_000]) {
            const espera = estrategiaDeReintento(n, true);
            expect(espera, `reintento ${n}`).not.toBeNull();
            expect(espera).toBeGreaterThanOrEqual(200);
            expect(espera).toBeLessThanOrEqual(2000);
        }
    });

    it("en producción la espera crece hasta 2 s y se queda ahí", async () => {
        const { estrategiaDeReintento } = await import("@/lib/redis");
        expect([1, 2, 5, 10, 11, 50].map((n) => estrategiaDeReintento(n, true))).toEqual([200, 400, 1000, 2000, 2000, 2000]);
    });

    it("fuera de producción conserva el tope de 3 intentos (sin Redis local el proceso tiene que terminar)", async () => {
        const { estrategiaDeReintento } = await import("@/lib/redis");
        expect([1, 2, 3].map((n) => estrategiaDeReintento(n, false))).toEqual([200, 400, 600]);
        expect(estrategiaDeReintento(4, false)).toBeNull();
        expect(estrategiaDeReintento(50, false)).toBeNull();
    });
});

describe("el cliente usa esa estrategia según NODE_ENV", () => {
    beforeEach(() => { vi.resetModules(); delete (globalThis as any).redis; opciones.current = null; });
    afterEach(() => { vi.unstubAllEnvs(); delete (globalThis as any).redis; });

    it("con NODE_ENV=production el retryStrategy del cliente no se rinde", async () => {
        vi.stubEnv("NODE_ENV", "production");
        await import("@/lib/redis");
        expect(opciones.current.retryStrategy(4)).toBe(800);
        expect(opciones.current.retryStrategy(1000)).toBe(2000);
        // El resto de la configuración no cambia: sin cola offline los comandos fallan rápido.
        expect(opciones.current.enableOfflineQueue).toBe(false);
        expect(opciones.current.maxRetriesPerRequest).toBeNull();
    });

    it("con NODE_ENV=test el cliente sigue rindiéndose a los 3 intentos", async () => {
        vi.stubEnv("NODE_ENV", "test");
        await import("@/lib/redis");
        expect(opciones.current.retryStrategy(3)).toBe(600);
        expect(opciones.current.retryStrategy(4)).toBeNull();
    });
});
