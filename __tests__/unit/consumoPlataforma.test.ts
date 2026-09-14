// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
    const store = new Map<string, Record<string, string>>();
    return {
        store,
        redisMock: {
            status: "ready",
            pipeline: vi.fn(() => {
                const ops: Array<() => void> = [];
                const api: any = {
                    hincrby: (k: string, campo: string, n: number) => {
                        ops.push(() => {
                            const h = store.get(k) || {};
                            h[campo] = String(Number(h[campo] || 0) + n);
                            store.set(k, h);
                        });
                        return api;
                    },
                    expire: () => api,
                    exec: async () => { ops.forEach((o) => o()); return []; },
                };
                return api;
            }),
            scan: vi.fn(async () => ["0", [...store.keys()]]),
            hgetall: vi.fn(async (k: string) => store.get(k) || {}),
        },
    };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { registrarLlamadaAzure, leerUsoApiAzure, normalizarOperacion } from "@/lib/azureApiMetrics";

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

/**
 * Contar 429 sin el denominador no distingue "hacemos demasiadas llamadas" de
 * "Azure cerró la ventana", que son dos problemas con soluciones opuestas. Esta
 * telemetría es la que faltaba para decidir cadencias con datos.
 */
describe("telemetría de llamadas a Azure", () => {
    it("agrupa por operación y no por cada suscripción", () => {
        // El label trae el detalle: `cost-mtd(sub 1234-...)`. Agrupar por eso
        // daría miles de claves de una muestra cada una.
        expect(normalizarOperacion("cost-mtd(sub 0beb7800-aa59-4220)")).toBe("cost-mtd");
        expect(normalizarOperacion("historical(chunk 2/5)")).toBe("historical");
        expect(normalizarOperacion(undefined)).toBe("sin-etiqueta");
    });

    it("cuenta llamadas, throttles y tiempo perdido esperando", async () => {
        registrarLlamadaAzure("BillingService", "cost-mtd(sub a)", "ok", 0);
        registrarLlamadaAzure("BillingService", "cost-mtd(sub b)", "ok", 2500);
        registrarLlamadaAzure("BillingService", "cost-mtd(sub c)", "throttle", 45000);
        await new Promise((r) => setTimeout(r, 0));

        const filas = await leerUsoApiAzure(24);
        const costMtd = filas.find((f) => f.operacion === "cost-mtd");
        expect(costMtd?.llamadas).toBe(3);
        expect(costMtd?.ok).toBe(2);
        expect(costMtd?.throttle).toBe(1);
        // El costo real del throttling no es la llamada perdida: es el tiempo.
        expect(costMtd?.esperaMs).toBe(47500);
    });

    it("sin Redis no rompe la llamada que está midiendo", async () => {
        redisMock.status = "end";
        expect(() => registrarLlamadaAzure("BillingService", "x", "ok", 0)).not.toThrow();
        expect(await leerUsoApiAzure(24)).toEqual([]);
        redisMock.status = "ready";
    });
});
