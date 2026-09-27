// @vitest-environment node
/**
 * MEJ-38 — la SUPERFICIE que ve un usuario con alcance asignado.
 *
 * `alcanceComoPermiso.test.ts` cuida el mecanismo: que el default sea negar y
 * que las rutas conscientes corten. Esto cuida el MAPA, que es lo que la
 * auditoría encontró mal: el mecanismo estaba bien y la lista de permitidos
 * se ampliaba sola.
 *
 * La coincidencia era por prefijo, así que declarar una ruta habilitaba todo
 * lo que colgara debajo — incluso lo escrito después, incluso lo que no sabe
 * recortar. Dos rutas entraron así:
 *
 *   /api/intelligence/perspectives/breakdown      el gasto de TODOS los grupos
 *   /api/cost-groups/<x>/resource-groups          el inventario de cualquier grupo
 *
 * La primera es la peor: `/api/intelligence/perspectives` está permitida
 * porque —dice su comentario— «no devuelve un solo importe», y el prefijo le
 * regalaba a la subruta que devuelve todos.
 */
import { describe, it, expect } from "vitest";
import {
    rutaAdmiteAlcance,
    rutaRecorta,
    paginaAdmiteAlcance,
    PAGINAS_CON_ALCANCE,
} from "@/lib/scopeAwareRoutes";

describe("las dos fugas que encontró la auditoría", () => {
    it("el breakdown de una Perspective NO le responde, aunque su padre sí", () => {
        expect(rutaAdmiteAlcance("/api/intelligence/perspectives", "GET")).toBe(true);
        expect(rutaAdmiteAlcance("/api/intelligence/perspectives/breakdown", "GET")).toBe(false);
        expect(rutaAdmiteAlcance("/api/intelligence/perspectives/breakdown", "POST")).toBe(false);
    });

    it("los resource groups de un Cost Group NO, y el detalle SÍ", () => {
        expect(rutaAdmiteAlcance("/api/cost-groups/Marketing", "GET")).toBe(true);
        expect(rutaAdmiteAlcance("/api/cost-groups/Marketing/resource-groups", "GET")).toBe(false);
    });
});

describe("la propiedad general: una subruta nace negada", () => {
    // Si esto se rompe, volvió la coincidencia por prefijo y con ella el agujero.
    it.each([
        ["/api/cost-groups/x/y", "GET"],
        ["/api/intelligence/cost-centers/resources/algo", "GET"],
        ["/api/tenants/t1/tier-limits", "GET"],
        ["/api/billing/subscription/preview", "GET"],
        ["/api/exports/focus/lo-que-sea", "GET"],
    ])("%s %s queda afuera", (ruta, metodo) => {
        expect(rutaAdmiteAlcance(ruta, metodo)).toBe(false);
    });

    it("un `:param` vale por UN segmento, no por el resto del camino", () => {
        expect(rutaAdmiteAlcance("/api/tenant-logo/t1", "GET")).toBe(true);
        expect(rutaAdmiteAlcance("/api/tenant-logo/t1/extra", "GET")).toBe(false);
    });
});

describe("lo que el shell necesita para dibujarse", () => {
    it.each([
        "/api/tenants",
        "/api/subscriptions",
        "/api/me/scope",
        "/api/intelligence/perspectives",
        "/api/onboarding/progress",
        // La moneda del propio usuario: sin ella los importes salen en otra.
        "/api/fx/preference",
    ])("%s responde", (ruta) => {
        expect(rutaAdmiteAlcance(ruta, "GET")).toBe(true);
    });

    it("pero el shell no RECORTA: eso lo hacen los tableros", () => {
        expect(rutaRecorta("/api/fx/preference", "GET")).toBe(false);
        expect(rutaRecorta("/api/cost-groups", "GET")).toBe(true);
    });
});

describe("lo que la auditoría dejó negado a propósito", () => {
    // No son olvidos: cada una expone algo que el alcance debería recortar, o
    // es una escritura. Si alguna se habilita, que sea con un cambio de test.
    it.each([
        ["/api/admin/config/users", "GET"],   // la lista de usuarios del tenant
        ["/api/dashboard/summary", "GET"],    // el gasto del tenant entero
        ["/api/notifications", "GET"],        // avisos con importes ajenos
        ["/api/search", "GET"],               // inventario y pantallas que no tiene
        ["/api/intelligence/copilot", "POST"],// responde sobre todo el tenant
        ["/api/tags/apply-bulk", "POST"],     // escritura sobre recursos
    ])("%s %s sigue negada", (ruta, metodo) => {
        expect(rutaAdmiteAlcance(ruta, metodo)).toBe(false);
    });
});

describe("las páginas y las rutas no se contradicen", () => {
    it("toda página ofrecida tiene al menos una ruta que sabe recortar", () => {
        // El menú no puede ofrecer una pantalla cuya API no sepa acotar: el
        // usuario encontraría un 403 en vez de no encontrar la entrada.
        for (const pagina of PAGINAS_CON_ALCANCE) {
            expect(paginaAdmiteAlcance(pagina)).toBe(true);
        }
    });

    it("una página que no está en la lista no se ofrece", () => {
        expect(paginaAdmiteAlcance("/admin/users")).toBe(false);
        expect(paginaAdmiteAlcance("/intelligence/anomalies")).toBe(false);
    });
});
