// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { store, leidas, delPedidos } = vi.hoisted(() => ({
    store: new Map<string, string>(),
    leidas: [] as string[],
    delPedidos: [] as string[],
}));

// Redis falso: lo que las pantallas escriben y lo que la remediación borra pasan por acá.
vi.mock("@/lib/redis", () => ({
    redis: {
        status: "ready",
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => (store.set(k, v), "OK"),
        del: async (...ks: string[]) => {
            for (const k of ks) { delPedidos.push(k); store.delete(k); }
            return ks.length;
        },
        keys: async (patron: string) => {
            const re = new RegExp(`^${patron.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
            return [...store.keys()].filter((k) => re.test(k));
        },
    },
}));

// La pantalla le entrega a la caché la clave que lee: se la anota en el Redis falso y se corta ahí, sin
// ir a Azure. El resto de la caché (invalidateCache, invalidateCachePattern) es el real.
vi.mock("@/lib/cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/cache")>()),
    getWithStaleWhileRevalidate: async (clave: string) => {
        leidas.push(clave);
        store.set(clave, "{}");
        throw new Error("corte: sólo interesa la clave");
    },
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ email: "ana@x.com" })),
    requireTenantRole: vi.fn(async () => ({ email: "ana@x.com" })),
    requireTenantTier: vi.fn(async () => undefined),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/scopeDelTenant", () => ({
    exigirSuscripcionDelTenant: vi.fn(async () => undefined),
    exigirScopesDelTenant: vi.fn(async () => undefined),
}));
vi.mock("@/lib/lighthouseAccess", () => ({ bloqueoPorDelegacionDeLectura: vi.fn(async () => null) }));
vi.mock("@/services/remediationService", () => ({ deleteResource: vi.fn(async () => undefined) }));
vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn(async () => [[]]) },
    initializeDatabase: vi.fn(async () => undefined),
}));

import { GET as zombis } from "@/app/api/cleanup/zombies/route";
import { GET as zombisDeRed } from "@/app/api/cleanup/zombies/networking/route";
import { GET as auditoriaCompleta } from "@/app/api/audit/full/route";
import { GET as auditoriaTtl } from "@/app/api/audit/ttl/route";
import { GET as advisor } from "@/app/api/advisor/route";
import { POST as purgar } from "@/app/api/remediation/route";

/**
 * Purgar un recurso (POST /api/remediation) tiene que dejar sin caché a toda pantalla que lo lista; si no, el
 * recurso ya borrado sigue apareciendo hasta que vence el TTL (15 min en zombis).
 *
 * Este test no conoce ninguna clave. Corre los GET REALES de las cinco pantallas (cada una escribe en el Redis
 * falso la clave que lee), purga un recurso y mira qué quedó en pie y qué se pidió borrar. Antes se comparaba
 * contra un literal copiado, y así la ruta siguió invalidando `cleanup:zombies:v2:azure:…`,
 * `cleanup:zombies-networking:v1:…` y `advisor:<tenant>:es` cuando las pantallas ya leían v5, v3 y
 * `advisor:v4:…`: ninguna de las tres existía, y nadie lo vio.
 *
 * Una pantalla nueva que cachee una lista de recursos purgables se agrega a PANTALLAS: el test sólo ve las que
 * están ahí.
 */
const T = "tenant-a-0001"; // sin "demo" ni "mock": isMockTenant lo trataría como demo
const OTRO = "tenant-b-0002";
const SUB = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";

const PANTALLAS: Record<string, (r: NextRequest) => Promise<Response>> = {
    zombis,
    "zombis de red": zombisDeRed,
    "auditoría completa": auditoriaCompleta,
    "auditoría TTL": auditoriaTtl,
    advisor,
};

async function abrirPantallas(tenantId: string, subscriptionId?: string, locale?: string) {
    const u = new URL("http://localhost/api/x");
    u.searchParams.set("tenantId", tenantId);
    if (subscriptionId) u.searchParams.set("subscriptionId", subscriptionId);
    if (locale) u.searchParams.set("locale", locale);
    // De a una: con `leidas` compartido, en paralelo la escritura de otra pantalla taparía a la que no llegó.
    for (const [nombre, GET] of Object.entries(PANTALLAS)) {
        const antes = leidas.length;
        await GET(new NextRequest(u));
        // Si una pantalla falla antes de llegar a la caché, el test no estaría probando nada de ella.
        expect(leidas.length, `${nombre} no llegó a la caché`).toBeGreaterThan(antes);
    }
}

/** Lo que hay cacheado después de que dos tenants abrieron todo: sin filtro de suscripción y con uno, y el advisor en varios idiomas. */
async function llenarCache() {
    for (const tenant of [T, OTRO]) {
        await abrirPantallas(tenant);
        await abrirPantallas(tenant, SUB);
        // El advisor cachea por idioma: el de la URL o, sin él, el header Accept-Language entero.
        for (const locale of ["en", "pt-BR", "es-ES,es;q=0.9"]) {
            await abrirPantallas(tenant, undefined, locale);
            await abrirPantallas(tenant, SUB, locale);
        }
    }
}

const purgarRecurso = () =>
    purgar(
        new NextRequest("http://localhost/api/remediation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                tenantId: T,
                subscriptionId: SUB,
                resourceGroup: "rg-test",
                resourceName: "disco-1",
                resourceType: "microsoft.compute/disks",
                resourceId: `/subscriptions/${SUB}/resourceGroups/rg-test/providers/microsoft.compute/disks/disco-1`,
                domain: "zombies",
            }),
        })
    );

const clavesDe = (tenantId: string) => [...store.keys()].filter((k) => k.includes(tenantId)).sort();

beforeEach(() => {
    store.clear();
    leidas.length = 0;
    delPedidos.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/remediation invalida la caché que leen las pantallas", () => {
    it("tras purgar, ninguna pantalla sigue sirviendo su lista cacheada", async () => {
        await llenarCache();
        expect(clavesDe(T).length).toBeGreaterThan(0);

        const res = await purgarRecurso();

        expect(res.status).toBe(200);
        expect(clavesDe(T)).toEqual([]);
    });

    it("no pide borrar claves que ninguna pantalla lee", async () => {
        await llenarCache();

        await purgarRecurso();

        expect(delPedidos.length).toBeGreaterThan(0);
        expect(delPedidos.filter((k) => !leidas.includes(k))).toEqual([]);
    });

    it("no toca la caché de otro tenant", async () => {
        await llenarCache();
        const antes = clavesDe(OTRO);
        expect(antes.length).toBeGreaterThan(0);

        await purgarRecurso();

        expect(clavesDe(OTRO)).toEqual(antes);
    });

    // audit:full baja la suscripción a minúsculas en su clave y la purga también, así que coinciden aunque la
    // pantalla se haya abierto con el GUID en mayúsculas. Si esa normalización se pierde, la lista queda cacheada.
    it("invalida audit:full aunque la pantalla se haya abierto con la suscripción en mayúsculas", async () => {
        await auditoriaCompleta(
            new NextRequest(`http://localhost/api/audit/full?tenantId=${T}&subscriptionId=${SUB.toUpperCase()}`)
        );
        expect(clavesDe(T).length).toBeGreaterThan(0);

        await purgarRecurso();

        expect(clavesDe(T)).toEqual([]);
    });
});
