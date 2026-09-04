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
 * El sync manual sincroniza EL tenant, y su resultado se ve.
 *
 * Dos agujeros que se tapan juntos (2026-09-04), porque por separado ninguno se
 * nota:
 *
 * 1. `sync-now` mandaba `?tenantId=` desde siempre y `/api/cron/sync` nunca lo
 *    leía: `runSyncCore()` barría todos los tenants. El botón decía una cosa y
 *    hacía otra. Funcionaba de casualidad --el tenant quedaba cubierto por el
 *    barrido-- pero tardaba lo que tarda el barrido entero.
 *
 * 2. El resultado se escribía sólo en `tenant_health`, y el panel lee de
 *    `Tenants`. Un tenant sin credenciales fallaba con un mensaje perfectamente
 *    claro que no mostraba ninguna pantalla, mientras en `Tenants` quedaba el
 *    'syncing' optimista del disparo manual. Para siempre.
 */
describe("sync manual por tenant", () => {
    const cron = sinComentarios("src/app/api/cron/sync/route.ts");
    const db = sinComentarios("src/modules/storage/db.ts");

    it("cron/sync lee el tenantId y acota la consulta de tenants", () => {
        expect(cron, "sin leer el parámetro, el barrido sigue siendo global").toMatch(
            /searchParams\.get\("tenantId"\)/
        );
        expect(
            cron,
            "runSyncCore tiene que acotar el SELECT, no filtrar después de traer todos"
        ).toMatch(/soloTenantId\s*\?\s*` AND tenant_id = \?`/);
    });

    it("acotar por tenant no levanta el filtro de tenants activos", () => {
        // Pedir un tenant a mano no puede sincronizar uno dado de baja o con la
        // ingesta de Azure archivada.
        const select = cron.slice(cron.indexOf("SELECT tenant_id as id FROM Tenants"));
        const hasta = select.indexOf(");");
        expect(select.slice(0, hasta)).toContain('status = "active"');
        expect(select.slice(0, hasta)).toContain("provider_archived");
    });

    it("una corrida de un tenant no pisa el estado del barrido global", () => {
        // El job de Terraform hace polling de `?status=1` hasta ver done:true. Si
        // un disparo manual compartiera la clave, el job daría por terminado un
        // barrido que sigue corriendo.
        expect(cron, "faltan las claves de Redis por tenant").toContain("clavesDe");
        expect(cron).toMatch(/\$\{SYNC_STATUS_KEY\}:\$\{tenantId\}/);
        expect(cron).toMatch(/\$\{SYNC_LOCK_KEY\}:\$\{tenantId\}/);
    });

    it("el resultado del sync se escribe donde lo lee el panel", () => {
        expect(
            db,
            "updateTenantHealth tiene que denormalizar en Tenants: tenant_health no lo muestra ninguna pantalla"
        ).toMatch(/UPDATE Tenants[\s\S]{0,200}last_error_message/);
    });

    it("un sync fallido no adelanta last_sync_at", () => {
        // De ahí sale la antigüedad que decide si la ingesta está atrasada:
        // pisarlo en el error haría pasar por fresco a un tenant que hace una
        // semana no trae un dato.
        expect(db).toMatch(/ok\s*\?\s*'CURRENT_TIMESTAMP'\s*:\s*'last_sync_at'/);
    });
});
