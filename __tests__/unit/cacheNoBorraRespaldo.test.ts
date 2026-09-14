// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
    const store = new Map<string, string>();
    return {
        store,
        redisMock: {
            status: "ready",
            get: vi.fn(async (k: string) => store.get(k) ?? null),
            set: vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; }),
            del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
        },
    };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock, isRedisReady: () => true }));

import { getWithStaleWhileRevalidate } from "@/lib/cache";

beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
});

/**
 * EL BUCLE (prod, 2026-09-14). Azure Cost Management throttlea; la consulta
 * vuelve vacía; `dynamicTtl` devuelve 0 para no cachear ese vacío... y el helper
 * aprovechaba para BORRAR la entrada previa "y forzar un fetch fresco". Con eso,
 * cada 429 dejaba el caché sin respaldo, la request siguiente volvía a
 * consultar, Azure seguía throttleado y volvía a borrar: cuanto peor estaba Cost
 * Management, más lo consultábamos. 1564 eventos de throttle en 6 h, y la
 * pantalla en $0.00 porque no quedaba ni un valor viejo que mostrar.
 */
describe("un resultado no cacheable no se lleva puesto el respaldo", () => {
    it("conserva el último valor bueno cuando el nuevo no se puede cachear", async () => {
        const bueno = { data: [1, 2, 3] };
        await getWithStaleWhileRevalidate("k", async () => bueno, 1800, 900, () => 1800);
        expect(store.has("k")).toBe(true);

        // Ahora Azure throttlea: vacío y sin cachear.
        const vacio = { data: [] as number[] };
        await getWithStaleWhileRevalidate("k2", async () => vacio, 1800, 900, () => 0);

        // Lo importante: la entrada buena sigue ahí y nadie llamó a del().
        expect(store.has("k")).toBe(true);
        expect(redisMock.del).not.toHaveBeenCalled();
    });

    it("un resultado no cacheable tampoco se guarda", async () => {
        await getWithStaleWhileRevalidate("solo-vacio", async () => ({ data: [] }), 1800, 900, () => 0);
        expect(store.has("solo-vacio")).toBe(false);
    });

    it("el camino normal sigue guardando", async () => {
        await getWithStaleWhileRevalidate("normal", async () => ({ data: [7] }), 1800, 900, () => 1800);
        expect(store.has("normal")).toBe(true);
    });
});
