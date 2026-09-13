// @vitest-environment node
//
// `node` y no el jsdom por defecto: este test sólo lee archivos, y levantar un
// jsdom que no usa alcanzó para desbordar el pool de workers y matar por
// timeout los `await import()` de once tests de otros archivos. Sin el pragma:
// 12 fallos; con él, 3039 en verde. Todo test que sólo toque el filesystem
// debería llevarlo.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Cuándo se puede sacar una intercepción del interceptor de demo.
 *
 * El interceptor parchea `window.fetch`, y cada URL que atrapa es superficie de
 * riesgo: ese parche llegó a servirle mocks a un tenant REAL (MEJ-03), que en un
 * producto de costos es el peor error posible. Así que conviene que atrape lo
 * mínimo.
 *
 * MEJ-03 clasificó 79 intercepciones como "redundantes" porque la ruta ya
 * mockea del lado servidor. Medido acá, esa condición NO alcanza: hacen falta
 * DOS cosas.
 *
 *  1. Que la ruta devuelva el MISMO payload
 *     (`return NextResponse.json(getMockDataForRoute('<misma clave>', tenantId))`).
 *  2. Que el short-circuit de `isMockTenant` esté ANTES de
 *     `requireTenantAccess`. La demo no tiene token: si la ruta autentica
 *     primero, sacar la intercepción cambia un panel con datos por un 401.
 *
 * Hoy hay 8 intercepciones que cumplen (1) y fallan (2) — aks, alerts, macc,
 * scorecard, zero-cost, allocation-rules, compute-cost-per-core y
 * admin/governance-policies. Se intentó sacarlas y se revirtió: el payload es
 * idéntico, pero en demo no se puede llegar a él. Para poder sacarlas hay que
 * mover primero el chequeo de mock antes del auth en esas rutas, que es una
 * decisión sobre qué se sirve sin token.
 */
const raiz = process.cwd();
const provider = fs.readFileSync(path.join(raiz, "src/components/TenantProvider.tsx"), "utf8");

const intercepciones = provider
    .split("\n")
    .map((linea, i) => ({ linea, nro: i + 1 }))
    .filter(({ linea }) => !linea.trim().startsWith("//"))
    .map(({ linea, nro }) => {
        const m = linea.match(/url\.includes\('([^']+)'\)[\s\S]*?getMockDataForRoute\('([^']+)'/);
        return m ? { url: m[1], clave: m[2], nro } : null;
    })
    .filter((x): x is { url: string; clave: string; nro: number } => x !== null);

const rutaDe = (url: string) => path.join(raiz, "src/app", url, "route.ts");
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function analizar(url: string, clave: string) {
    const f = rutaDe(url);
    if (!fs.existsSync(f)) return null;
    const lineas = fs.readFileSync(f, "utf8").split("\n");
    const src = lineas.join("\n");
    const idx = (re: RegExp) => lineas.findIndex((l) => re.test(l));
    const auth = idx(/await require(TenantAccess|TenantRole)\(/);
    const mock = idx(/if \(isMockTenant\(/);
    const verbatim = new RegExp(
        `return\\s+NextResponse\\.json\\(\\s*getMockDataForRoute\\(\\s*'${escapar(clave)}'\\s*,[^)]*\\)\\s*\\)`
    ).test(src);
    return { verbatim, alcanzableSinToken: mock !== -1 && (auth === -1 || mock < auth) };
}

describe("interceptor de demo", () => {
    it("hay intercepciones para analizar", () => {
        expect(intercepciones.length).toBeGreaterThan(10);
    });

    it("no queda ninguna intercepción que ya se pueda sacar sin romper la demo", () => {
        const sacables = intercepciones
            .filter(({ url, clave }) => {
                const a = analizar(url, clave);
                return a?.verbatim && a.alcanzableSinToken;
            })
            .map(({ url, clave, nro }) => `${url} -> '${clave}' (TenantProvider.tsx:${nro})`);
        expect(
            sacables,
            "la ruta sirve el mismo payload y es alcanzable sin token: sacá la intercepción"
        ).toEqual([]);
    });

    it("ninguna URL genérica tapa a una más específica declarada después", () => {
        // `/api/intelligence/aks` matchea también `/api/intelligence/aks-chargeback`.
        // Hoy el orden es correcto; si alguien reordena, la específica deja de
        // servirse y su panel muestra los datos de otra.
        const tapadas: string[] = [];
        intercepciones.forEach(({ url, nro }, i) => {
            for (const otra of intercepciones.slice(i + 1)) {
                if (otra.url.startsWith(url) && otra.url !== url) {
                    tapadas.push(`linea ${nro} '${url}' tapa a linea ${otra.nro} '${otra.url}'`);
                }
            }
        });
        expect(tapadas).toEqual([]);
    });

    it("toda intercepción apunta a una ruta que existe", () => {
        const muertas = intercepciones
            .filter(({ url }) => !fs.existsSync(rutaDe(url)))
            .map((x) => `${x.url} (:${x.nro})`);
        expect(muertas, "intercepción sin ruta real: nunca dispara").toEqual([]);
    });
});
