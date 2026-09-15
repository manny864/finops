// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { crearLimitadorGlobal } from "@/lib/apiThrottle";
import { conPrioridadDeFondo, prioridadActual } from "@/lib/prioridadDeLlamada";

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

/**
 * Los prewarm pegan HTTP contra las MISMAS rutas que una persona, asi que la
 * cola FIFO atendia por orden de llegada el pedido de alguien mirando la
 * pantalla y el de un job precalentando caches. Medido en prod el 2026-09-15:
 * tres prewarm arrancan en el mismo minuto, su trabajo sigue corriendo dentro
 * del web app por minutos, y entre eso, el backfill y el audit dejaron 48
 * respuestas 429 en 13 minutos. El whiteboard esperaba detras de todo eso.
 */
describe("lo interactivo no hace fila detras del trabajo de fondo", () => {
    it("lo interactivo se atiende antes que el fondo ya encolado", async () => {
        const limite = nuevoLimitador({ maxConcurrent: 1 });
        const orden: string[] = [];
        const tarea = (nombre: string, prioridad: "interactiva" | "fondo") =>
            limite(async () => { orden.push(nombre); await new Promise((r) => setTimeout(r, 5)); }, { prioridad });

        // El primero toma el unico turno; el resto se encola detras.
        const enCurso = tarea("fondo-en-curso", "fondo");
        const pendientes = [
            tarea("fondo-1", "fondo"),
            tarea("fondo-2", "fondo"),
            tarea("interactiva", "interactiva"),
        ];
        await Promise.all([enCurso, ...pendientes]);

        // Al que ya estaba corriendo no se lo puede desalojar; a los encolados si.
        expect(orden[0]).toBe("fondo-en-curso");
        expect(orden[1]).toBe("interactiva");
    });

    it("el fondo no ocupa el turno reservado", async () => {
        const limite = nuevoLimitador({ maxConcurrent: 2, reservaInteractiva: 1 });
        let enVuelo = 0;
        let pico = 0;
        await Promise.all(
            Array.from({ length: 6 }, () =>
                limite(async () => {
                    pico = Math.max(pico, ++enVuelo);
                    await new Promise((r) => setTimeout(r, 5));
                    enVuelo--;
                }, { prioridad: "fondo" }),
            ),
        );
        // De los dos turnos, el fondo solo puede usar uno.
        expect(pico).toBe(1);
    });

    it("lo interactivo si usa los dos turnos", async () => {
        const limite = nuevoLimitador({ maxConcurrent: 2, reservaInteractiva: 1 });
        let enVuelo = 0;
        let pico = 0;
        await Promise.all(
            Array.from({ length: 6 }, () =>
                limite(async () => {
                    pico = Math.max(pico, ++enVuelo);
                    await new Promise((r) => setTimeout(r, 5));
                    enVuelo--;
                }, { prioridad: "interactiva" }),
            ),
        );
        expect(pico).toBe(2);
    });

    it("con un solo turno total, la reserva no mata al fondo", async () => {
        // `COST_MAX_CONCURRENT=1` con reserva 1 dejaria al fondo sin ningun
        // turno posible: los prewarm no volverian a correr nunca y nadie se
        // enteraria. La reserva se capa en maxConcurrent - 1.
        const limite = nuevoLimitador({ maxConcurrent: 1, reservaInteractiva: 1 });
        await expect(
            Promise.race([
                limite(async () => "corrio", { prioridad: "fondo" }),
                new Promise((_r, rej) => setTimeout(() => rej(new Error("fondo hambreado")), 500)),
            ]),
        ).resolves.toBe("corrio");
    });
});

/**
 * Sin esto habria que pasar un parametro por los 28 call sites de `withRetry`
 * en 8 archivos. La prioridad la marca `requireTenantAccess` al validar el
 * `X-Cron-Auth` y viaja sola hasta la cola.
 */
describe("la prioridad viaja por el contexto async", () => {
    it("lo que corre dentro de conPrioridadDeFondo cae en la fila baja", async () => {
        const limite = nuevoLimitador({ maxConcurrent: 1 });
        const orden: string[] = [];
        const tarea = (nombre: string) =>
            limite(async () => { orden.push(nombre); await new Promise((r) => setTimeout(r, 5)); });

        const enCurso = tarea("en-curso");
        // Sin pasar `prioridad`: la toma del contexto.
        const pendientes = [
            conPrioridadDeFondo(() => tarea("fondo-por-contexto")),
            tarea("interactiva-por-defecto"),
        ];
        await Promise.all([enCurso, ...pendientes]);

        expect(orden).toEqual(["en-curso", "interactiva-por-defecto", "fondo-por-contexto"]);
    });

    it("sin contexto, el default es interactiva", () => {
        // Fail-safe: un job nuevo que no pase por requireTenantAccess se
        // comporta como hoy en vez de quedar postergado sin que nadie lo note.
        expect(prioridadActual()).toBe("interactiva");
    });
});
