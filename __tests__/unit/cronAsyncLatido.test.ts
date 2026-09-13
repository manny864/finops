// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `vi.mock` se hoistea sobre las constantes del módulo, así que el doble de
// Redis va dentro de `vi.hoisted` o el mock lo ve sin inicializar.
const { store, redisMock } = vi.hoisted(() => {
    const store = new Map<string, string>();
    return {
        store,
        redisMock: {
            status: "ready",
            get: vi.fn(async (k: string) => store.get(k) ?? null),
            set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
                if (args.includes("NX") && store.has(k)) return null;
                store.set(k, v);
                return "OK";
            }),
            del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
            exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
            expire: vi.fn(async () => 1),
        },
    };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
    clavesDe, escribirEstado, leerEstado, tomarLock, soltarLock, iniciarLatido,
} from "@/lib/cronAsyncJob";

beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("las claves no cambian de forma", () => {
    // Si cambian, un poller en vuelo durante el deploy deja de encontrar su
    // estado y el job queda esperando un `done` en una clave que nadie escribe.
    it("mantiene el formato que ya usaban los endpoints", () => {
        expect(clavesDe("prewarm-dashboard")).toEqual({
            estado: "cron:prewarm-dashboard:status:v1",
            lock: "cron:prewarm-dashboard:lock:v1",
        });
        expect(clavesDe("sync", "tenant-1").lock).toBe("cron:sync:lock:v1:tenant-1");
    });
});

describe("trabajo interrumpido", () => {
    // EL BUG: un deploy mata el proceso con el barrido adentro. El estado queda
    // en done:false y el poller espera un done que nadie va a escribir, hasta
    // agotar su presupuesto (29,5 min en prewarm-dashboard).
    it("un done:false sin lock vivo se reporta como interrumpido, no como en curso", async () => {
        await tomarLock("prewarm-dashboard");
        await escribirEstado("prewarm-dashboard", { startedAt: Date.now(), finishedAt: null, done: false, ok: null });

        // el proceso muere: el lock expira y nadie lo renueva
        store.delete(clavesDe("prewarm-dashboard").lock);

        const estado = await leerEstado("prewarm-dashboard");
        expect(estado?.done).toBe(true);
        expect(estado?.ok).toBe(false);
        expect(estado?.orphan).toBe(true);
    });

    it("mientras el lock vive, sigue en curso", async () => {
        await tomarLock("prewarm-dashboard");
        await escribirEstado("prewarm-dashboard", { startedAt: Date.now(), finishedAt: null, done: false, ok: null });

        const estado = await leerEstado("prewarm-dashboard");
        expect(estado?.done).toBe(false);
        expect(estado?.orphan).toBeUndefined();
    });

    it("un trabajo terminado se devuelve tal cual", async () => {
        await escribirEstado("anomaly-detection", { startedAt: 1, finishedAt: 2, done: true, ok: true });
        const estado = await leerEstado("anomaly-detection");
        expect(estado).toMatchObject({ done: true, ok: true });
        expect(estado?.orphan).toBeUndefined();
    });
});

describe("lock", () => {
    it("el segundo disparo no entra mientras el primero corre", async () => {
        expect(await tomarLock("prewarm-compute")).toBe(true);
        expect(await tomarLock("prewarm-compute")).toBe(false);
        await soltarLock("prewarm-compute");
        expect(await tomarLock("prewarm-compute")).toBe(true);
    });

    it("sin Redis el cron corre igual", async () => {
        redisMock.status = "end";
        expect(await tomarLock("prewarm-daily")).toBe(true);
        redisMock.status = "ready";
    });
});

describe("latido", () => {
    it("renueva el lock mientras el trabajo vive", async () => {
        vi.useFakeTimers();
        await tomarLock("prewarm-databases");
        iniciarLatido("prewarm-databases");

        await vi.advanceTimersByTimeAsync(130_000);
        expect(redisMock.expire).toHaveBeenCalled();
    });

    // Sin esto el latido sigue renovando el lock de un trabajo terminado y el
    // cron queda bloqueado hasta que el proceso se reinicie.
    it("soltar el lock corta el latido", async () => {
        vi.useFakeTimers();
        await tomarLock("prewarm-databases");
        iniciarLatido("prewarm-databases");
        await soltarLock("prewarm-databases");

        redisMock.expire.mockClear();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(redisMock.expire).not.toHaveBeenCalled();
    });
});
