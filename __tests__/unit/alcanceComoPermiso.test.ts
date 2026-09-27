// @vitest-environment node
/**
 * MEJ-38 — el alcance como PERMISO.
 *
 * Lo que se cuida acá no es que recorte —eso es MEJ-34 y tiene sus tests— sino
 * que NO SE PUEDA NO RECORTAR. Un alcance que se puede esquivar cambiando un
 * parámetro, o que degrada a "te muestro todo y te aviso", no es un permiso: es
 * una preferencia con nombre de permiso, que es peor que no tenerla porque la
 * plataforma se vende por gobernanza.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, alcanceMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    alcanceMock: vi.fn(async () => null as null | { perspectiveId: number; grupo: string | null }),
}));

vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/services/userScope.service", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    alcanceDelUsuario: alcanceMock,
}));
vi.mock("@/lib/cache", () => ({
    getWithStaleWhileRevalidate: (_k: string, fn: () => any) => fn(),
    invalidateCache: vi.fn(),
    costGroupsCacheKeys: () => [],
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/lib/azureResourceCounts", () => ({
    fetchResourceCountsByRg: vi.fn(async () => new Map()),
    fetchResourceGroupsByTag: vi.fn(async () => []),
}));

import { rutaAdmiteAlcance, RUTAS_CON_ALCANCE, PAGINAS_CON_ALCANCE_Y_SUS_RUTAS, paginaAdmiteAlcance } from "@/lib/scopeAwareRoutes";
import { exigirRecorte, filtroDeLaRequest } from "@/services/perspectivesData.service";
import { ROLES_SIN_ALCANCE } from "@/services/userScope.service";
import { aplicarAlcance, type RequestIdentity } from "@/lib/requestAuth";

const PERMISO = { perspectiveId: 7, grupo: "Producción" };

function stubPerspectiva(existe = true) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("FROM Perspectives")) return [existe ? [{ id: 7, name: "Entorno", description: null }] : []];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        return [[]];
    });
}

beforeEach(() => {
    queryMock.mockReset();
    alcanceMock.mockReset().mockResolvedValue(null);
});

describe("el mapa de rutas: el default es negar", () => {
    it("una ruta que nadie declaró no le responde a un usuario acotado", async () => {
        // Es el punto entero del diseño: hay 304 rutas con auth de tenant y la
        // que se olvide tiene que fallar cerrada.
        expect(rutaAdmiteAlcance("/api/intelligence/anomalies", "GET")).toBe(false);
        expect(rutaAdmiteAlcance("/api/cleanup/zombies", "GET")).toBe(false);
        expect(rutaAdmiteAlcance("/api/admin/config/users", "GET")).toBe(false);
    });

    it("las que saben acotar, sí", async () => {
        expect(rutaAdmiteAlcance("/api/cost-groups", "GET")).toBe(true);
        expect(rutaAdmiteAlcance("/api/intelligence/cost-centers", "GET")).toBe(true);
    });

    it("es por MÉTODO: un GET que sabe acotar no habilita su POST", async () => {
        // 136 de las 304 escriben. Una escritura que no valida identificadores
        // contra el alcance es peor que una lectura que muestra de más.
        expect(rutaAdmiteAlcance("/api/cost-groups", "GET")).toBe(true);
        expect(rutaAdmiteAlcance("/api/cost-groups", "POST")).toBe(false);
        expect(rutaAdmiteAlcance("/api/intelligence/cost-centers", "PUT")).toBe(false);
        expect(rutaAdmiteAlcance("/api/intelligence/cost-centers", "DELETE")).toBe(false);
    });

    it("el prefijo más largo gana, como en ROUTE_TIERS", () => {
        // `/api/cost-groups/IT` es el detalle y hereda de `/api/cost-groups`;
        // `/api/intelligence/cost-centers/resources` tiene entrada propia.
        expect(rutaAdmiteAlcance("/api/cost-groups/IT", "GET")).toBe(true);
        expect(rutaAdmiteAlcance("/api/intelligence/cost-centers/resources", "GET")).toBe(true);
    });

    it("el shell sigue respondiendo, o la aplicación no carga", () => {
        for (const r of ["/api/tenants", "/api/subscriptions", "/api/me/scope", "/api/intelligence/perspectives"]) {
            expect(rutaAdmiteAlcance(r, "GET"), r).toBe(true);
        }
    });

    it("cada página ofrecida tiene su API declarada", () => {
        // Si el menú ofrece una pantalla cuya API niega, el usuario encuentra un
        // 403 en vez de no encontrar la entrada.
        //
        // Antes esto comparaba el ÚLTIMO SEGMENTO de la URL contra el nombre de
        // la ruta. Pasaba de casualidad: las cinco primeras pantallas se
        // llamaban igual de los dos lados. La primera cuyo nombre no coincidía
        // con el de su API lo rompió sin que hubiera nada mal. Ahora cada
        // página declara las rutas que necesita y se comprueba el invariante de
        // verdad: que TODAS respondan y sepan recortar.
        for (const [pagina, rutas] of Object.entries(PAGINAS_CON_ALCANCE_Y_SUS_RUTAS)) {
            expect(rutas.length, `${pagina} no declara ninguna ruta`).toBeGreaterThan(0);
            for (const ruta of rutas) {
                expect(RUTAS_CON_ALCANCE[ruta], `${pagina} necesita ${ruta}, que no está declarada`).toBeDefined();
                expect(rutaAdmiteAlcance(ruta, "GET"), `${ruta} no le responde a un acotado`).toBe(true);
            }
        }
    });

    it("el menú sólo ofrece lo que está declarado", () => {
        expect(paginaAdmiteAlcance("/intelligence/cost-groups")).toBe(true);
        expect(paginaAdmiteAlcance("/cleanup/zombies")).toBe(false);
    });
});

describe("el corte: una ruta que no sabe acotar no le responde", () => {
    const identidad = (extra?: Partial<RequestIdentity>): RequestIdentity => ({
        claims: { tid: "t1" }, tenantId: "t1", email: "reader@acme.com", isCorporateDomain: false, ...extra,
    });

    it("sin alcance asignado, nada cambia — que es lo que hace seguro desplegarlo", async () => {
        alcanceMock.mockResolvedValue(null);
        const r = await aplicarAlcance(identidad(), "t1", "/api/cleanup/zombies", "GET");
        expect(r.alcance).toBeUndefined();
    });

    it("con alcance y una ruta que no sabe acotar, 403", async () => {
        alcanceMock.mockResolvedValue(PERMISO);
        await expect(aplicarAlcance(identidad(), "t1", "/api/cleanup/zombies", "GET")).rejects.toMatchObject({ status: 403 });
    });

    it("con alcance y una ruta que sí sabe, la identidad lo lleva colgado", async () => {
        alcanceMock.mockResolvedValue(PERMISO);
        const r = await aplicarAlcance(identidad(), "t1", "/api/cost-groups", "GET");
        expect(r.alcance).toEqual(PERMISO);
    });

    it("el POST de esa misma ruta sigue negado", async () => {
        alcanceMock.mockResolvedValue(PERMISO);
        await expect(aplicarAlcance(identidad(), "t1", "/api/cost-groups", "POST")).rejects.toMatchObject({ status: 403 });
    });

    it("el cron no es una persona y pasa sin alcance", async () => {
        alcanceMock.mockResolvedValue(PERMISO);
        const r = await aplicarAlcance(identidad({ esCron: true }), "t1", "/api/cron/sync", "POST");
        expect(r.alcance).toBeUndefined();
        expect(alcanceMock).not.toHaveBeenCalled();
    });
});

describe("el permiso gana sobre la URL", () => {
    it("con permiso, el ?perspective= de la barra de direcciones se ignora", async () => {
        stubPerspectiva();
        // El usuario pide la Perspective 99; le corresponde la 7.
        const f = await filtroDeLaRequest("t1", new URLSearchParams({ perspective: "99", pgroup: "Otro" }), PERMISO);
        expect(f).not.toBeNull();
        // Sólo lo que la regla de la 7 asigna a Producción pasa.
        expect(f!({ tags: { Environment: "prod" }, costo: 1 })).toBe(true);
        expect(f!({ tags: { Environment: "dev" }, costo: 1 })).toBe(false);
    });

    it("sin permiso, la URL manda como siempre", async () => {
        stubPerspectiva();
        const f = await filtroDeLaRequest("t1", new URLSearchParams({ perspective: "7", pgroup: "Producción" }), null);
        expect(f!({ tags: { Environment: "prod" }, costo: 1 })).toBe(true);
    });

    it("un permiso cuya Perspective no resuelve NIEGA, no degrada", async () => {
        // Degradar a "sin recorte" acá le serviría el tenant entero a alguien que
        // tiene el acceso acotado. Es la falla que convierte el permiso en nada.
        stubPerspectiva(false);
        await expect(filtroDeLaRequest("t1", new URLSearchParams(), PERMISO)).rejects.toThrow();
    });
});

describe("exigirRecorte", () => {
    it("con permiso y sin poder acotar, corta", () => {
        expect(() => exigirRecorte(PERMISO, false)).toThrow();
    });

    it("con permiso y acotando, sigue", () => {
        expect(() => exigirRecorte(PERMISO, true)).not.toThrow();
    });

    it("sin permiso no hace nada: ahí el aviso de MEJ-34 es la respuesta correcta", () => {
        expect(() => exigirRecorte(null, false)).not.toThrow();
    });
});

describe("la puerta lateral de las claves de API", () => {
    it("Admin y Owner no pueden tener alcance", () => {
        // Emitir una clave MCP o pública exige uno de esos dos roles, y la clave
        // es por TENANT: un Admin acotado se saltearía su propio recorte.
        // Verificado en admin/mcp-keys y admin/public-api-keys.
        expect(ROLES_SIN_ALCANCE).toContain("admin");
        expect(ROLES_SIN_ALCANCE).toContain("owner");
    });

    it("los otros dos roles que existen de verdad sí pueden", () => {
        // En la base sólo hay cuatro: Admin, Owner, Reader y Colaborador. Los
        // otros cuatro que aparecen en las guardas nunca se asignaron.
        expect(ROLES_SIN_ALCANCE).not.toContain("reader");
        expect(ROLES_SIN_ALCANCE).not.toContain("colaborador");
    });
});
