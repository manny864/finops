import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, tagRgMock, countsMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    tagRgMock: vi.fn(),
    countsMock: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => {}),
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/cache", () => ({
    // Sin caché: se ejecuta el fetcher real en cada test.
    getWithStaleWhileRevalidate: (_k: string, fn: () => any) => fn(),
    invalidateCache: vi.fn(),
    costGroupsCacheKeys: () => [],
}));
vi.mock("@/lib/azureResourceCounts", () => ({
    fetchResourceCountsByRg: countsMock,
    fetchResourceGroupsByTag: tagRgMock,
}));

import { GET } from "@/app/api/cost-groups/route";
import { NextRequest } from "next/server";

const req = () => new NextRequest("http://localhost/api/cost-groups?tenantId=t1&period=30d");

/** Un grupo custom por ETIQUETA (CostCenter=IT) y una fila de costo en su RG. */
function stubDb({ tagsColumnPopulated }: { tagsColumnPopulated: boolean }) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("GROUP BY name")) {
            // Agrupación por tag CostCenter: en la realidad la columna Tags está
            // en NULL, así que todo cae en 'Untagged'.
            return [[{ name: "Untagged", periodCost: 500, subscriptions: 1, resourceGroups: 1, resources: 0, rgNames: "rg-it", lastUpdated: new Date() }]];
        }
        if (s.includes("FROM Budgets")) return [[]];
        if (s.includes("FROM CostGroups cg")) {
            return [[{ name: "IT", description: null, match_type: "tag", match_tag_key: "CostCenter", match_tag_value: "IT", match_rg_pattern: null, created_by: null, created_at: null, ownerName: null, ownerEmail: null }]];
        }
        // La consulta del grupo custom.
        if (s.includes("FROM CostSnapshots") && s.includes("CostGroupResourceGroups")) {
            const matcheaPorRg = s.includes("LOWER(resource_group) IN");
            const valor = tagsColumnPopulated || matcheaPorRg ? 500 : null;
            return [[{ periodCost: valor, subscriptions: valor ? 1 : 0, resourceGroups: valor ? 1 : 0, resources: 0, rgNames: valor ? "rg-it" : null, lastUpdated: new Date() }]];
        }
        return [[]];
    });
}

beforeEach(() => {
    queryMock.mockReset();
    tagRgMock.mockReset();
    countsMock.mockReset().mockResolvedValue(new Map());
});

describe("GET /api/cost-groups — grupo definido por etiqueta", () => {
    // El bug reportado: por patrón de RG los números salían bien, por etiqueta
    // el grupo caía a 0.00. Causa: CostSnapshots.Tags no lo escribe ningún
    // INSERT, así que el predicado JSON nunca podía coincidir.
    it("resuelve la etiqueta contra Resource Graph y deja de dar 0.00", async () => {
        stubDb({ tagsColumnPopulated: false });
        tagRgMock.mockResolvedValue(["rg-it"]);

        const json = await (await GET(req())).json();
        const grupo = json.groups.find((g: any) => g.name === "IT");

        expect(tagRgMock).toHaveBeenCalledWith("t1", "CostCenter", "IT");
        expect(grupo.periodCost).toBeGreaterThan(0);
    });

    it("marca el resultado como aproximado: el costo está agregado por RG", async () => {
        stubDb({ tagsColumnPopulated: false });
        tagRgMock.mockResolvedValue(["rg-it"]);

        const json = await (await GET(req())).json();
        const grupo = json.groups.find((g: any) => g.name === "IT");

        expect(grupo.tagMatchIsApproximate).toBe(true);
        expect(grupo.tagResolvedResourceGroups).toBe(1);
    });

    it("si Resource Graph no devuelve nada, no inventa costo", async () => {
        stubDb({ tagsColumnPopulated: false });
        tagRgMock.mockResolvedValue([]);

        const json = await (await GET(req())).json();
        const grupo = json.groups.find((g: any) => g.name === "IT");

        expect(grupo.periodCost).toBe(0);
        expect(grupo.tagMatchIsApproximate).toBe(false);
    });

    it("un grupo por patrón de RG no consulta Resource Graph (seguía funcionando)", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            const s = String(sql);
            if (s.includes("GROUP BY name")) return [[]];
            if (s.includes("FROM Budgets")) return [[]];
            if (s.includes("FROM CostGroups cg")) {
                return [[{ name: "Prod", match_type: "name_pattern", match_rg_pattern: "rg-prod-%", match_tag_key: null, match_tag_value: null, description: null, created_by: null, created_at: null, ownerName: null, ownerEmail: null }]];
            }
            if (s.includes("FROM CostSnapshots")) {
                return [[{ periodCost: 120, subscriptions: 1, resourceGroups: 1, resources: 0, rgNames: "rg-prod-1", lastUpdated: new Date() }]];
            }
            return [[]];
        });

        const json = await (await GET(req())).json();

        expect(tagRgMock).not.toHaveBeenCalled();
        expect(json.groups.find((g: any) => g.name === "Prod").periodCost).toBe(120);
    });
});
