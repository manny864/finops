// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * El mock del interceptor tiene que tener la misma FORMA que lo que sirve la
 * ruta (MEJ-03).
 *
 * `TenantProvider` parchea `window.fetch` en tenants demo y responde con
 * `getMockDataForRoute(...)`. Cuando esa forma se queda atrás del contrato que
 * la ruta devuelve, no hay error: el panel queda vacío o absurdo, y se ve como
 * "la demo no tiene datos". Así aparecieron los seis casos que MEJ-03 ya
 * documenta —`/api/advisor` con los KPIs en 0, `top-expenses` todo en $0.00,
 * `resources/*` a 46.000 USD por recurso— y ninguno tiró una excepción.
 *
 * La regla: toda clave que la RUTA devuelve tiene que existir en el mock del
 * interceptor. Al revés no importa; una clave de más nadie la lee.
 *
 * Se invoca el handler de verdad en vez de comparar contra una constante
 * exportada: así el test sigue al contrato aunque la ruta lo arme sobre la
 * marcha, que es como lo arman tres de estas cuatro.
 */

const auth = vi.hoisted(() => {
    class AuthErrorMock extends Error {
        status = 401;
    }
    return { AuthErrorMock, requireTenantAccess: vi.fn(async () => ({ email: "demo@demo" })) };
});

vi.mock("@/lib/requestAuth", () => ({
    AuthError: auth.AuthErrorMock,
    requireTenantAccess: auth.requireTenantAccess,
    requireTenantTier: async () => ({ email: "demo@demo" }),
    requireTenantRole: async () => ({ email: "demo@demo" }),
    requireSuperAdmin: async () => ({ email: "demo@demo" }),
}));
vi.mock("@/modules/storage/db", () => ({
    default: { query: async () => [[]] },
    insertAICostSnapshotRow: async () => {},
}));

import { getMockDataForRoute } from "@/lib/mockData";

/** Claves hasta dos niveles, con `[]` para el primer elemento de un array. */
function claves(v: any, prefijo = "", nivel = 0): string[] {
    if (nivel > 1 || !v || typeof v !== "object") return [];
    if (Array.isArray(v)) return v.length ? claves(v[0], `${prefijo}[]`, nivel) : [];
    return Object.keys(v).flatMap((k) => {
        const p = prefijo ? `${prefijo}.${k}` : k;
        return [p, ...claves(v[k], p, nivel + 1)];
    });
}

/**
 * `billing` no está en esta lista porque **ya no se intercepta** (MEJ-03,
 * 2026-09-22): la ruta sirve su propio mock sin token para el tenant de demo, y
 * el `case 'billing'` de `mockData.ts` se borró. Lo que había que evitar ahí era
 * exactamente lo que este test mide —la copia se quedó en el contrato viejo
 * (`data[]`) mientras la ruta pasaba a `services`/`top5ShareOfWallet`/`byRegion`,
 * y la pantalla de Consumo Real de la demo quedó vacía sin que nada fallara—.
 * Sin copia no hay nada que comparar; lo que queda por cuidar es el otro lado, y
 * está en el `describe` del final.
 */
const CASOS: { ruta: string; clave: string; url: string }[] = [
    { ruta: "ai-analytics", clave: "ai-analytics", url: "https://x/api/intelligence/ai-analytics?tenantId=demo" },
    { ruta: "anomalies", clave: "anomalies", url: "https://x/api/intelligence/anomalies?tenantId=demo" },
    { ruta: "aks-chargeback", clave: "aks_chargeback", url: "https://x/api/intelligence/aks-chargeback?tenantId=demo" },
];

describe("forma del mock del interceptor vs la de la ruta (MEJ-03)", () => {
    it.each(CASOS)("$ruta: el interceptor trae todo lo que la ruta devuelve", async ({ ruta, clave, url }) => {
        const mod = await import(`@/app/api/intelligence/${ruta}/route`);
        const respuesta = await mod.GET(new NextRequest(new URL(url)) as any);

        // Un 500 acá deja el test en verde comparando `{error}` contra el mock y
        // no prueba nada: el caso util es la ruta respondiendo su payload.
        expect(respuesta.status, `la ruta ${ruta} no respondio 200 con el tenant demo`).toBe(200);

        const delInterceptor = new Set(claves(getMockDataForRoute(clave, "demo")));
        const faltantes = claves(await respuesta.json()).filter((k) => !delInterceptor.has(k));

        expect(
            faltantes,
            `el mock de '${clave}' en mockData.ts no trae estas claves que la ruta si devuelve: en la demo van a salir vacias`
        ).toEqual([]);
    });
});

/**
 * Sacar una intercepción mueve el riesgo, no lo elimina: ahora la demo depende
 * de que la ruta siga siendo alcanzable SIN token y de que su payload siga
 * trayendo lo que la pantalla lee. Si alguien vuelve a poner el
 * `requireTenantAccess` antes del chequeo de mock, la demo pasa de datos a un
 * 401 — y con la intercepción borrada, no hay red abajo.
 */
describe("billing sirve su propio mock a la demo, sin interceptor (MEJ-03)", () => {
    // `requireTenantAccess` RECHAZA en este describe, que es lo que hace en la
    // realidad con la demo: /demo no deja identidad de Entra. Con un mock que
    // resuelve siempre, mover el auth delante del chequeo de mock no rompe
    // ningun test y la regresion pasa igual --se comprobo con mutante--.
    beforeEach(() => {
        // mockClear y no solo mockImplementation: `toHaveBeenCalled` mira TODAS
        // las llamadas acumuladas del mock, y las rutas de arriba ya lo llamaron.
        // Sin limpiar, el test de "sigue necesitando token" pasa aunque la ruta
        // no autentique a nadie --comprobado con mutante--.
        auth.requireTenantAccess.mockClear();
        auth.requireTenantAccess.mockImplementation(async () => {
            throw new auth.AuthErrorMock("No autorizado.");
        });
    });
    afterEach(() => {
        auth.requireTenantAccess.mockImplementation(async () => ({ email: "demo@demo" }));
    });

    it("responde sin token y con lo que leen los dos dashboards", async () => {
        const mod = await import("@/app/api/intelligence/billing/route");
        const r = await mod.GET(new NextRequest(new URL("https://x/api/intelligence/billing?tenantId=demo")) as any);

        expect(r.status, "la demo no manda token: si la ruta autentica antes del mock, le vacia la pantalla").toBe(200);

        const cuerpo = await r.json();
        // `services` y `top5ShareOfWallet` las lee RealConsumptionDashboard;
        // `byRegion`, BillingDashboard. Son de las que faltaban en el mock viejo.
        for (const clave of ["services", "top5ShareOfWallet", "byRegion", "overview", "period"]) {
            expect(cuerpo[clave], `falta '${clave}': la pantalla de la demo lo lee`).toBeDefined();
        }
        expect(Array.isArray(cuerpo.services) && cuerpo.services.length > 0).toBe(true);
    });

    it("un tenant que no es de demo sigue necesitando token", async () => {
        const mod = await import("@/app/api/intelligence/billing/route");
        const r = await mod.GET(new NextRequest(new URL("https://x/api/intelligence/billing?tenantId=acme-real")) as any);
        expect(auth.requireTenantAccess).toHaveBeenCalled();
        expect(r.status).not.toBe(200);
    });
});
