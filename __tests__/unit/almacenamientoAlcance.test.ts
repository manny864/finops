// @vitest-environment node
/**
 * MEJ-34 — el tablero de almacenamiento, acotado.
 *
 * Lo que se cuida acá no es el filtro (eso ya tiene tests propios) sino la
 * ELECCIÓN DE FUENTE, que es lo único no obvio de esta adopción: el costo de
 * storage sale de tres tablas y sólo una tiene con qué evaluar una Perspective.
 *
 *   CostSnapshots          subscription_id, resource_group, ResourceId, Tags ✔
 *   CostMeterSnapshots     tenant_id, subscription_id                        ✘
 *   CostCategorySnapshots  tenant_id, subscription_id                        ✘
 *
 * Verificado contra el esquema, no supuesto. Servir el total de medidores bajo
 * alcance mostraría el gasto de todo el tenant; mezclarlo con una parte
 * recortada daría un número que no es de nadie.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, filtroMock, alcanceRutaMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    filtroMock: vi.fn(),
    alcanceRutaMock: vi.fn(),
}));

const IDENT = { email: "u@u", tenantId: "t1", claims: {}, isCorporateDomain: false };
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => IDENT),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => null }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/cache", () => ({
    getWithStaleWhileRevalidate: (_k: string, fn: () => any) => fn(),
}));
vi.mock("@/services/perspectivesData.service", async (orig) => ({
    ...(await orig<any>()),
    filtroDeLaRequest: filtroMock,
    alcanceDeLaRuta: alcanceRutaMock,
    exigirRecorte: vi.fn(),
}));

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([[]]);
    filtroMock.mockReset().mockResolvedValue(null);
    alcanceRutaMock.mockReset().mockResolvedValue({ and: "", params: [], aplicado: false, recorte: null });
});

/** Qué tablas tocó la ruta en esta llamada. */
const tablas = () =>
    queryMock.mock.calls.map(([s]) => String(s)).reduce((acc: Record<string, number>, s) => {
        for (const t of ["CostSnapshots", "CostMeterSnapshots", "CostCategorySnapshots"]) {
            // `FROM X` exacto: "CostSnapshots" es subcadena de nada, pero
            // "CostMeterSnapshots" no debe contarse como "CostSnapshots".
            if (new RegExp(`FROM\\s+${t}\\b`).test(s)) acc[t] = (acc[t] || 0) + 1;
        }
        return acc;
    }, {});

describe("service-cost — de qué tabla sale el número", () => {
    const pedir = () =>
        import("@/app/api/intelligence/storage/service-cost/route").then(({ GET }) =>
            GET(new NextRequest("http://localhost/api/intelligence/storage/service-cost?tenantId=t1&family=managed-disks"))
        );

    it("SIN alcance sigue prefiriendo los medidores, como siempre", async () => {
        await pedir();
        const t = tablas();
        expect(t.CostMeterSnapshots || 0).toBeGreaterThan(0);
    });

    it("CON alcance no toca ninguna de las dos tablas sin dimensiones", async () => {
        alcanceRutaMock.mockResolvedValue({
            and: "AND (COALESCE(resource_group,'') IN (?))", params: ["rg-datos"], aplicado: true, recorte: null,
        });
        await pedir();
        const t = tablas();
        expect(t.CostMeterSnapshots || 0).toBe(0);
        expect(t.CostCategorySnapshots || 0).toBe(0);
        expect(t.CostSnapshots || 0).toBeGreaterThan(0);
    });

    it("y el predicado viaja en la consulta, con sus parámetros", async () => {
        alcanceRutaMock.mockResolvedValue({
            and: "AND (COALESCE(resource_group,'') IN (?))", params: ["rg-datos"], aplicado: true, recorte: null,
        });
        await pedir();
        const conRecorte = queryMock.mock.calls.find(([s]) => String(s).includes("COALESCE(resource_group,'')"));
        expect(conRecorte).toBeDefined();
        expect(conRecorte?.[1]).toContain("rg-datos");
    });

    it("la respuesta declara si el recorte se aplicó", async () => {
        alcanceRutaMock.mockResolvedValue({ and: "", params: [], aplicado: true, recorte: null });
        const j = await (await pedir()).json();
        expect(j.alcanceAplicado).toBe(true);
    });
});

