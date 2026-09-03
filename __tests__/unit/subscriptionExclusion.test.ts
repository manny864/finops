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
 * MEJ-25: desvincular una suscripción escribe una EXCLUSIÓN en
 * `TenantExcludedSubscriptions`; no borra filas, porque el descubrimiento las
 * volvería a encontrar en el siguiente sync.
 *
 * EL BUG QUE FIJA ESTE ARCHIVO (2026-09-03)
 * `azure.ts` tiene DOS funciones de descubrimiento y sólo una aplicaba la
 * exclusión. El comentario de `getAllSubscriptionsForTenant` la llamaba "el
 * único punto por el que pasa todo colector y cockpit" y advertía que filtrar
 * por llamador dejaría la exclusión a medias. Era exactamente lo que pasaba,
 * por la razón opuesta: no había un punto, había dos.
 *
 * `getSubscriptionsForTenant` --la de 69 archivos, contra 16 de la otra-- no
 * filtraba. La suscripción desaparecía de Cuentas Cloud y seguía apareciendo en
 * Usuarios y Accesos y en el inventario de recursos.
 *
 * Se verifica sobre el código fuente porque el bug es estructural: las dos
 * funciones se comportan bien por separado, y lo que falla es que una omite un
 * paso que la otra hace. Un test de comportamiento sobre una sola no lo ve.
 */
describe("MEJ-25: la exclusión de suscripciones se aplica en todas las vías", () => {
    const azure = sinComentarios("src/lib/azure.ts");

    /** El cuerpo de una función exportada de azure.ts, sin sus comentarios. */
    function cuerpo(nombre: string): string {
        const i = azure.indexOf(`export async function ${nombre}(`);
        expect(i, `no encontré ${nombre} en src/lib/azure.ts`).toBeGreaterThan(-1);
        const resto = azure.slice(i);
        const fin = resto.indexOf("\nexport ", 1);
        return fin === -1 ? resto : resto.slice(0, fin);
    }

    it("las DOS funciones de descubrimiento filtran las excluidas", () => {
        for (const fn of ["getSubscriptionsForTenant", "getAllSubscriptionsForTenant"]) {
            expect(
                cuerpo(fn),
                `${fn}() no llama a getExcludedSubscriptionIds: una suscripción desvinculada seguiría apareciendo en todo lo que use esta vía`
            ).toContain("getExcludedSubscriptionIds");
        }
    });

    it("en la que trunca por plan, la exclusión va ANTES del truncado", () => {
        const fn = cuerpo("getSubscriptionsForTenant");
        const exclusion = fn.indexOf("getExcludedSubscriptionIds");
        const truncado = fn.indexOf("getEffectiveSubscriptionLimit");
        expect(exclusion).toBeGreaterThan(-1);
        expect(truncado).toBeGreaterThan(-1);
        expect(
            exclusion,
            "filtrando después del truncado, una suscripción desvinculada ocupa un cupo del plan y el cliente pierde una visible por cada baja"
        ).toBeLessThan(truncado);
    });

    it("el contador de cuota descuenta las excluidas", () => {
        // Si el que trunca excluye y el que cuenta no, el cliente deja de ver la
        // suscripción pero el medidor le sigue diciendo que la usa. Ese módulo
        // existe justamente para que las dos cuentas coincidan.
        expect(
            sinComentarios("src/lib/subscriptionQuota.ts"),
            "countStoredSubscriptions() tiene que restar TenantExcludedSubscriptions: las delegaciones y los CostSnapshots históricos sobreviven a la baja"
        ).toContain("TenantExcludedSubscriptions");
    });

    it("los horarios de encendido/apagado excluyen la suscripción dada de baja", () => {
        // Las VMs del tablero salen de Resource Graph acotado a las suscripciones
        // vigentes, pero los horarios salen de la tabla PowerSchedules. Sin este
        // filtro, una máquina de una suscripción dada de baja seguía apareciendo
        // en la programación, sin VM detrás.
        expect(
            sinComentarios("src/services/powerScheduleService.ts"),
            "listPowerSchedules() tiene que excluir TenantExcludedSubscriptions"
        ).toContain("TenantExcludedSubscriptions");
    });

    it("desvincular invalida todo el caché del tenant, no sólo el de costos", () => {
        // Varios payloads se cachean 15 minutos. Invalidar sólo las claves de
        // costo dejaba al inventario de cómputo listando las VMs de la
        // suscripción dada de baja, y el usuario lo veía como que el borrado no
        // había funcionado. Enumerar prefijos deja el agujero abierto para el
        // próximo módulo que agregue un caché.
        const ruta = "src/app/api/admin/config/account-status/subscriptions/[subscriptionId]/route.ts";
        expect(
            sinComentarios(ruta),
            "la invalidación tiene que barrer por patrón sobre el tenant"
        ).toMatch(/invalidateCachePattern\(`\*:\$\{tenantId\}/);
    });

    it("la exclusión se compara en minúsculas", () => {
        // Los GUID llegan con distinta capitalización según la fuente (ARM, Cost
        // Management, delegaciones). Comparar sin normalizar deja pasar la mitad.
        const fn = cuerpo("getSubscriptionsForTenant");
        expect(fn).toContain("toLowerCase()");
    });
});
