// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * El runner de los Container App Jobs vive como JS embebido en el `command` del
 * job, dentro del modulo de terraform. No se puede importar, asi que el test
 * EXTRAE el fragmento de decision del .tf y lo evalua: se prueba el codigo que
 * realmente se despliega, no una copia.
 *
 * POR QUE EXISTE ESTE TEST
 * Una falla parcial no es una falla del job: si 24 de 25 workloads se
 * precalentaron, el barrido funciono y el que falto se calcula on-demand.
 * Marcar la ejecucion como Failed genera una alerta por corrida y entrena a
 * todo el mundo a ignorarlas -- y ahi se pierde la alerta legitima.
 *
 * Ya se arreglo una vez (2026-09-17) y no funciono: el arreglo usaba DOS
 * cadenas de precedencia independientes, una para el exito y otra para el
 * total, que podian resolver en dimensiones distintas. `prewarm-compute`
 * reporta `tenantsTotal: 5` Y `workloadsTotal: 25`, asi que comparaba 24
 * workloads exitosos contra 5 tenants totales: `24 < 5` es falso, no detectaba
 * la parcialidad y salia con codigo 1 igual. Medido en prod el 2026-09-18:
 * prewarm-compute fallo 5 de 24 corridas y prewarm-databases 11 de 24.
 */
const TF = join(__dirname, "..", "..", "infra/terraform/modules/cronjobs/main.tf");

type Decision = { okCount: unknown; totalCount: unknown; parcial: boolean; exito: boolean };

function decidir(status: Record<string, unknown>): Decision {
    const tf = readFileSync(TF, "utf8");
    const ini = tf.indexOf("var par = typeof status.tenantsOk");
    const marcaFin = "var exito = status.ok || parcial;";
    const fin = tf.indexOf(marcaFin) + marcaFin.length;
    if (ini < 0 || fin < marcaFin.length) throw new Error("no se encontro el fragmento de decision en el .tf");
    const snippet = tf.slice(ini, fin);
    return new Function("status", `${snippet}; return { okCount, totalCount, parcial, exito };`)(status) as Decision;
}

/** Cuerpos REALES observados en Log Analytics el 2026-09-18. */
const PARCIALES: Array<[string, Record<string, unknown>]> = [
    [
        "compute 24 de 25 workloads",
        { ok: false, processedTenants: 5, tenantsTotal: 5, workloadsTotal: 25, workloadsSuccess: 24, workloadsFailed: 1 },
    ],
    [
        "databases 58 de 60 endpoints",
        { ok: false, processedTenants: 5, tenantsTotal: 5, endpointsTotal: 60, endpointsSuccess: 58, endpointsFailed: 2 },
    ],
    [
        "databases 56 de 60 endpoints",
        { ok: false, processedTenants: 5, tenantsTotal: 5, endpointsTotal: 60, endpointsSuccess: 56, endpointsFailed: 4 },
    ],
    ["dashboard 3 de 5 tenants", { ok: false, tenantsOk: 3, tenantsTotal: 5 }],
];

describe("una falla parcial no marca fallido al job", () => {
    for (const [nombre, status] of PARCIALES) {
        it(`${nombre}: sale con exito`, () => {
            const d = decidir(status);
            expect(d.parcial).toBe(true);
            expect(d.exito).toBe(true);
        });
    }

    it("el exito y el total se leen de la MISMA dimension", () => {
        // El bug: `prewarm-compute` trae tenantsTotal(5) y workloadsTotal(25).
        // Si el total se resuelve por su cuenta, gana tenantsTotal y la
        // comparacion queda sin sentido.
        const d = decidir({
            ok: false,
            tenantsTotal: 5,
            workloadsTotal: 25,
            workloadsSuccess: 24,
        });
        expect(d.okCount).toBe(24);
        expect(d.totalCount).toBe(25);
    });
});

/**
 * La version anterior de este test REIMPLEMENTABA la decision en TypeScript en
 * vez de leerla del .tf. Por eso quedo en verde mientras produccion seguia
 * marcando ejecuciones fallidas: el test probaba una copia correcta de una
 * logica que en el archivo real estaba mal. De ahi que ahora se extraiga y
 * evalue el fragmento, y que estos guards miren el texto del modulo.
 */
describe("la logica vive en el terraform, no solo en el test", () => {
    const tf = readFileSync(TF, "utf8");

    it("el par exito/total se resuelve junto", () => {
        expect(tf).toContain("var par = typeof status.tenantsOk === 'number'");
        expect(tf).toContain("var okCount = par[0];");
        expect(tf).toContain("var totalCount = par[1];");
    });

    it("no vuelven las dos cadenas independientes", () => {
        // Es la forma exacta que fallaba: el total resolviendose por su cuenta.
        expect(tf, "volvio la cadena independiente para el total").not.toMatch(
            /var totalCount = typeof status\.tenantsTotal === 'number' \? status\.tenantsTotal/,
        );
    });

    it("no vuelve el todo-o-nada en la salida", () => {
        // `salir()` y no `process.exit()`: ver cronSalidaLimpia.test.ts -- los
        // jobs rapidos quedaban Failed habiendo terminado bien.
        expect(tf).toMatch(/salir\(exito \? 0 : 1\)/);
        expect(tf, "volvio el todo-o-nada").not.toMatch(/\bsalir\(status\.ok \? 0 : 1\)/);
        expect(tf, "volvio el todo-o-nada").not.toMatch(/process\.exit\(status\.ok \? 0 : 1\)/);
    });
});

describe("una falla real sigue alertando", () => {
    it("cero exitos sale con codigo de error", () => {
        // Es lo que el arreglo NO puede romper: si se silencia todo, la alerta
        // deja de servir para lo unico que importa.
        const d = decidir({ ok: false, tenantsTotal: 5, workloadsTotal: 25, workloadsSuccess: 0, workloadsFailed: 25 });
        expect(d.parcial).toBe(false);
        expect(d.exito).toBe(false);
    });

    it("una corrida entera exitosa sale bien", () => {
        const d = decidir({ ok: true, tenantsTotal: 5, workloadsTotal: 25, workloadsSuccess: 25, workloadsFailed: 0 });
        expect(d.exito).toBe(true);
    });
});
