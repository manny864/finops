import { describe, it, expect } from "vitest";
import { getAzureDdosProtection } from "@/services/azureDdosProtection.service";
import { MOCK_AZURE_TENANTS, isMockTenant } from "@/lib/mockData";

/**
 * Los cuatro tenants demo tienen que devolver datos en DDoS Protection.
 *
 * El defecto: `getAzureDdosProtection` decidia si era demo con un predicado
 * PROPIO --`startsWith("demo-")`, `startsWith("mock-")` y dos ids literales--
 * mientras que los tenants demo reales se identifican por UUID
 * (`22222222-...`). Ninguno matcheaba, asi que caian al camino vivo de Azure y
 * la pantalla salia vacia.
 *
 * Lo hacia mas dificil de ver: la RUTA (`/api/intelligence/ddos-protection`) si
 * usaba `isMockTenant` y decidia "es demo", y despues delegaba en esta funcion,
 * que volvia a decidir y decia que no. Dos predicados para la misma pregunta.
 *
 * Este test fija la respuesta a esa pregunta en un solo lugar: lo que
 * `isMockTenant` considera demo, el servicio lo tiene que servir con datos.
 */
describe("DDoS Protection · los tenants demo traen datos", () => {
    it("isMockTenant reconoce los cuatro tenants demo", () => {
        for (const tenantId of MOCK_AZURE_TENANTS) {
            expect(isMockTenant(tenantId), `${tenantId} deberia ser demo`).toBe(true);
        }
    });

    it.each(MOCK_AZURE_TENANTS)("%s devuelve planes, recursos y recomendaciones", async (tenantId) => {
        const data = await getAzureDdosProtection(tenantId);

        expect(data.resources.length, "sin recursos: el tenant cayo al camino vivo").toBeGreaterThan(0);
        expect(data.resources.some((r) => r.resourceType === "DDoS Plan")).toBe(true);
        expect(data.remediations.length).toBeGreaterThan(0);
    });

    it("el breakdown trae porciones con valor, no solo los niveles en cero", async () => {
        // El anillo de la pantalla filtra las porciones en 0 y, si no queda
        // ninguna, muestra el estado vacio. Si el mock diera todo en 0, el
        // grafico no se dibujaria y el tenant demo quedaria sin nada que ver
        // --que es justo el sintoma reportado--.
        for (const tenantId of MOCK_AZURE_TENANTS) {
            const data = await getAzureDdosProtection(tenantId);
            const conValor = data.summary.breakdown.filter((b) => b.costUSD > 0);
            expect(conValor.length, `${tenantId}: el anillo saldria vacio`).toBeGreaterThan(0);
        }
    });

    it("los nombres de suscripcion de demo no vienen en un solo idioma", async () => {
        const data = await getAzureDdosProtection(MOCK_AZURE_TENANTS[1]);
        const nombres = [...new Set(data.resources.map((r) => r.subscriptionName).filter(Boolean))];

        expect(nombres.length).toBeGreaterThan(0);
        // Son DATOS (un tenant real los nombra como quiere), no prosa a traducir:
        // lo que no puede pasar es que salgan en castellano para un lector en
        // ingles o portugues, que es como estaban ("Producción Principal").
        for (const n of nombres) {
            expect(n, `"${n}" trae acentos del castellano`).not.toMatch(/[áéíóúñÁÉÍÓÚÑ]/);
        }
    });
});
