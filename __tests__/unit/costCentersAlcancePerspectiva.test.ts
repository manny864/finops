// @vitest-environment node
/**
 * MEJ-34 — el tablero de Centros de Costo honrando el alcance transversal.
 *
 * Segundo tablero que agrega en SQL, y el que hizo aparecer una decisión que
 * `cost-groups` no tenía: EL PRESUPUESTO NO SE ACOTA. Está definido para el
 * centro de costo entero, así que compararlo contra una porción diría "gastaste
 * 150 de 10.000" cuando los 10.000 cubren todo el centro — un margen que no
 * existe. Bajo alcance se omite, y la pantalla dice por qué.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, countsMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    countsMock: vi.fn(async () => new Map<string, number>()),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => {}),
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/cache", () => ({ getWithStaleWhileRevalidate: (_k: string, fn: () => any) => fn() }));
vi.mock("@/lib/redis", () => ({ redis: { del: vi.fn(async () => {}) } }));
vi.mock("@/lib/azureResourceCounts", () => ({ fetchResourceCountsByRg: countsMock }));

import { GET } from "@/app/api/intelligence/cost-centers/route";

const req = (qs = "") =>
    new NextRequest(`http://localhost/api/intelligence/cost-centers?tenantId=t1${qs}`);

/** Dos centros de costo repartidos entre dos entornos. */
const DETALLE = [
    { name: "IT", subscription_id: "s1", resource_group: "rg-prod-a", service_name: "VM", ResourceId: "/r/1", Tags: { CostCenter: "IT", Environment: "prod" }, currentMonthCost: 100, previousMonthCost: 80 },
    { name: "IT", subscription_id: "s1", resource_group: "rg-dev-1", service_name: "VM", ResourceId: "/r/2", Tags: { CostCenter: "IT", Environment: "dev" }, currentMonthCost: 40, previousMonthCost: 40 },
    { name: "Ops", subscription_id: "s2", resource_group: "rg-prod-b", service_name: "SQL", ResourceId: "/r/3", Tags: { CostCenter: "Ops", Environment: "prod" }, currentMonthCost: 50, previousMonthCost: 20 },
];

const AGREGADO = [
    { name: "IT", currentMonthCost: 140, previousMonthCost: 120, rgNames: "rg-prod-a,rg-dev-1" },
    { name: "Ops", currentMonthCost: 50, previousMonthCost: 20, rgNames: "rg-prod-b" },
];

function stubDb({ exacto }: { exacto: boolean }) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("costWithProvenance")) {
            return [[{ costTotal: 190, costWithProvenance: exacto ? 190 : 0 }]];
        }
        if (s.includes("FROM Perspectives")) return [[{ id: 7, name: "Entorno", description: null }]];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        if (s.includes("GROUP BY name,")) return [DETALLE];
        if (s.includes("GROUP BY name")) return [AGREGADO];
        if (s.includes("FROM CostCenterBudgets")) {
            return [[{ cost_center_name: "IT", monthly_budget_usd: 10000 }]];
        }
        return [[]];
    });
}

async function pedir(qs = "") {
    return (await GET(req(qs))).json();
}

beforeEach(() => {
    queryMock.mockReset();
    countsMock.mockReset().mockResolvedValue(new Map([["rg-prod-a", 99], ["rg-dev-1", 99], ["rg-prod-b", 99]]));
});

describe("GET /api/intelligence/cost-centers con alcance de Perspective", () => {
    it("acota el gasto y el total sigue siendo la suma de lo que muestra", async () => {
        stubDb({ exacto: true });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");

        expect(j.scopeApplied).toBe(true);
        const porNombre = Object.fromEntries(j.costCenters.map((c: any) => [c.name, c.currentMonthCost]));
        expect(porNombre).toEqual({ IT: 100, Ops: 50 });
        expect(j.totalSpend).toBe(150);
        expect(j.costCenters.reduce((a: number, c: any) => a + c.currentMonthCost, 0)).toBe(j.totalSpend);
        // La variación se calcula sobre el mes anterior YA ACOTADO (80, no 120).
        expect(j.costCenters.find((c: any) => c.name === "IT").previousMonthCost).toBe(80);
    });

    it("el presupuesto no se acota, así que no se muestra", async () => {
        stubDb({ exacto: true });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");

        // IT tiene 10.000 de presupuesto para el centro ENTERO. Mostrarlo contra
        // los 100 en alcance diría que hay margen donde no lo hay.
        expect(j.costCenters.find((c: any) => c.name === "IT").budget).toBeNull();
        expect(j.totalBudget).toBe(0);
        expect(j.overBudgetCount).toBe(0);
    });

    it("el conteo de recursos sale del detalle, no de Resource Graph", async () => {
        stubDb({ exacto: true });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");

        expect(countsMock).not.toHaveBeenCalled();
        // Un solo recurso de IT cae en Producción, no los 99 que tiene el RG.
        expect(j.costCenters.find((c: any) => c.name === "IT").resourceCount).toBe(1);
    });

    it("si el costo del período llega sin procedencia, NO acota y lo dice", async () => {
        stubDb({ exacto: false });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");

        expect(j.scopeApplied).toBe(false);
        expect(j.totalSpend).toBe(190);
        // Y el presupuesto vuelve, porque el tablero es el completo.
        expect(j.costCenters.find((c: any) => c.name === "IT").budget).toBe(10000);
    });

    it("sin alcance el tablero no cambia: sigue agregando en SQL", async () => {
        stubDb({ exacto: true });
        const j = await pedir();

        expect(j.scopeApplied).toBe(false);
        expect(j.totalSpend).toBe(190);
        expect(j.totalBudget).toBe(10000);
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("GROUP BY name,"))).toBe(false);
    });
});
