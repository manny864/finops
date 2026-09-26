// @vitest-environment node
/**
 * MEJ-34 — los recursos de un Centro de Costo, acotados.
 *
 * ACÁ EL RECORTE NO ES COSMÉTICO: esta lista alimenta `BulkTagModal`. Con el
 * tablero acotado a un grupo, devolver los recursos del centro entero deja al
 * usuario etiquetando en masa recursos de FUERA de su alcance. No es mostrar de
 * más, es actuar de más — y por eso la intersección va por identificador de
 * recurso y no por grupo de recursos: un grupo puede tener recursos de los dos
 * lados a la vez.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, recursosMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    recursosMock: vi.fn(async () => [] as Array<{ id: string; name: string; type: string; resourceGroup: string }>),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => {}),
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockCostCenterResources: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/azureResourceCounts", () => ({ fetchResourcesInResourceGroups: recursosMock }));

import { GET } from "@/app/api/intelligence/cost-centers/resources/route";

const req = (qs = "") => new NextRequest(
    `http://localhost/api/intelligence/cost-centers/resources?tenantId=t1&costCenterName=IT${qs}`,
);

/** UN grupo de recursos con un recurso de producción y otro de desarrollo. */
const DETALLE = [
    { subscription_id: "s1", resource_group: "rg-mixto", service_name: "VM", ResourceId: "/subs/s1/rg-mixto/vm-prod", Tags: { CostCenter: "IT", Environment: "prod" }, costo: 100 },
    { subscription_id: "s1", resource_group: "rg-mixto", service_name: "VM", ResourceId: "/subs/s1/rg-mixto/vm-dev", Tags: { CostCenter: "IT", Environment: "dev" }, costo: 40 },
];

/** Resource Graph devuelve TODO lo que vive en el grupo, incluido lo que no gasta. */
const EN_AZURE = [
    { id: "/SUBS/S1/RG-MIXTO/VM-PROD", name: "vm-prod", type: "vm", resourceGroup: "rg-mixto" },
    { id: "/subs/s1/rg-mixto/vm-dev", name: "vm-dev", type: "vm", resourceGroup: "rg-mixto" },
    { id: "/subs/s1/rg-mixto/vm-sin-costo", name: "vm-sin-costo", type: "vm", resourceGroup: "rg-mixto" },
];

function stubDb({ conIds = true }: { conIds?: boolean } = {}) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("FROM Perspectives")) return [[{ id: 7, name: "Entorno", description: null }]];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        if (s.includes("GROUP BY subscription_id")) {
            return [conIds ? DETALLE : DETALLE.map((f) => ({ ...f, ResourceId: null }))];
        }
        if (s.includes("SELECT DISTINCT resource_group")) return [[{ rg: "rg-mixto" }]];
        return [[]];
    });
}

beforeEach(() => {
    queryMock.mockReset();
    recursosMock.mockReset().mockResolvedValue(EN_AZURE);
});

describe("GET /api/intelligence/cost-centers/resources con alcance", () => {
    it("devuelve sólo los recursos en alcance, aunque compartan grupo de recursos", async () => {
        stubDb();
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"))).json();

        expect(j.scopeApplied).toBe(true);
        // El de desarrollo vive en el MISMO grupo y queda afuera igual: si el
        // recorte fuera por grupo de recursos, los tres se irían a etiquetar.
        expect(j.resources.map((r: any) => r.name)).toEqual(["vm-prod"]);
    });

    it("la intersección no distingue mayúsculas, que es como Azure devuelve los ids", async () => {
        stubDb();
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"))).json();
        // El id en Resource Graph viene en mayúsculas y en CostSnapshots no.
        expect(j.resources[0].id).toBe("/SUBS/S1/RG-MIXTO/VM-PROD");
    });

    it("un recurso sin fila de costo queda afuera: no hay con qué probar que está en el grupo", async () => {
        stubDb();
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"))).json();
        expect(j.resources.some((r: any) => r.name === "vm-sin-costo")).toBe(false);
    });

    it("sin ResourceId no hay con qué intersectar: no recorta y lo dice", async () => {
        // Devolver la lista vacía se leería como "este grupo no tiene recursos".
        stubDb({ conIds: false });
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"))).json();

        expect(j.scopeApplied).toBe(false);
        expect(j.resources).toHaveLength(3);
    });

    it("sin alcance la lista es la de siempre", async () => {
        stubDb();
        const j = await (await GET(req())).json();

        expect(j.scopeApplied).toBe(false);
        expect(j.resources).toHaveLength(3);
    });
});
