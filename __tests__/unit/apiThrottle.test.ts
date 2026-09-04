// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { crearLimitadorGlobal } from "@/lib/apiThrottle";

/** Un 429 con la forma que devuelve Azure. */
const err429 = (retryAfterSegs?: number) => ({
    statusCode: 429,
    headers: retryAfterSegs ? { "retry-after": String(retryAfterSegs) } : {},
});
const es429 = (e: any) => e?.statusCode === 429;
const retryAfterMs = (e: any) => {
    const v = e?.headers?.["retry-after"];
    return v ? Number(v) * 1000 : null;
};

/** Instancia con tiempos en milisegundos, para que el test corra rapido. */
const nuevoLimitador = (over: Partial<Parameters<typeof crearLimitadorGlobal>[0]> = {}) =>
    crearLimitadorGlobal(
        {
            nombre: "TEST", maxConcurrent: 2, pacingMs: 0, minBackoffMs: 20,
            maxBackoffMs: 200, factor: 2, jitterMs: 0, minRetryAfterMs: 10, ...over,
        },
        es429,
        retryAfterMs,
    );

describe("limitador global de API", () => {
    it("nunca corre mas de maxConcurrent a la vez", async () => {
        const limite = nuevoLimitador({ maxConcurrent: 2 });
        let enVuelo = 0;
        let pico = 0;
        await Promise.all(
            Array.from({ length: 8 }, () =>
                limite(async () => {
                    pico = Math.max(pico, ++enVuelo);
                    await new Promise((r) => setTimeout(r, 5));
                    enVuelo--;
                }),
            ),
        );
        expect(pico).toBe(2);
    });

    it("un 429 frena la cola ENTERA, no solo la llamada que fallo", async () => {
        // Es lo unico que un backoff por llamada no puede hacer, y la razon de
        // que ARG tuviera 5 respuestas 429 y Cost Management 314 en la misma
        // media hora: mientras una llamada dormia, las otras seguian golpeando.
        const limite = nuevoLimitador({ maxConcurrent: 1, minRetryAfterMs: 60 });
        const arranques: Array<[string, number]> = [];
        const t0 = Date.now();

        let primeraVez = true;
        const conFalla = limite(async () => {
            arranques.push(["falla", Date.now() - t0]);
            if (primeraVez) { primeraVez = false; throw err429(0.06); }
        }, { maxRetries: 1 });

        // Encolada detras, sin ningun 429 propio.
        const inocente = limite(async () => { arranques.push(["inocente", Date.now() - t0]); });

        await Promise.all([conFalla, inocente]);
        const tInocente = arranques.find(([n]) => n === "inocente")![1];
        expect(
            tInocente,
            "la llamada sana arranco durante la pausa: la cola no se freno de verdad",
        ).toBeGreaterThanOrEqual(55);
    });

    it("aborta durante el backoff en vez de pagarlo entero", async () => {
        // Sin esto, un deadline vencido igual espera el backoff completo, que es
        // justo lo que le comia los 6 minutos al sync.
        const limite = nuevoLimitador({ minBackoffMs: 5000, minRetryAfterMs: 5000 });
        const ac = new AbortController();
        const t0 = Date.now();
        const p = limite(async () => { throw err429(); }, { maxRetries: 3, signal: ac.signal });
        setTimeout(() => ac.abort(new Error("deadline")), 30);
        await expect(p).rejects.toThrow("deadline");
        expect(Date.now() - t0).toBeLessThan(1000);
    });

    it("respeta el minBackoffMs por llamada", async () => {
        const limite = nuevoLimitador({ minBackoffMs: 5000 });
        const t0 = Date.now();
        let intentos = 0;
        await limite(async () => { if (++intentos === 1) throw err429(); }, { maxRetries: 1, minBackoffMs: 25 });
        expect(intentos).toBe(2);
        expect(Date.now() - t0, "uso el minBackoff global en vez del de la llamada").toBeLessThan(2000);
    });

    it("un error que no es 429 sube tal cual, sin reintentar", async () => {
        const limite = nuevoLimitador();
        const fn = vi.fn(async () => { throw new Error("boom"); });
        await expect(limite(fn, { maxRetries: 3 })).rejects.toThrow("boom");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("con maxRetries agotado tira el 429 en vez de colgarse", async () => {
        const limite = nuevoLimitador();
        await expect(limite(async () => { throw err429(); }, { maxRetries: 1 })).rejects.toMatchObject({ statusCode: 429 });
    });
});

describe("el turno se libera pase lo que pase", () => {
    it("un fn que lanza SINCRONICAMENTE no deja la cola trabada", async () => {
        // `fn().then(...)` no llega a existir si `fn` lanza antes de devolver la
        // promesa: nadie decrementa el contador de activos y el turno queda
        // tomado. Con maxConcurrent 1, un solo error asi bastaba para que
        // ninguna consulta de costos volviera a correr en ese proceso.
        const limite = nuevoLimitador({ maxConcurrent: 1 });
        const explota = () => { throw new Error("sincrono"); };

        await expect(limite(explota as any, { maxRetries: 0 })).rejects.toThrow("sincrono");

        // Si el turno se filtro, esto no resuelve nunca.
        await expect(
            Promise.race([
                limite(async () => "vivo"),
                new Promise((_r, rej) => setTimeout(() => rej(new Error("cola trabada")), 500)),
            ]),
        ).resolves.toBe("vivo");
    });
});
