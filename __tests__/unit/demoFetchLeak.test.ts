// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * MEJ-03 — los mocks son SÓLO para demo.
 *
 * Reproduce el interceptor de TenantProvider: se instala sincrónicamente
 * durante el render pero sólo se desinstala en un useEffect, y React corre los
 * efectos de los hijos ANTES que los del padre. Al pasar de un tenant demo a
 * uno real, los hijos ya dispararon sus fetches contra el parche todavía
 * instalado y el tenant real recibía cifras inventadas.
 *
 * En un producto de gestión de costos eso es lo peor que puede pasar: el
 * cliente decide sobre plata que no existe.
 */
const MOCK_BODY = JSON.stringify({ total: 999999, mock: true });
const REAL_BODY = JSON.stringify({ total: 1234.56, mock: false });

function instalarInterceptor(w: any, conGuarda: boolean) {
    const originalFetch = w.__finopsOriginalFetch || w.fetch;
    w.__finopsOriginalFetch = originalFetch;
    w.fetch = async (input: any, init?: any) => {
        const url = String(input);
        if (conGuarda && !w.__finopsDemoActive) return originalFetch(input, init);
        if (url.includes("/api/dashboard/summary")) {
            return new Response(MOCK_BODY, { status: 200 });
        }
        return originalFetch(input, init);
    };
}

let w: any;
beforeEach(() => {
    w = { fetch: vi.fn(async () => new Response(REAL_BODY, { status: 200 })) };
});

describe("interceptor demo de TenantProvider", () => {
    it("sirve el mock mientras el tenant demo está activo", async () => {
        w.__finopsDemoActive = true;
        instalarInterceptor(w, true);
        const body = await (await w.fetch("/api/dashboard/summary")).json();
        expect(body.mock).toBe(true);
    });

    // EL BUG: el parche sigue instalado en el render del cambio de tenant.
    it("SIN la guarda, un tenant real recibe datos inventados", async () => {
        w.__finopsDemoActive = true;
        instalarInterceptor(w, false);          // interceptor viejo
        w.__finopsDemoActive = false;           // el usuario cambió a un tenant real
        const body = await (await w.fetch("/api/dashboard/summary")).json();
        expect(body.mock).toBe(true);           // fuga: le devuelve el mock igual
        expect(body.total).toBe(999999);
    });

    it("CON la guarda, el tenant real recibe el dato real aunque el parche siga puesto", async () => {
        w.__finopsDemoActive = true;
        instalarInterceptor(w, true);
        w.__finopsDemoActive = false;           // mismo escenario
        const body = await (await w.fetch("/api/dashboard/summary")).json();
        expect(body.mock).toBe(false);
        expect(body.total).toBe(1234.56);
    });

    it("la bandera apagada deja pasar TODA url al fetch real", async () => {
        w.__finopsDemoActive = false;
        instalarInterceptor(w, true);
        for (const u of ["/api/dashboard/summary", "/api/budgets", "/api/intelligence/forecast"]) {
            const body = await (await w.fetch(u)).json();
            expect(body.mock, u).toBe(false);
        }
    });
});
