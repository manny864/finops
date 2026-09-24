// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

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
/**
 * Las intercepciones que este test SÍ comprueba: se invoca el handler real con
 * el tenant demo y se exige que el mock del interceptor traiga toda clave que
 * la ruta devuelve. La lista salió de barrer las 36 intercepciones que sirven
 * `getMockDataForRoute` (2026-09-24); así aparecieron las tres que divergían.
 */
const CASOS: Array<[string, string, () => Promise<any>]> = [
    ["/api/admin/billing-markup", "billing-markup", () => import("@/app/api/admin/billing-markup/route")],
    ["/api/budgets/alerts", "alerts", () => import("@/app/api/budgets/alerts/route")],
    ["/api/cleanup/ttl/history", "ttl_history", () => import("@/app/api/cleanup/ttl/history/route")],
    ["/api/cleanup/ttl/unlabeled", "ttl_unlabeled", () => import("@/app/api/cleanup/ttl/unlabeled/route")],
    ["/api/cost-groups", "cost_groups", () => import("@/app/api/cost-groups/route")],
    ["/api/governance/policies", "governance-policies", () => import("@/app/api/governance/policies/route")],
    ["/api/intelligence/ai-analytics", "ai-analytics", () => import("@/app/api/intelligence/ai-analytics/route")],
    ["/api/intelligence/aks", "aks", () => import("@/app/api/intelligence/aks/route")],
    ["/api/intelligence/aks-chargeback", "aks_chargeback", () => import("@/app/api/intelligence/aks-chargeback/route")],
    ["/api/intelligence/anomalies", "anomalies", () => import("@/app/api/intelligence/anomalies/route")],
    ["/api/intelligence/chargeback", "chargeback", () => import("@/app/api/intelligence/chargeback/route")],
    ["/api/intelligence/commitment-simulator", "commitment-simulator", () => import("@/app/api/intelligence/commitment-simulator/route")],
    ["/api/intelligence/commitments", "commitments", () => import("@/app/api/intelligence/commitments/route")],
    ["/api/intelligence/compute-cost-per-core", "compute-efficiency", () => import("@/app/api/intelligence/compute-cost-per-core/route")],
    ["/api/intelligence/cost-centers", "cost_centers", () => import("@/app/api/intelligence/cost-centers/route")],
    ["/api/intelligence/cost-projection", "cost-projection", () => import("@/app/api/intelligence/cost-projection/route")],
    ["/api/intelligence/forecast", "forecast", () => import("@/app/api/intelligence/forecast/route")],
    ["/api/intelligence/macc", "macc", () => import("@/app/api/intelligence/macc/route")],
    ["/api/intelligence/scorecard", "scorecard", () => import("@/app/api/intelligence/scorecard/route")],
    ["/api/intelligence/zero-cost", "zero_cost", () => import("@/app/api/intelligence/zero-cost/route")],
    ["/api/m365/overview", "m365_overview", () => import("@/app/api/m365/overview/route")],
    ["/api/tags", "tags", () => import("@/app/api/tags/route")],
    ["/api/tags/compliance", "tags_compliance", () => import("@/app/api/tags/compliance/route")],
];

/**
 * Las que el arnés no alcanza a hacer responder 200. NO están verificadas: se
 * listan para que el chequeo de abajo no las dé por cubiertas en silencio y
 * para que quien agregue los mocks que les faltan sepa cuáles son.
 */
const SIN_COBERTURA: Array<[string, string]> = [
    ["/api/admin/governance-policies", "governance-policies"], // HTTP_403: exige un rol que el arnes no simula
    ["/api/audit/full", "audit_full"], // HTTP_500: necesita mas mocks que `db` para llegar a su payload
    ["/api/audit/ttl", "ttl"], // HTTP_500: necesita mas mocks que `db` para llegar a su payload
    ["/api/billing/portal", "payments"], // HTTP_404: no responde GET con estos parametros
    ["/api/budgets/burn", "budgets_burn"], // HTTP_500: necesita mas mocks que `db` para llegar a su payload
    ["/api/dashboard/summary", "dashboard_summary"], // HTTP_401: autentica por un camino que el mock de requestAuth no cubre
    ["/api/intelligence/allocation-rules", "allocation-rules"], // HTTP_403: exige un rol que el arnes no simula
    ["/api/intelligence/network", "network"], // HTTP_500: necesita mas mocks que `db` para llegar a su payload
    ["/api/intelligence/rates", "rates"], // HTTP_500: necesita mas mocks que `db` para llegar a su payload
    ["/api/intelligence/rightsizing", "rightsizing"], // HTTP_400: pide parametros que este arnes no sabe armar
    ["/api/intelligence/tenant-health", "tenant_health"], // HTTP_500: necesita mas mocks que `db` para llegar a su payload
    ["/api/remediation/workflow", "approvals"], // HTTP_500: necesita mas mocks que `db` para llegar a su payload
];

/**
 * El chequeo que impide la recaída, que es la mitad de MEJ-03 que faltaba.
 *
 * Las dos listas de arriba se escriben a mano, así que se quedarían atrás solas.
 * Esto lee `TenantProvider.tsx` y exige que TODA intercepción que sirva
 * `getMockDataForRoute` esté en una de las dos. Agregar una intercepción nueva
 * sin verificarla —que es exactamente como nacieron las ocho divergencias que
 * MEJ-03 lleva encontradas— rompe el test.
 */
describe("ninguna intercepcion queda sin mirar (MEJ-03)", () => {
    it("toda intercepcion con getMockDataForRoute esta verificada o listada", () => {
        const fuente = readFileSync("src/components/TenantProvider.tsx", "utf-8");
        const enElCodigo = [...fuente.matchAll(/url\.includes\('([^']+)'\)[^\n]*?getMockDataForRoute\('([^']+)'/g)]
            .map((m) => m[1]);
        const conocidas = new Set([...CASOS.map((c) => c[0]), ...SIN_COBERTURA.map((c) => c[0])]);
        const nuevas = [...new Set(enElCodigo)].filter((u) => !conocidas.has(u));

        expect(
            nuevas,
            "intercepciones nuevas sin verificar: agregalas a CASOS (y si el arnes no las hace responder 200, a SIN_COBERTURA con el motivo)"
        ).toEqual([]);
    });
});

describe("forma del mock del interceptor vs la de la ruta (MEJ-03)", () => {
    it.each(CASOS)("%s: el interceptor trae todo lo que la ruta devuelve", async (url, clave, cargar) => {
        const mod = await cargar();
        const pedido = `https://x${url}?tenantId=demo&subscriptionId=All&days=30&period=30d&from=2026-08-01&to=2026-09-24&scope=All&months=6&limit=50&groupId=1&resourceGroup=rg-a&serviceName=Storage`;
        const respuesta = await mod.GET(new NextRequest(new URL(pedido)) as any);

        // Un 500 aca deja el test en verde comparando `{error}` contra el mock y
        // no prueba nada: el caso util es la ruta respondiendo su payload.
        expect(respuesta.status, `la ruta ${url} no respondio 200 con el tenant demo`).toBe(200);

        const delInterceptor = new Set(claves(getMockDataForRoute(clave as any, "demo")));
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
