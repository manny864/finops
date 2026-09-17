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

    /** El cuerpo de una función de azure.ts, sin sus comentarios. */
    function cuerpo(nombre: string): string {
        // Acepta `export async function`, `export function` y `async function`:
        // `getAllSubscriptionsForTenant` se partió en un wrapper sincrónico
        // (caché + deduplicación de llamadas en vuelo) y la implementación
        // `fetchAllSubscriptionsForTenant`, que es donde quedó el filtrado.
        const m = azure.match(
            new RegExp(`^(?:export\\s+)?(?:async\\s+)?function ${nombre}\\(`, "m")
        );
        expect(m?.index ?? -1, `no encontré ${nombre} en src/lib/azure.ts`).toBeGreaterThan(-1);
        const resto = azure.slice(m!.index!);
        // Corta en la próxima declaración de nivel superior, sea exportada o no.
        const fin = resto.slice(1).search(/\n(?:export |async function |function )/);
        return fin === -1 ? resto : resto.slice(0, fin + 1);
    }

    it("las DOS funciones de descubrimiento filtran las excluidas", () => {
        for (const fn of ["getSubscriptionsForTenant", "fetchAllSubscriptionsForTenant"]) {
            expect(
                cuerpo(fn),
                `${fn}() no llama a getExcludedSubscriptionIds: una suscripción desvinculada seguiría apareciendo en todo lo que use esta vía`
            ).toContain("getExcludedSubscriptionIds");
        }
    });

    it("el wrapper cacheado sigue delegando en la implementación que filtra", () => {
        // El filtrado vive en `fetchAllSubscriptionsForTenant`. Si el wrapper
        // dejara de delegar ahí --por ejemplo resolviendo desde otra fuente--
        // el test de arriba seguiría en verde sobre código muerto.
        expect(
            cuerpo("getAllSubscriptionsForTenant"),
            "getAllSubscriptionsForTenant() tiene que delegar en fetchAllSubscriptionsForTenant"
        ).toContain("fetchAllSubscriptionsForTenant(");
    });

    it("el caché del wrapper no guarda listados vacíos", () => {
        // Un listado vacío suele venir de un 429 o de un fallo de autorización.
        // Cachearlo dejaría al tenant sin suscripciones durante todo el TTL, que
        // es indistinguible de haberlas dado todas de baja.
        expect(
            cuerpo("getAllSubscriptionsForTenant"),
            "hay que comprobar que el listado no esté vacío antes de cachearlo"
        ).toMatch(/subs\.length\s*>\s*0/);
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

/**
 * MEJ-25 (2026-09-04): el camino de vuelta.
 *
 * `POST` sobre la ruta de account-status revincula desde el primer día, pero el
 * panel sólo tenía `handleUnlink`, y encima el servicio salteaba las excluidas
 * al armar la tabla. Sin fila no hay dónde poner el botón: la única forma de
 * revincular era pegarle a la API a mano.
 *
 * Listar las desvinculadas trae un riesgo que estos tests fijan: la tabla
 * alimenta `totalActiveSubscriptionsCount`, así que sumarlas sin filtrar
 * inflaría el KPI de suscripciones activas del tenant.
 */
describe("MEJ-25: revincular desde el panel", () => {
    const servicio = sinComentarios("src/services/tenantAccountStatus.service.ts");
    const panel = sinComentarios("src/components/admin/panels/CloudAccountsPanel.tsx");

    it("el servicio lista las desvinculadas en vez de saltearlas", () => {
        expect(
            servicio,
            "sin `isUnlinked` en el item no hay forma de dibujar la fila atenuada ni el botón"
        ).toContain("isUnlinked");
        expect(
            servicio,
            "volvió el `continue` sobre las excluidas: la fila desaparece y con ella el revincular"
        ).not.toMatch(/if\s*\(excluded\.has\(lower\)\)\s*continue/);
    });

    it("el contador de ACTIVAS no incluye las desvinculadas", () => {
        const m = servicio.match(/totalActiveSubscriptionsCount:\s*([^,\n]+)/);
        expect(m, "no encontré totalActiveSubscriptionsCount").not.toBeNull();
        expect(
            m![1],
            "ahora la lista trae también las desvinculadas: contarlas infla el KPI de suscripciones activas del tenant"
        ).toContain("isUnlinked");
    });

    it("el panel tiene el POST de revincular, no sólo el DELETE", () => {
        expect(panel, "falta handleRelink en el panel").toContain("handleRelink");
        expect(
            panel,
            'el revincular tiene que pegarle a la ruta de subscriptions con POST, no a sync-now'
        ).toMatch(/account-status\/subscriptions\/[\s\S]{0,400}?method:\s*"POST"/);
    });
});
