// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * La cola de espera del pool de MySQL tiene que ser FINITA.
 *
 * Con `queueLimit: 0` —el default de mysql2, y lo que había— la petición que
 * llega con las 10 conexiones ocupadas espera sin límite. Encadenado con el
 * techo de ~240 s del ingress de Container Apps, el usuario no ve "la base está
 * ocupada": ve un 504 sin explicación. Es la causa que se venía tapando con
 * `async_poll` en los crons, que arregló el reporte y no la latencia.
 *
 * El caso que este test cubre y que un `expect(DB_QUEUE_LIMIT).toBe(20)` no
 * cubriría: **`DB_QUEUE_LIMIT=0` en el entorno**. Es el valor que alguien
 * escribiría creyendo que significa "sin cola", y reintroduce exactamente el
 * cuelgue que veníamos a sacar, en silencio y sólo en producción. Por eso el
 * clamp está en el código y no sólo en la documentación.
 *
 * Se lee con `vi.resetModules()` porque el valor se resuelve una vez, al cargar
 * el módulo: `createPool()` corre en el top-level.
 */

const cargar = async () => {
    vi.resetModules();
    return (await import("@/modules/storage/db")).DB_QUEUE_LIMIT;
};

describe("cola del pool de MySQL", () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => vi.unstubAllEnvs());

    it("por defecto es finita", async () => {
        vi.stubEnv("DB_QUEUE_LIMIT", "");
        const limite = await cargar();
        expect(limite).toBe(20);
    });

    it("respeta un valor explícito del entorno", async () => {
        vi.stubEnv("DB_QUEUE_LIMIT", "50");
        expect(await cargar()).toBe(50);
    });

    for (const valor of ["0", "-5", "abc"]) {
        it(`DB_QUEUE_LIMIT="${valor}" NO reintroduce la espera infinita`, async () => {
            vi.stubEnv("DB_QUEUE_LIMIT", valor);
            const limite = await cargar();
            expect(limite).toBeGreaterThanOrEqual(1);
            expect(Number.isFinite(limite)).toBe(true);
        });
    }
});
