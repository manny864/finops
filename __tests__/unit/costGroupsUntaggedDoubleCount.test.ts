import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, tagRgMock, countsMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    tagRgMock: vi.fn(async () => []),
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
    getWithStaleWhileRevalidate: (_k: string, fn: () => any) => fn(),
    invalidateCache: vi.fn(),
    costGroupsCacheKeys: () => [],
}));
vi.mock("@/lib/azureResourceCounts", () => ({
    fetchResourceCountsByRg: countsMock,
    fetchResourceGroupsByTag: tagRgMock,
}));

import { GET } from "@/app/api/cost-groups/route";

const req = () => new NextRequest("http://localhost/api/cost-groups?tenantId=t1&period=30d");

beforeEach(() => {
    queryMock.mockReset();
    tagRgMock.mockReset().mockResolvedValue([]);
    countsMock.mockReset().mockResolvedValue(new Map());
});

// Números reales del reporte: el gasto del período era 861.31 y la pantalla
// mostraba 1585.31 porque cada Cost Group nuevo se sumaba al Untagged completo.
describe("GET /api/cost-groups — Untagged no debe contar dos veces el gasto", () => {
    function stubConGruposCustom() {
        const customs = [
            { name: "FinOps", cost: 552.31 },
            { name: "FINOPS_STAGING", cost: 168.01 },
            { name: "Web Page", cost: 3.68 },
        ];
        let i = 0;
        queryMock.mockImplementation(async (sql: string) => {
            const s = String(sql);
            if (s.includes("GROUP BY name")) {
                // Con Tags sin poblar, TODO el gasto cae en Untagged.
                return [[{ name: "Untagged", periodCost: 861.31, subscriptions: 1, resourceGroups: 17, resources: 0, rgNames: "rg-a,rg-b", lastUpdated: new Date() }]];
            }
            if (s.includes("FROM Budgets")) return [[]];
            if (s.includes("FROM CostGroups cg")) {
                return [[...customs.map(c => ({
                    name: c.name, description: null, match_type: "name_pattern",
                    match_rg_pattern: "rg-%", match_tag_key: null, match_tag_value: null,
                    created_by: null, created_at: null, ownerName: null, ownerEmail: null,
                }))]];
            }
            if (s.includes("FROM CostSnapshots") && s.includes("CostGroupResourceGroups")) {
                const c = customs[i++ % customs.length];
                // Todo su costo proviene de filas sin tag: está dentro de Untagged.
                return [[{ periodCost: c.cost, untaggedPortion: c.cost, subscriptions: 1, resourceGroups: 1, resources: 0, rgNames: "rg-a", lastUpdated: new Date() }]];
            }
            return [[]];
        });
    }

    it("descuenta de Untagged lo que reclaman los grupos custom", async () => {
        stubConGruposCustom();
        const json = await (await GET(req())).json();
        const untagged = json.groups.find((g: any) => g.name === "Untagged");

        // 861.31 - (552.31 + 168.01 + 3.68) = 137.31
        expect(untagged.periodCost).toBeCloseTo(137.31, 2);
    });

    it("el total del período deja de estar inflado", async () => {
        stubConGruposCustom();
        const json = await (await GET(req())).json();

        // Antes daba 1585.31 (861.31 contado dos veces en parte).
        expect(json.summary.totalCostUsd).toBeCloseTo(861.31, 2);
    });

    it("sin grupos custom, Untagged conserva su costo entero", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            const s = String(sql);
            if (s.includes("GROUP BY name")) {
                return [[{ name: "Untagged", periodCost: 861.31, subscriptions: 1, resourceGroups: 17, resources: 0, rgNames: "rg-a", lastUpdated: new Date() }]];
            }
            return [[]];
        });

        const json = await (await GET(req())).json();
        expect(json.groups.find((g: any) => g.name === "Untagged").periodCost).toBeCloseTo(861.31, 2);
        expect(json.summary.totalCostUsd).toBeCloseTo(861.31, 2);
    });

    it("un grupo que matchea filas YA etiquetadas no le resta a Untagged", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            const s = String(sql);
            if (s.includes("GROUP BY name")) {
                return [[
                    { name: "Untagged", periodCost: 100, subscriptions: 1, resourceGroups: 1, resources: 0, rgNames: "rg-a", lastUpdated: new Date() },
                    { name: "Marketing", periodCost: 50, subscriptions: 1, resourceGroups: 1, resources: 0, rgNames: "rg-mkt", lastUpdated: new Date() },
                ]];
            }
            if (s.includes("FROM Budgets")) return [[]];
            if (s.includes("FROM CostGroups cg")) {
                return [[{ name: "Ventas", match_type: "name_pattern", match_rg_pattern: "rg-mkt", match_tag_key: null, match_tag_value: null, description: null, created_by: null, created_at: null, ownerName: null, ownerEmail: null }]];
            }
            if (s.includes("FROM CostSnapshots") && s.includes("CostGroupResourceGroups")) {
                // Su costo viene de filas etiquetadas: untaggedPortion en 0.
                return [[{ periodCost: 50, untaggedPortion: 0, subscriptions: 1, resourceGroups: 1, resources: 0, rgNames: "rg-mkt", lastUpdated: new Date() }]];
            }
            return [[]];
        });

        const json = await (await GET(req())).json();
        expect(json.groups.find((g: any) => g.name === "Untagged").periodCost).toBeCloseTo(100, 2);
    });
});
