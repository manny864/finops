// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Toda ruta que ESCRIBE en la Azure del cliente tiene que chequear si la
 * delegación de Lighthouse permite escribir.
 *
 * Sin el chequeo, un tenant con delegación de sólo lectura recibe el 403 crudo
 * de Azure, que no distingue "la plataforma no tiene permiso" de "el cliente no
 * delegó escritura" — y el segundo lo arregla el cliente, no nosotros.
 *
 * ── Sobre el alcance de este test, que es su parte importante ──
 *
 * El primer intento buscaba llamadas de mutación del SDK con un regex sobre los
 * archivos de ruta. Detectaba 1 de 7: las mutaciones pasan por servicios
 * (`deleteResource`, `createSubscriptionBudget`, `startVirtualMachine`), no por
 * el SDK en la ruta. Un test así habría pasado en verde dejando pasar
 * exactamente lo que venía a cubrir.
 *
 * El segundo intento siguió los imports un nivel: marcó las 26 rutas como
 * mutantes, porque TODAS importan `lib/azure.ts` para pedir la credencial y ese
 * módulo contiene llamadas de mutación. Otro falso positivo, del lado opuesto.
 *
 * El tercero siguió los cuerpos de las funciones y marcó `logAction()` como
 * mutación, porque la extracción del cuerpo se derramaba en las funciones
 * vecinas del mismo archivo.
 *
 * La causa de fondo de que ninguna heurística sirviera: dos de las siete
 * escrituras que faltaban NO usan un método reconocible del SDK. `admin/workbooks`
 * llama a `beginCreateOrUpdateAndWait` (el sufijo `AndWait` rompe cualquier lista
 * de nombres) y `auto-block/deploy` hace `fetch(url, { method: "PUT" })` contra
 * `management.azure.com` directamente. Un regex de nombres del SDK no puede
 * verlas, y por eso las clasificaciones de abajo se hicieron LEYENDO cada ruta.
 *
 * Así que este test hace lo que SÍ puede afirmar:
 *
 *   1. Las rutas cuya escritura está verificada a mano llaman al guard. Fija lo
 *      auditado para que no se caiga en una refactorización.
 *   2. Una ruta nueva con método mutante que pida credencial de Azure aparece
 *      en la lista de revisión pendiente. No falla —muchas son POST de lectura
 *      con body— pero obliga a clasificarla.
 */

const GUARD = "bloqueoPorDelegacionDeLectura";

/** Escritura en Azure confirmada leyendo la ruta y el servicio que invoca. */
const ESCRIBEN_EN_AZURE: Array<[ruta: string, porque: string]> = [
    ["remediation", "deleteResource: borra el recurso"],
    ["power", "startVirtualMachine / deallocate: cambia el estado de la VM"],
    ["tags/apply", "tagsOperations.beginUpdateAtScope"],
    ["tags/apply-bulk", "tagsOperations.beginUpdateAtScope"],
    ["resourcegroups", "resourceGroups.createOrUpdate"],
    ["budgets/create", "createSubscriptionBudget: el presupuesto es un recurso de Azure"],
    ["budgets/delete", "deleteSubscriptionBudget"],
    ["admin/workbooks", "resources.beginCreateOrUpdateAndWait: el Workbook es un recurso"],
    ["governance/auto-block/deploy", "PUT y DELETE a policyAssignments por fetch a ARM"],
    ["governance/auto-block/remediate", "escribe la remediación de la política"],
    ["intelligence/commitments/reservations/renew", "PATCH a ARM sobre la reserva"],
];

/**
 * Verificadas como LECTURA aunque su método sea POST. Se listan para que la
 * próxima auditoría no las vuelva a revisar desde cero.
 */
