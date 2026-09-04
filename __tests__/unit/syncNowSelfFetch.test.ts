// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
const sinComentarios = (ruta: string) =>
    readFileSync(join(RAIZ, ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * Los self-fetch van por loopback, nunca por el dominio público.
 *
 * EL BUG (2026-09-04): `sync-now` armaba el origin como
 * `NEXT_PUBLIC_APP_URL || request.nextUrl.origin`. Esa variable no está
 * definida en ningún entorno --no es build arg ni variable de runtime-- así que
 * siempre caía en el dominio público, y el proceso salía por el proxy a
 * Internet para volver a entrar por su propia IP. Hairpin NAT: falla al
 * instante con un `fetch failed` de undici, y la UI lo mostraba como
 * "No se pudo iniciar la sincronización manual: fetch failed".
 *
 * `admin/load-test/run` ya había resuelto lo mismo y lo dejó documentado, pero
 * sin nada que lo fijara: el patrón se volvió a escribir mal en otra ruta. Esto
 * cubre las dos.
 *
 * Ojo con lo que este test NO dice: `request.nextUrl.origin` es lo CORRECTO
 * para armar links que van en un mail o en una respuesta —ahí querés el dominio
 * público—. Lo que se prohíbe es usarlo como destino de un fetch del propio
 * proceso, así que se verifican esas dos rutas y no un grep global.
 */
describe("self-fetch por loopback", () => {
    const RUTAS = [
        "src/app/api/admin/config/account-status/sync-now/route.ts",
        "src/app/api/admin/load-test/run/route.ts",
    ];

    it.each(RUTAS)("%s arma el origin con 127.0.0.1", (ruta) => {
        const src = sinComentarios(ruta);
        expect(src, "el origin del self-fetch tiene que ser loopback").toContain("http://127.0.0.1:");
        expect(
            src,
            "volvió el dominio público como destino del self-fetch: hairpin NAT y `fetch failed`"
        ).not.toMatch(/const origin[^\n]*nextUrl\.origin/);
    });

    it("sync-now también marca error cuando el job responde 4xx/5xx", () => {
        // `fetch` sólo rechaza por fallos de transporte: sin mirar `res.ok`, un
        // 401 por CRON_SECRET desalineado dejaba al tenant en 'syncing' para
        // siempre, sin error visible en ningún lado.
        const src = sinComentarios(RUTAS[0]);
        expect(src).toMatch(/res\.ok/);
    });
});
