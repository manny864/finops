// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const tf = readFileSync(join(__dirname, "..", "..", "infra/terraform/modules/cronjobs/main.tf"), "utf8");

/**
 * Una falla PARCIAL de un cron no es una falla del job.
 *
 * `prewarm-dashboard` terminaba con `tenantsOk: 4, tenantsTotal: 5, ok: false`
 * — cuatro de cinco tenants bien y uno mal configurado. `ok` es todo-o-nada
 * (`okCount === results.length`), así que el runner salía con 1, Azure marcaba
 * la ejecución fallida y disparaba una alerta. Cada 10 minutos: 100 de 200
 * ejecuciones en rojo.
 *
 * La aplicación YA distinguía los dos casos (`recordCronRun` registra
 * `status: "warning"` ante fallas parciales); el matiz se perdía en el exit
 * code, que es lo único que Azure mira.
 *
 * El costo no era el ruido sino la señal: una alerta legítima se perdía entre
 * cien falsas.
 */
describe("el runner de cron distingue parcial de fallido", () => {
    /** Extrae el fragmento de decisión y lo evalúa como el runner lo evaluaría. */
    function decidir(status: Record<string, unknown>): { exito: boolean; codigo: number } {
        const parcial =
            typeof status.tenantsOk === "number" && status.tenantsOk > 0 &&
            typeof status.tenantsTotal === "number" && status.tenantsOk < (status.tenantsTotal as number);
        const exito = Boolean(status.ok) || parcial;
        return { exito, codigo: status.ok ? 200 : parcial ? 207 : 500 };
    }

    it("4 de 5 tenants OK sale 0, no 1", () => {
        const r = decidir({ done: true, ok: false, tenantsTotal: 5, tenantsOk: 4, tenantsFailed: 1 });
        expect(r.exito, "una falla parcial no puede marcar el job como fallido").toBe(true);
        expect(r.codigo).toBe(207);
    });

    it("cero tenants OK sigue siendo falla", () => {
        // Si no terminó ninguno, el barrido no funcionó y la alerta es legítima.
        const r = decidir({ done: true, ok: false, tenantsTotal: 5, tenantsOk: 0, tenantsFailed: 5 });
        expect(r.exito).toBe(false);
        expect(r.codigo).toBe(500);
    });

    it("todo OK sigue siendo 200", () => {
        const r = decidir({ done: true, ok: true, tenantsTotal: 5, tenantsOk: 5, tenantsFailed: 0 });
        expect(r.exito).toBe(true);
        expect(r.codigo).toBe(200);
    });

    it("un job sin contadores de tenant no se ve afectado", () => {
        // Los jobs que no reportan tenantsOk/tenantsTotal mantienen el
        // comportamiento anterior: `ok` manda.
        expect(decidir({ done: true, ok: false }).exito).toBe(false);
        expect(decidir({ done: true, ok: true }).exito).toBe(true);
    });

    it("el terraform lleva la lógica, no sólo este test", () => {
        expect(tf).toContain("var parcial = typeof status.tenantsOk === 'number'");
        // `salir()` y no `process.exit()`: ver cronSalidaLimpia.test.ts — los
        // jobs rápidos quedaban Failed habiendo terminado bien.
        expect(tf).toMatch(/salir\(exito \? 0 : 1\)/);
        expect(tf, "volvió el todo-o-nada").not.toMatch(/\bsalir\(status\.ok \? 0 : 1\)/);
        expect(tf, "volvió el todo-o-nada").not.toMatch(/process\.exit\(status\.ok \? 0 : 1\)/);
    });
});
