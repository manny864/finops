// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
    const store = new Map<string, string>();
    return {
        store,
        redisMock: {
            status: "ready" as string,
            get: vi.fn(async (k: string) => store.get(k) ?? null),
            set: vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; }),
            del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
        },
    };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { getWithStaleWhileRevalidate } from "@/lib/cache";

beforeEach(() => {
    store.clear();
    redisMock.status = "ready";
    vi.clearAllMocks();
});

/** Un fetcher que no termina hasta que el test lo libera: así los llamadores son concurrentes de verdad. */
function fetcherManual<T>() {
    let liberar!: (v: T) => void;
    let fallar!: (e: unknown) => void;
    const fetcher = vi.fn(() => new Promise<T>((res, rej) => { liberar = res; fallar = rej; }));
    return { fetcher, liberar: (v: T) => liberar(v), fallar: (e: unknown) => fallar(e) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * ANTES: un miss (cache frío o vencido el TTL duro) llamaba a `fetcher()` una vez por request. Tras una
 * invalidación o una caída de Redis, N usuarios y prewarms sobre el mismo tenant disparaban N consultas
 * idénticas a Cost Management y a MySQL: la carga que ya produce los 429. `_inFlight` sólo deduplicaba
 * la revalidación en background.
 */
describe("los misses concurrentes de una misma key comparten un solo fetch", () => {
    it("10 llamadores concurrentes -> 1 fetcher, el mismo resultado y 1 escritura en Redis", async () => {
        const { fetcher, liberar } = fetcherManual<{ n: number }>();
        const llamadas = Array.from({ length: 10 }, () => getWithStaleWhileRevalidate("tenant:costos", fetcher, 900));
        await tick();
        expect(fetcher).toHaveBeenCalledTimes(1);

        const dato = { n: 42 };
        liberar(dato);
        const resultados = await Promise.all(llamadas);

        expect(resultados.every((r) => r === dato)).toBe(true);
        expect(redisMock.set).toHaveBeenCalledTimes(1);
        expect(store.has("tenant:costos")).toBe(true);
    });

    it("keys distintas NO se mezclan", async () => {
        const a = fetcherManual<string>();
        const b = fetcherManual<string>();
        const pa = getWithStaleWhileRevalidate("a", a.fetcher, 900);
        const pb = getWithStaleWhileRevalidate("b", b.fetcher, 900);
        await tick();
        expect(a.fetcher).toHaveBeenCalledTimes(1);
        expect(b.fetcher).toHaveBeenCalledTimes(1);
        a.liberar("A"); b.liberar("B");
        expect(await pa).toBe("A");
        expect(await pb).toBe("B");
    });

    it("si el fetch falla, fallan todos los que esperaban y el siguiente miss vuelve a intentar", async () => {
        const { fetcher, fallar } = fetcherManual<string>();
        const llamadas = [1, 2, 3].map(() => getWithStaleWhileRevalidate("falla", fetcher, 900).catch((e) => e));
        await tick();
        fallar(new Error("429 Too many requests"));
        const resultados = await Promise.all(llamadas);
        expect(resultados.every((e) => e instanceof Error && e.message === "429 Too many requests")).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);

        // No hereda el error: la entrada en vuelo se liberó y un fetcher nuevo corre.
        const sano = vi.fn(async () => "ok");
        expect(await getWithStaleWhileRevalidate("falla", sano, 900)).toBe("ok");
        expect(sano).toHaveBeenCalledTimes(1);
    });

    it("sin Redis listo también deduplica (es el caso donde más se necesita)", async () => {
        redisMock.status = "end";
        const { fetcher, liberar } = fetcherManual<number>();
        const llamadas = [1, 2, 3, 4].map(() => getWithStaleWhileRevalidate("sin-redis", fetcher, 900));
        await tick();
        expect(fetcher).toHaveBeenCalledTimes(1);
        liberar(7);
        expect(await Promise.all(llamadas)).toEqual([7, 7, 7, 7]);
        expect(redisMock.set).not.toHaveBeenCalled();
    });

    it("un resultado que no se cachea (ttl 0) no deja la key trabada: la siguiente llamada vuelve a consultar", async () => {
        const f = vi.fn(async () => ({ vacio: true }));
        await getWithStaleWhileRevalidate("no-cachea", f, 900, 450, () => 0);
        await getWithStaleWhileRevalidate("no-cachea", f, 900, 450, () => 0);
        expect(f).toHaveBeenCalledTimes(2);
        expect(store.has("no-cachea")).toBe(false);
    });

    it("con el dato ya en caché no hay fetch ni espera (el camino normal no cambia)", async () => {
        await getWithStaleWhileRevalidate("normal", async () => ({ v: 1 }), 900);
        const f2 = vi.fn(async () => ({ v: 2 }));
        expect(await getWithStaleWhileRevalidate("normal", f2, 900)).toEqual({ v: 1 });
        expect(f2).not.toHaveBeenCalled();
    });
});
