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

import { getWithStaleWhileRevalidate, peekSwr } from "@/lib/cache";

beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    redisMock.status = "ready";
});

/**
 * `peekSwr` es para quien NO puede esperar al origen. El buscador global se dispara en cada tecla y el escaneo de
 * zombis en frío tarda 30 s o más (consultas a Resource Graph en lotes de 5 con 2,5 s de pausa): si el buscador
 * usara `getWithStaleWhileRevalidate`, una caché fría lo dejaría colgado. Lee lo que la SWR ya guardó y nada más.
 */
describe("peekSwr", () => {
    it("devuelve lo que guardó la SWR, sin llamar a ningún fetcher", async () => {
        await getWithStaleWhileRevalidate("k", async () => ({ lista: [1, 2, 3] }), 900, 300);

        expect(await peekSwr<{ lista: number[] }>("k")).toEqual({ lista: [1, 2, 3] });
    });

    it("con la caché fría devuelve null (no un dato vacío) y no guarda nada", async () => {
        expect(await peekSwr("nunca-guardada")).toBeNull();
        expect(redisMock.set).not.toHaveBeenCalled();
    });

    it("una lista vacía guardada es un dato, no una caché fría", async () => {
        await getWithStaleWhileRevalidate("vacia", async () => [] as number[], 900, 300);

        expect(await peekSwr<number[]>("vacia")).toEqual([]);
    });

    it("lee también las entradas viejas sin envelope", async () => {
        store.set("legacy", JSON.stringify({ x: 1 }));

        expect(await peekSwr("legacy")).toEqual({ x: 1 });
    });

    it("sin Redis listo, o si Redis falla, devuelve null y no lanza", async () => {
        store.set("k", JSON.stringify({ __sw: true, t: Date.now(), data: 7 }));

        redisMock.status = "connecting";
        expect(await peekSwr("k")).toBeNull();
        expect(redisMock.get).not.toHaveBeenCalled();

        redisMock.status = "ready";
        redisMock.get.mockRejectedValueOnce(new Error("Connection is closed"));
        expect(await peekSwr("k")).toBeNull();
    });
});
