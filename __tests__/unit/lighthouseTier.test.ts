// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { tierPuedeUsarLighthouse, LIGHTHOUSE_REQUIRED_TIER } from "@/lib/lighthouseTier";

const sinComentarios = (ruta: string) =>
    readFileSync(join(__dirname, "..", "..", ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * Azure Lighthouse es Enterprise.
 *
 * `routeTiers` ya lo declaraba, pero ese gate no se aplicaba nunca: el panel
 * dejó de ser página propia y hoy es una pestaña de `/admin/access`.
 * `RouteTierGate` resuelve el tier por `usePathname()` --que ahí da
 * `/admin/access`-- y `AdminHubGate` filtra por permisos y rol, no por tier. La
 * declaración decía Enterprise y la realidad era "cualquiera".
 */
describe("Lighthouse es Enterprise", () => {
    it("sólo Enterprise pasa", () => {
        expect(tierPuedeUsarLighthouse("Enterprise")).toBe(true);
        for (const t of ["Professional", "Business", "Community", "", null, undefined]) {
            expect(tierPuedeUsarLighthouse(t), `${t} no debería pasar`).toBe(false);
        }
    });

    it("un tier desconocido no abre la feature", () => {
        expect(tierPuedeUsarLighthouse("PlanInventado")).toBe(false);
    });

    it("las DOS rutas de API chequean el tier, no sólo la UI", () => {
        // Un bloqueo visual se saltea con un fetch. Y verificar es lo que
        // enciende access_model = 'lighthouse', así que sin gate un tenant de
        // otro tier podría quedar en un modo de acceso que su plan no incluye.
        for (const ruta of [
            "src/app/api/onboard/lighthouse/route.ts",
            "src/app/api/onboard/lighthouse/verify/route.ts",
        ]) {
            expect(sinComentarios(ruta), `${ruta} sin gate de tier`).toContain("tierPuedeUsarLighthouse");
        }
    });

    it("el panel avisa en vez de renderizar el formulario", () => {
        const panel = sinComentarios("src/components/admin/panels/LighthousePanel.tsx");
        expect(panel).toContain("TierLockedNotice");
        expect(panel).toMatch(/if \(!tierPuedeUsarLighthouse\(/);
    });

    it("el tier requerido sale de una sola constante", () => {
        expect(LIGHTHOUSE_REQUIRED_TIER).toBe("Enterprise");
    });
});

/**
 * Suscripciones que el plan deja afuera.
 *
 * La tabla de Cuentas Cloud sale de `getAllSubscriptionsForTenant`, que NO
 * trunca; los cockpits usan `getSubscriptionsForTenant`, que sí. Un Professional
 * con 4 suscripciones veía las 4 con la misma pinta mientras dos no aportaban un
 * dato.
 */
describe("marcado de suscripciones fuera del plan", () => {
    const svc = sinComentarios("src/services/tenantAccountStatus.service.ts");

    it("replica EXACTO el criterio del truncado real", () => {
        // Marcar por un orden distinto sería peor que no marcar: señalaría como
        // monitoreadas a las que no lo están.
        expect(svc).toMatch(/\.sort\(\)\.slice\(0, limite\)/);
    });

    it("Enterprise no marca nada", () => {
        expect(svc).toMatch(/if \(!Number\.isFinite\(limite\)\) return/);
    });

    it("las desvinculadas no ocupan cupo en el cálculo", () => {
        // Ya salieron del universo antes del truncado.
        expect(svc).toMatch(/items\.filter\(\(i\) => !i\.isUnlinked\)/);
    });

    it("el KPI de activas descuenta las que quedan fuera", () => {
        expect(svc).toMatch(/!s\.isUnlinked && !s\.isOverPlanLimit/);
    });
});