describe("la clave de caché lleva el alcance", () => {
    it("dos alcances distintos no comparten entrada", async () => {
        const claves: string[] = [];
        vi.doMock("@/lib/cache", () => ({
            getWithStaleWhileRevalidate: (k: string, fn: () => any) => { claves.push(k); return fn(); },
        }));
        vi.resetModules();
        alcanceRutaMock.mockResolvedValue({ and: "", params: [], aplicado: true, recorte: null });

        const { GET } = await import("@/app/api/intelligence/storage/service-cost/route");
        await GET(new NextRequest("http://localhost/api/intelligence/storage/service-cost?tenantId=t1&family=backups&perspective=1&pgroup=Datos"));
        await GET(new NextRequest("http://localhost/api/intelligence/storage/service-cost?tenantId=t1&family=backups&perspective=1&pgroup=Redes"));

        // Sin esto, la porción del primero se le serviría al segundo durante 6 h.
        expect(claves[0]).not.toBe(claves[1]);
        vi.doUnmock("@/lib/cache");
    });
});

describe("el mapa de MEJ-38 conoce las dos mitades", () => {
    it("las dos rutas responden, y la página se puede ofrecer", async () => {
        const { rutaAdmiteAlcance, rutaRecorta, paginaAdmiteAlcance } = await import("@/lib/scopeAwareRoutes");
        for (const r of ["/api/intelligence/storage-efficiency", "/api/intelligence/storage/service-cost"]) {
            expect(rutaAdmiteAlcance(r, "GET")).toBe(true);
            expect(rutaRecorta(r, "GET")).toBe(true);
        }
        expect(paginaAdmiteAlcance("/intelligence/almacenamiento/storage-accounts-finops-cmp")).toBe(true);
    });
});

describe("storage-efficiency — vacío no es lo mismo que «no se puede acotar»", () => {
    /** Filas de detalle como las devuelve `CostSnapshots`. */
    const fila = (rg: string) => ({
        subscription_id: "sub-1", resource_group: rg, service_name: "Storage",
        ResourceId: `/subs/sub-1/rg/${rg}/x`, Tags: null,
        MeterName: "Hot LRS", MeterSubCategory: "Blob", MeterCategory: "Storage",
        ServiceFamily: "Storage", quantity: 10, UnitOfMeasure: "GB/Month", billedCost: 100,
    });

    async function pedir(conFilas: { snapshots: any[]; medidores: any[] }) {
        queryMock.mockImplementation(async (sql: string) => {
            const s = String(sql);
            if (/FROM\s+CostMeterSnapshots\b/.test(s)) return [conFilas.medidores];
            if (/FROM\s+CostSnapshots\b/.test(s)) return [conFilas.snapshots];
            return [[]];
        });
        const { GET } = await import("@/app/api/intelligence/storage-efficiency/route");
        return GET(new NextRequest("http://localhost/api/intelligence/storage-efficiency?tenantId=t1&days=30"));
    }

    it("con alcance y datos SÓLO en medidores, avisa en vez de mostrar la pantalla vacía", async () => {
        // Es el caso peligroso: "tu grupo no tiene storage" sería mentira.
        filtroMock.mockResolvedValue(() => true);
        const r = await pedir({ snapshots: [], medidores: [{ subscription_id: "sub-1", billedCost: 500 }] });
        const j = await r.json();
        expect(j.alcanceAplicado).toBe(false);
    });

    it("con alcance y datos en snapshots, recorta y lo declara", async () => {
        // El filtro deja pasar sólo rg-datos.
        filtroMock.mockResolvedValue((f: any) => String(f?.resourceGroup || "").includes("datos"));
        const r = await pedir({ snapshots: [fila("rg-datos"), fila("rg-redes")], medidores: [] });
        const j = await r.json();
        expect(j.alcanceAplicado).toBe(true);
    });

    it("sin alcance no cambia nada: los medidores siguen siendo la fuente preferida", async () => {
        filtroMock.mockResolvedValue(null);
        await pedir({ snapshots: [fila("rg-datos")], medidores: [{ subscription_id: "sub-1", billedCost: 500 }] });
        expect(queryMock.mock.calls.some(([s]) => /FROM\s+CostMeterSnapshots\b/.test(String(s)))).toBe(true);
    });
});
