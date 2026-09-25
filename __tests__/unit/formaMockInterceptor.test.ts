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

/**
 * El tenant de demo Enterprise, el mismo que reconoce `isMockTenant`. Va
 * `vi.hoisted` porque las factories de `vi.mock` lo usan y se evalúan antes.
 * No alcanza con el literal "demo": varias rutas resuelven el tier buscando el
 * id en la lista de tenants mock, y con "demo" caen a Professional.
 */
const TENANT = vi.hoisted(() => "33333333-4444-5555-6666-777777777777");

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
    // `network` saca el tenant de la identidad, no del query param.
    requireRequestIdentity: async () => ({ email: "demo@demo", oid: "demo-oid", tenantId: TENANT }),
}));
// Sin esto el arnes intenta abrir Redis de verdad (ECONNREFUSED 6379) y varias
// rutas caen a su rama degradada en vez de devolver su payload.
vi.mock("@/lib/cache", () => ({
    getWithCache: async (_k: string, f: () => any) => f(),
    getWithStaleWhileRevalidate: async (_k: string, f: () => any) => f(),
    invalidateCache: async () => {},
    invalidateCachePattern: async () => {},
    costGroupsCacheKeys: () => [],
}));
vi.mock("@/modules/storage/db", () => ({
    // La consulta de tier se responde con Enterprise porque ASI ES en la base:
    // los cuatro tenants de demo estan sembrados. Sin eso, rutas como
    // `governance-policies` resuelven 'Professional' y cortan con 403 antes de
    // llegar a su rama mock, y el test mediría el 403 y no el contrato.
    default: {
        query: async (sql: unknown) =>
            /SELECT\s+[^;]*\btier\b[^;]*FROM\s+Tenants/i.test(String(sql)) ? [[{ tier: "Enterprise" }]] : [[]],
    },
    initializeDatabase: async () => {},
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
    ["/api/admin/governance-policies", "governance-policies", () => import("@/app/api/admin/governance-policies/route")],
    ["/api/intelligence/allocation-rules", "allocation-rules", () => import("@/app/api/intelligence/allocation-rules/route")],
    ["/api/intelligence/network", "network", () => import("@/app/api/intelligence/network/route")],
    ["/api/intelligence/perspectives", "perspectives", () => import("@/app/api/intelligence/perspectives/route")],
    ["/api/intelligence/tenant-health", "tenant_health", () => import("@/app/api/intelligence/tenant-health/route")],
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
/**
 * Cubiertas por TYPECHECK y no por este test.
 *
 * Su handler no se puede invocar con un tenant de demo —piden credenciales de
 * Azure o base antes de cualquier rama mock—, asi que la comparacion en runtime
 * no llega. En su lugar, el mock se ata al contrato con `MockContracts` +
 * `satisfies` en mockData.ts: si la ruta cambia de forma y nadie toca el mock,
 * rompe la compilacion. Comprobado con mutante sobre `budgets_burn`.
 *
 * Estan listadas para que el chequeo de abajo no las reporte como nuevas, y
 * para que se vea que NO estan sin mirar.
 */
const ATADAS_POR_TIPO: string[] = [
    "/api/budgets/burn",
    "/api/intelligence/rates",
    "/api/intelligence/rightsizing",
    "/api/remediation/workflow",
    "/api/audit/full",
    "/api/dashboard/summary",
];

/**
 * Vacia desde el 2026-09-25: las 33 intercepciones vivas estan cubiertas, 27 por
 * la comparacion de arriba y 5 por typecheck. Se deja la lista --y no se borra--
 * porque el chequeo de "ninguna intercepcion queda sin mirar" la necesita para
 * el caso en que aparezca una que el arnes no alcance y tampoco se pueda atar.
 */
const SIN_COBERTURA: Array<[string, string]> = [
    // El handler responde 400 sin `id`, y el arnes no sabe cual inventar. La
    // divergencia igual no puede darse: el mock lo calcula con `repartir()`, la
    // MISMA funcion que usa la ruta, asi que no hay una segunda copia de la
    // logica que se pueda atrasar.
    ["/api/intelligence/perspectives/breakdown", "perspectives_breakdown"],
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
        const conocidas = new Set([...CASOS.map((c) => c[0]), ...ATADAS_POR_TIPO, ...SIN_COBERTURA.map((c) => c[0])]);
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
        const pedido = `https://x${url}?tenantId=${TENANT}&subscriptionId=All&days=30&period=30d&from=2026-08-01&to=2026-09-24&scope=All&months=6&limit=50&groupId=1&resourceGroup=rg-a&serviceName=Storage`;
        // `Authorization` porque `dashboard/summary` corta con 401 antes de
        // cualquier guard si no viene; `x-tenant-id` porque `network` saca el
        // tenant de ahi y no del query param. Las dos las manda el navegador.
        const respuesta = await mod.GET(new NextRequest(new URL(pedido), {
            headers: { authorization: "Bearer demo", "x-tenant-id": TENANT },
        }) as any);

        // Un 500 aca deja el test en verde comparando `{error}` contra el mock y
        // no prueba nada: el caso util es la ruta respondiendo su payload.
        expect(respuesta.status, `la ruta ${url} no respondio 200 con el tenant demo`).toBe(200);

        const cuerpo = await respuesta.json();
        // Un 200 degradado enga\u00f1a igual que un 500: `{error}` o `{degraded:true}`
        // tienen pocas claves, la comparacion pasa sola y la ruta queda contada
        // como verificada sin haber devuelto su contrato.
        expect(
            { error: cuerpo?.error, degraded: cuerpo?.degraded },
            `la ruta ${url} respondio 200 pero degradada: comparar contra eso no prueba nada`
        ).toEqual({ error: undefined, degraded: undefined });

        const delInterceptor = new Set(claves(getMockDataForRoute(clave as any, "enterprise")));
        const faltantes = claves(cuerpo).filter((k) => !delInterceptor.has(k));

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
