import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * por-categoria devolvia 524 desde Cloudflare (timeout de origen a los 100s) y
 * despues de un rato cargaba bien. La causa era el TTL DURO de 30 min que le
 * habia puesto: vencida la entrada, el visitante siguiente cae al camino
 * sincronico, y `getRealCategoryOverview` en frio pasa de 100s porque
 * getResourceCostsById recorre las suscripciones de a una.
 *
 * El TTL duro no es la ventana de frescura: es cuanto tiempo EXISTE una entrada
 * que evita ese camino. La frescura la da el blando, revalidando en background.
 */

// Redis falso en memoria, con control del reloj de la entrada.
const almacen = new Map<string, string>();
vi.mock("@/lib/redis", () => ({
    redis: {
        status: "ready",
        get: async (k: string) => almacen.get(k) ?? null,
        set: async (k: string, v: string) => { almacen.set(k, v); return "OK"; },
        del: async (k: string) => { almacen.delete(k); return 1; },
    },
}));

import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { ttlPorCalidad } from "@/app/api/intelligence/cost-by-category/route";

const sembrar = (key: string, data: unknown, edadS: number) =>
    almacen.set(key, JSON.stringify({ __sw: true, t: Date.now() - edadS * 1000, data }));

describe("cost-by-category: el TTL duro es lo que evita el 524", () => {
    beforeEach(() => almacen.clear());

    it("entrada pasada del TTL blando: responde al instante y revalida aparte", async () => {
        sembrar("k", { v: "viejo" }, 700); // > soft de 600
        let lento = false;
        // La revalidacion se bloquea en una promesa que controla el test, no en
        // un setTimeout: con un timer, bajo carga el runner puede detenerse los
        // milisegundos justos para que se dispare antes del assert y el test se
        // vuelve flaky. Aca no hay reloj de por medio.
        let liberar: () => void = () => {};
        const enEspera = new Promise<void>((r) => { liberar = r; });
        const p = getWithStaleWhileRevalidate("k", async () => {
            await enEspera;
            lento = true;
            return { v: "nuevo" };
        }, 86400, 600);
        // Sin esperar nada: ya tenemos el valor cacheado
        await expect(p).resolves.toEqual({ v: "viejo" });
        expect(lento, "no debe haber esperado al fetcher").toBe(false);
        // Se cierra la revalidacion antes de terminar: si quedara viva, su
        // escritura caeria despues del beforeEach del test siguiente.
        liberar();
        await enEspera;
        await new Promise((r) => setImmediate(r));
    });

    it("sin entrada: el request SI espera el calculo completo — esto es el 524", async () => {
        let espero = false;
        const data = await getWithStaleWhileRevalidate("k", async () => {
            await new Promise((r) => setTimeout(r, 20));
            espero = true;
            return { v: "calculado" };
        }, 86400, 600);
        expect(data).toEqual({ v: "calculado" });
        expect(espero, "el miss es sincronico: por eso el TTL duro debe ser largo").toBe(true);
    });

    it("un dia de TTL para el payload sano", () => {
        expect(ttlPorCalidad({ diagnostics: { source: "live-cost-management" } } as any)).toBe(86400);
    });

    it("5 min si Cost Management se degrado o vino vacio", () => {
        expect(ttlPorCalidad({ diagnostics: { source: "snapshot-fallback" } } as any)).toBe(300);
        expect(ttlPorCalidad({ empty: true, diagnostics: { source: "live-cost-management" } } as any)).toBe(300);
        expect(ttlPorCalidad({} as any), "sin diagnostics no se asume sano").toBe(300);
    });
});
