import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * SEC-02 de docs/security/audit-2026-09-21.md.
 *
 * 37 rutas aceptan `?mock=true` en el query y con eso SALTEAN el guard:
 *
 *     const isMock = searchParams.get("mock") === "true";
 *     if (!isMock) { await requireSuperAdmin(request); }
 *     const tenants = await listAllTenantsForSuperAdmin(isMock);
 *
 * 26 de esas rutas son `superadmin/*`. O sea que la autorizacion real no vive en
 * la ruta sino en que la funcion de servicio se acuerde de cortar antes de tocar
 * la base. Hoy las 22 cortan bien, pero no habia nada que lo obligara: la primera
 * que se olvide sirve datos reales a un llamador anonimo.
 *
 * `guardRutasApi.test.ts` NO cubre esta clase y pasa en verde igual, porque solo
 * afirma que la ruta *invoque* un mecanismo de auth — y estas lo invocan, adentro
 * de un `if`.
 *
 * Este test deriva la lista de las rutas y no de una constante escrita a mano: una
 * ruta nueva con el gate, o una funcion nueva que reciba `isMock`, entran solas.
 *
 * LO QUE NO CUBRE, y queda para revision humana: la E/S indirecta. Si la funcion
 * no llama a `pool.query` sino a un helper que adentro consulta, aca se ve limpia.
 * El arreglo de fondo sigue siendo sacar el gate del query param.
 */

const RAIZ_RUTAS = "src/app/api";
const RAICES_FUENTE = ["src/services", "src/lib"];

/** E/S directa. Si aparece antes del corte, el modo mock toca el mundo real. */
const EFECTOS = [/\bpool\.(query|execute)\s*\(/, /\bawait\s+fetch\s*\(/, /\bredis\.[a-z]+\s*\(/i];

const PALABRAS_CLAVE = new Set([
    "if", "while", "for", "switch", "return", "catch", "typeof", "await",
    "function", "const", "let", "var", "new", "throw",
]);

function listarArchivos(dir: string, sufijo: string): string[] {
    const salida: string[] = [];
    const recorrer = (d: string) => {
        for (const entrada of readdirSync(d)) {
            const p = join(d, entrada);
            if (statSync(p).isDirectory()) recorrer(p);
            else if (p.endsWith(sufijo)) salida.push(p);
        }
    };
    recorrer(dir);
    return salida;
}

/** Comentarios afuera: estos archivos estan muy comentados y un `pool.query` */
/** nombrado en una nota dispararia un falso positivo.                        */
function sinComentarios(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Nombres de funcion invocadas pasando `isMock` como argumento. */
function llamadasConIsMock(src: string): Set<string> {
    const nombres = new Set<string>();
    const re = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        const nombre = m[1];
        if (PALABRAS_CLAVE.has(nombre)) continue;
        // Recorre hasta el parentesis que cierra, contando anidados.
        let prof = 1;
        let i = m.index + m[0].length;
        const desde = i;
        while (i < src.length && prof > 0) {
            if (src[i] === "(") prof++;
            else if (src[i] === ")") prof--;
            i++;
        }
        const args = src.slice(desde, i - 1);
        if (/\bisMock\b/.test(args)) nombres.add(nombre);
    }
    return nombres;
}

/**
 * Cuerpo de la funcion exportada: desde su declaracion hasta el proximo `export`
 * de nivel superior. Se evita contar llaves a proposito — los literales de SQL
 * traen `${}` y un contador ingenuo termina cortando donde no es.
 */
function cuerpoDeFuncion(src: string, nombre: string): string | null {
    const decl = new RegExp(`export\\s+(?:async\\s+)?function\\s+${nombre}\\s*\\(`);
    const m = decl.exec(src);
    if (!m) return null;
    const resto = src.slice(m.index + m[0].length);
    const siguiente = resto.search(/\nexport\s/);
    return siguiente === -1 ? resto : resto.slice(0, siguiente);
}

function indiceDePrimerEfecto(cuerpo: string): number {
    let mejor = -1;
    for (const re of EFECTOS) {
        const m = re.exec(cuerpo);
        if (m && (mejor === -1 || m.index < mejor)) mejor = m.index;
    }
    return mejor;
}

function indiceDeCorte(cuerpo: string): number {
    const m = /if\s*\(\s*!?\s*isMock\s*\)/.exec(cuerpo);
    return m ? m.index : -1;
}

describe("SEC-02 — el modo mock tiene que cortar antes de tocar el mundo real", () => {
    const rutasConGate = listarArchivos(RAIZ_RUTAS, "route.ts").filter((p) => {
        const src = sinComentarios(readFileSync(p, "utf-8"));
        return /searchParams\.get\(["']mock["']\)/.test(src) && /if\s*\(\s*!isMock\s*\)/.test(src);
    });

    const fuentes = RAICES_FUENTE.flatMap((r) => listarArchivos(r, ".ts")).map((p) => ({
        path: p,
        src: sinComentarios(readFileSync(p, "utf-8")),
    }));

    const receptoras = new Set<string>();
    for (const p of rutasConGate) {
        for (const n of llamadasConIsMock(sinComentarios(readFileSync(p, "utf-8")))) receptoras.add(n);
    }

    it("hay rutas con el gate y funciones que reciben el flag (el test no quedo vacio)", () => {
        // Sin esto, un refactor que renombre `isMock` dejaria el test pasando
        // por no encontrar nada — verde por vacio, que es peor que rojo.
        expect(rutasConGate.length).toBeGreaterThan(20);
        expect(receptoras.size).toBeGreaterThan(10);
    });

    it("toda funcion que recibe isMock corta antes de cualquier E/S directa", () => {
        const fallas: string[] = [];

        for (const nombre of [...receptoras].sort()) {
            for (const { path, src } of fuentes) {
                const cuerpo = cuerpoDeFuncion(src, nombre);
                if (!cuerpo) continue;

                const efecto = indiceDePrimerEfecto(cuerpo);
                if (efecto === -1) continue; // sin E/S directa: nada que proteger

                const corte = indiceDeCorte(cuerpo);
                if (corte === -1) {
                    fallas.push(
                        `${nombre} (${path}): hace E/S pero NUNCA mira isMock. ` +
                        `Un ?mock=true anonimo llega hasta la base.`
                    );
                } else if (corte > efecto) {
                    fallas.push(
                        `${nombre} (${path}): mira isMock DESPUES de su primera E/S. ` +
                        `El corte tiene que ir antes.`
                    );
                }
            }
        }

        expect(fallas, `\n${fallas.join("\n")}\n`).toEqual([]);
    });
});
