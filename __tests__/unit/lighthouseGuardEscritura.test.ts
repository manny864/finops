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
 *   2. Una ruta nueva con método mutante que pida credencial de Azure, o que
 *      llame a una función que escribe en Azure, aparece en la lista de
 *      revisión pendiente. No falla —muchas son POST de lectura con body— pero
 *      obliga a clasificarla.
 *   3. Esas mismas rutas exigen que el scope que llega a ARM sea del tenant
 *      (`exigirScopesDelTenant`): con Lighthouse la credencial alcanza a todos
 *      los clientes delegados.
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
    ["intelligence/monitoring/alerts", "cambiarEstadoEnAzure: PATCH a ARM que activa o desactiva la regla"],
    ["intelligence/monitoring/action-groups", "cambiarEstadoEnAzure: PATCH a ARM sobre el action group"],
    // Las siguientes se encontraron el 2026-10-06 siguiendo cada función que
    // escribe en Azure hasta sus rutas: unas no estaban clasificadas y otras
    // figuraban como lectura.
    ["remediation/downgrade", "downgradeVirtualMachine: resize de la VM"],
    ["advisor", "deleteResource en la acción delete"],
    ["automation/kill-switch", "deallocate de todas las VMs del resource group"],
    ["admin/governance-policies", "PUT y DELETE de policyAssignments en el management group"],
    ["governance/approvals", "executeApprovedAction: DELETE, PATCH y snapshot al aprobar"],
    ["governance/tags", "applyTagInheritance: PATCH de etiquetas"],
    ["governance/tags/inherit-rg", "applyTagInheritance: PATCH de etiquetas a los hijos del RG"],
    ["governance/tags/apply-inheritance", "applyTagInheritance cuando dryRun es false"],
    ["intelligence/defender", "setDefenderPlanTier: PUT del plan de Defender"],
];

/**
 * Funciones de servicio que escriben en Azure. Llamar a una es escribir aunque
 * la ruta no pida la credencial: por ahí se colaron downgrade, defender,
 * approvals y las tres de etiquetas.
 */
const ESCRITORES =
    /\b(?:deleteResource|downgradeVirtualMachine|deallocateVirtualMachine|startVirtualMachine|restartVirtualMachine|createSubscriptionBudget|deleteSubscriptionBudget|deployFinOpsWorkbook|setReservationRenew|cambiarEstadoEnAzure|executeApprovedAction|applyTagInheritance|setDefenderPlanTier)\(/;

/**
 * La segunda frontera: el scope que llega a ARM tiene que ser del tenant. Con
 * Lighthouse la credencial es una sola para todos los clientes delegados, así
 * que sin esto un Admin de un cliente borraba o apagaba recursos de otro
 * pasando sus ids en el body.
 */
const SCOPE = "exigirScopesDelTenant";

/** Cuando el chequeo de scope vive en el servicio que arma la URL, no en la ruta. */
const SCOPE_EN_SERVICIO: Record<string, string> = {
    "intelligence/monitoring/alerts": "src/services/azureAlertsRules.service.ts",
    "intelligence/monitoring/action-groups": "src/services/azureAlertsRules.service.ts",
};

/**
 * Verificadas como LECTURA aunque su método sea POST. Se listan para que la
 * próxima auditoría no las vuelva a revisar desde cero.
 */
const VERIFICADAS_COMO_LECTURA = [
    "cleanup/zombies",             // sólo estima costo; el borrado va por /api/remediation
    "cleanup/zombies/networking",  // idem
    "cleanup/ttl",                 // upsertExemption: exención en nuestra base
    "governance/ha",               // recomendaciones de alta disponibilidad, sólo lectura
    "power/schedule",              // upsertPowerSchedule escribe en NUESTRA base (el cron ejecuta)
    "analytics/allocation",        // saveRule: regla de prorrateo en nuestra base
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

    it("las rutas con escritura confirmada exigen que el scope sea del tenant", () => {
        const sinChequeo: string[] = [];
        for (const [ruta, porque] of ESCRIBEN_EN_AZURE) {
            const archivo = SCOPE_EN_SERVICIO[ruta] ?? `src/app/api/${ruta}/route.ts`;
            if (!readFileSync(archivo, "utf8").includes(`await ${SCOPE}(`)) sinChequeo.push(`${ruta} — ${porque}`);
        }
        // El cron de horarios apaga y prende VMs que eligió quien creó el horario.
        if (!readFileSync("src/services/powerScheduleService.ts", "utf8").includes(`await ${SCOPE}(`)) {
            sinChequeo.push("cron de power schedules — powerScheduleService");
        }
        expect(sinChequeo, sinChequeo.join("\n")).toEqual([]);
    });

    it("ninguna ruta verificada como lectura llama a una función que escribe en Azure", () => {
        const escriben = VERIFICADAS_COMO_LECTURA.filter((r) =>
            ESCRITORES.test(readFileSync(`src/app/api/${r}/route.ts`, "utf8")),
        );
        expect(escriben, `Figuran como lectura pero escriben en Azure: ${escriben.join(", ")}`).toEqual([]);
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
                return MUTANTE.test(s) && (CREDENCIAL.test(s) || ESCRITORES.test(s));
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
