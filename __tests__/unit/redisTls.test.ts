// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La conexión a Redis valida el certificado del servidor y no baja de TLS 1.2.
 * rejectUnauthorized es true por defecto en Node, pero acá se exige explícito: es un
 * límite de confianza, igual que en la conexión a MySQL (src/modules/storage/db.ts).
 */
const capturado: { opciones: Record<string, any> | null } = { opciones: null };
vi.mock("ioredis", () => ({
    default: class {
        constructor(o: Record<string, any>) { capturado.opciones = o; }
    },
}));

async function crearCliente() {
    vi.resetModules();
    // En desarrollo el módulo guarda el cliente en globalThis y no vuelve a crearlo.
    (globalThis as { redis?: unknown }).redis = undefined;
    capturado.opciones = null;
    await import("@/lib/redis");
    return capturado.opciones!;
}

describe("cliente de Redis: TLS", () => {
    beforeEach(() => {
        vi.stubEnv("REDIS_HOST", "cache.redis.azure.net");
        vi.stubEnv("REDIS_PASSWORD", "clave-de-prueba");
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("con REDIS_TLS=true valida el certificado, fija el SNI y exige TLS 1.2 o más", async () => {
        vi.stubEnv("REDIS_TLS", "true");
        const o = await crearCliente();
        expect(o.tls).toEqual({ servername: "cache.redis.azure.net", minVersion: "TLSv1.2", rejectUnauthorized: true });
    });

    it("sin REDIS_TLS (Redis local en claro) no arma opciones de TLS", async () => {
        vi.stubEnv("REDIS_TLS", "");
        const o = await crearCliente();
        expect(o.tls).toBeUndefined();
    });

    it("nunca desactiva la validación del certificado", async () => {
        vi.stubEnv("REDIS_TLS", "true");
        const o = await crearCliente();
        expect(o.tls.rejectUnauthorized).not.toBe(false);
    });
});
