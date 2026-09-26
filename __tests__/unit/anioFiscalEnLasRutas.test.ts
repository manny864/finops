// @vitest-environment node
/**
 * MEJ-36 — el año fiscal y el arrastre, llegando a las rutas.
 *
 * El helper tiene sus tests; esto cuida el CABLEADO, que es lo que estaba roto:
 * el año fiscal se calculaba bien en ningún lado y mal en cuatro, y un helper
 * correcto que nadie llama no arregla nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, countsMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    countsMock: vi.fn(async () => new Map<string, number>()),
}));

const IDENT = { email: "u@u", tenantId: "t1", claims: { tid: "t1" }, isCorporateDomain: false };
vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => IDENT),
    requireTenantRole: vi.fn(async () => IDENT),
    requireTenantAccess: vi.fn(async () => IDENT),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/cache", () => ({
    getWithStaleWhileRevalidate: (_k: string, fn: () => any) => fn(),
    invalidateCache: vi.fn(),
    costGroupsCacheKeys: () => [],
}));
vi.mock("@/lib/redis", () => ({ redis: { del: vi.fn(async () => {}) } }));
vi.mock("@/lib/azureResourceCounts", () => ({
    fetchResourceCountsByRg: countsMock,
    fetchResourceGroupsByTag: vi.fn(async () => []),
}));

import { GET as costGroups } from "@/app/api/cost-groups/route";
import { GET as costCenters } from "@/app/api/intelligence/cost-centers/route";

/** Un tenant con el ejercicio arrancando en abril. */
function stub({ mesFiscal = 4, presupuesto = null as null | any, mensual = [] as any[] } = {}) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("fiscal_year_start_month")) return [[{ fiscal_year_start_month: mesFiscal }]];
        if (s.includes("costWithProvenance")) return [[{ costTotal: 100, costWithProvenance: 100 }]];
        if (s.includes("FROM CostCenterBudgets")) return [presupuesto ? [presupuesto] : []];
        if (s.includes("GROUP BY name, mes")) return [mensual];
        if (s.includes("FROM Budgets")) return [[]];
        if (s.includes("FROM CostGroups cg")) return [[]];
        if (s.includes("GROUP BY name")) return [[{ name: "IT", currentMonthCost: 100, previousMonthCost: 0, rgNames: "" }]];
        return [[]];
    });
}

beforeEach(() => {
    queryMock.mockReset();
    countsMock.mockReset().mockResolvedValue(new Map());
    vi.useRealTimers();
});

describe("el período «Año Fiscal» de Cost Groups", () => {
    it("arranca en el mes del tenant, no en enero", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
        stub({ mesFiscal: 4 });

        await costGroups(new NextRequest("http://localhost/api/cost-groups?tenantId=t1&period=fy"));

        // La consulta principal lleva el rango como parámetros.
        const principal = queryMock.mock.calls.find(([s]) => String(s).includes("GROUP BY name"));
        expect(principal?.[1]).toContain("2026-04-01");
        expect(principal?.[1]).not.toContain("2026-01-01");
    });

    it("con enero, el rango es exactamente el de siempre", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
        stub({ mesFiscal: 1 });

        await costGroups(new NextRequest("http://localhost/api/cost-groups?tenantId=t1&period=fy"));
        const principal = queryMock.mock.calls.find(([s]) => String(s).includes("GROUP BY name"));
        expect(principal?.[1]).toContain("2026-01-01");
    });
});

describe("el arrastre en el tablero de Centros de Costo", () => {
    const pedir = () => costCenters(new NextRequest("http://localhost/api/intelligence/cost-centers?tenantId=t1"));

    it("apagado, el presupuesto es el de siempre y no se consulta el histórico", async () => {
        stub({ presupuesto: { cost_center_name: "IT", monthly_budget_usd: 1000, rollover_enabled: 0, rollover_cap_usd: null } });
        const j = await (await pedir()).json();

        const it = j.costCenters.find((c: any) => c.name === "IT");
        expect(it.budget).toBe(1000);
        expect(it.budgetRollover).toBe(0);
        // Con todos apagados el tablero cuesta lo mismo que antes.
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("GROUP BY name, mes"))).toBe(false);
    });

    it("encendido, el presupuesto del mes suma lo no ejecutado y lo dice por separado", async () => {
        stub({
            presupuesto: { cost_center_name: "IT", monthly_budget_usd: 1000, rollover_enabled: 1, rollover_cap_usd: null },
            // Dos meses previos gastando 600 de 1000: arrastra 800.
            mensual: [{ name: "IT", mes: "2026-04", total: 600 }, { name: "IT", mes: "2026-05", total: 600 }],
        });
        const j = await (await pedir()).json();

        const it = j.costCenters.find((c: any) => c.name === "IT");
        expect(it.budgetBase).toBe(1000);
        expect(it.budgetRollover).toBe(800);
        // `budget` es el EFECTIVO, que es contra lo que el mes se mide.
        expect(it.budget).toBe(1800);
        expect(it.pctUsed).toBe(5.6);
    });

    it("el tope corta el arrastre", async () => {
        stub({
            presupuesto: { cost_center_name: "IT", monthly_budget_usd: 1000, rollover_enabled: 1, rollover_cap_usd: 500 },
            mensual: [{ name: "IT", mes: "2026-04", total: 0 }, { name: "IT", mes: "2026-05", total: 0 }],
        });
        const j = await (await pedir()).json();
        expect(j.costCenters.find((c: any) => c.name === "IT").budgetRollover).toBe(500);
    });
});