const VERIFICADAS_COMO_LECTURA = [
    "cleanup/zombies",             // sólo estima costo; el borrado va por /api/remediation
    "cleanup/zombies/networking",  // idem
    "cleanup/ttl",                 // upsertExemption: exención en nuestra base
    "governance/tags/inherit-rg",  // applyTagInheritance escribe en NUESTRA base, no en Azure
    "governance/tags",             // lee el inventario de etiquetas
    "governance/tags/apply-inheritance", // encola; el apply real va por tags/apply-bulk
    "governance/approvals",        // flujo de aprobación en nuestra base; ejecuta vía /api/remediation
    "governance/ha",               // recomendaciones de alta disponibilidad, sólo lectura
    "power/schedule",              // upsertPowerSchedule escribe en NUESTRA base
    "admin/governance-policies",   // consulta definiciones de política
    "analytics/allocation",        // saveRule: regla de prorrateo en nuestra base
    "automation/kill-switch",      // marca el switch en nuestra base
    "cost-groups/[name]",          // detalle de grupo, sólo lectura
    "intelligence/azure-ai",       // métricas de IA
    "intelligence/unit-economics", // cálculo sobre datos ya recolectados
    "onboard/lighthouse",          // registra la delegación en nuestra base
];

function rutas(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) rutas(p, out);
        else if (entry === "route.ts") out.push(p);
    }
    return out;
}

describe("Lighthouse · guard de escritura sobre la Azure del cliente", () => {
    it("las rutas con escritura confirmada llaman al guard", () => {
        const sinGuard: string[] = [];
        for (const [ruta, porque] of ESCRIBEN_EN_AZURE) {
            const archivo = `src/app/api/${ruta}/route.ts`;
            expect(existsSync(archivo), `${archivo} no existe: ¿se movió la ruta?`).toBe(true);
            if (!readFileSync(archivo, "utf8").includes(GUARD)) {
                sinGuard.push(`${ruta} — ${porque}`);
            }
        }
        expect(sinGuard, sinGuard.join("\n")).toEqual([]);
    });

    it("el guard devuelve el código que la UI distingue, y no bloquea a los tenants mock", () => {
        const lib = readFileSync("src/lib/lighthouseAccess.ts", "utf8");
        expect(lib).toContain("ERR_LIGHTHOUSE_READ_ONLY");
        // Un tenant mock no tiene Azure detrás: bloquearlo rompería la demo.
        expect(lib).toMatch(/isMockTenant\(tenantId\)\)\s*return null/);
    });

    it("no hay rutas nuevas sin clasificar como escritura o lectura", () => {
        const MUTANTE = /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/;
        const CREDENCIAL = /getAzureCredential|getLighthouseCredential/;
        const conocidas = new Set([
            ...ESCRIBEN_EN_AZURE.map(([r]) => r),
            ...VERIFICADAS_COMO_LECTURA,
        ]);

        const sinClasificar = rutas("src/app/api")
            .filter((archivo) => {
                const s = readFileSync(archivo, "utf8");
                return MUTANTE.test(s) && CREDENCIAL.test(s);
            })
            .map((a) => a.replace(/^src\/app\/api\//, "").replace(/\/route\.ts$/, ""))
            .filter((r) => !conocidas.has(r));

        // Este assert es la parte que envejece: cuando alguien agregue una ruta
        // con método mutante y credencial de Azure, va a fallar acá y tiene que
        // decidir si escribe (→ ESCRIBEN_EN_AZURE + el guard) o sólo lee
        // (→ VERIFICADAS_COMO_LECTURA, con el motivo).
        expect(
            sinClasificar,
            sinClasificar.length
                ? `Rutas con método mutante y credencial de Azure sin clasificar:\n` +
                  sinClasificar.map((r) => `  - ${r}`).join("\n") +
                  `\n\nLeé cada una: si escribe en Azure, sumala a ESCRIBEN_EN_AZURE y agregale el guard.\n` +
                  `Si su POST sólo lee, sumala a VERIFICADAS_COMO_LECTURA con el motivo.`
                : "",
        ).toEqual([]);
    });
});
