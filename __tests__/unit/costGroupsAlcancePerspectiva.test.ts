// @vitest-environment node
/**
 * MEJ-34 — el tablero de Cost Groups honrando el alcance transversal.
 *
 * Lo que estos tests cuidan no es que filtre, sino que SIGA CUADRANDO al
 * filtrar. Cost Groups agrega en SQL con `COUNT(DISTINCT ...)`, y el predicado
 * de una Perspective se evalúa por fila: con un alcance activo la agregación
 * pasa a TypeScript, y si ese plegado no reprodujera exactamente lo que hacía
 * el `GROUP BY` —los descartes de NULL, el placeholder de suscripción— el
 * tablero mostraría un costo acotado al lado de conteos que no lo están.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, tagRgMock, countsMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    tagRgMock: vi.fn(async () => [] as string[]),
    countsMock: vi.fn(async () => new Map<string, number>()),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => ({ email: "u@u", tenantId: "t1", claims: { tid: "t1" }, isCorporateDomain: false })),
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

const req = (qs = "") =>
    new NextRequest(`http://localhost/api/cost-groups?tenantId=t1&period=30d${qs}`);

/**
 * Cuatro filas de detalle. La de `mg-aggregated` y la de `ResourceId` nulo
 * están a propósito: son los dos descartes que el `COUNT(DISTINCT ...)` hacía
 * en SQL y que el plegado tiene que seguir haciendo.
 */
const DETALLE = [
    { ccName: "IT", subscription_id: "s1", resource_group: "rg-prod-a", service_name: "VM", ResourceId: "/r/1", Tags: { CostCenter: "IT", Environment: "prod" }, periodCost: 100, lastUpdated: "2026-09-20" },
    { ccName: "Ops", subscription_id: "mg-aggregated", resource_group: "rg-prod-b", service_name: "SQL", ResourceId: null, Tags: { CostCenter: "Ops", Environment: "prod" }, periodCost: 50, lastUpdated: "2026-09-22" },
    { ccName: "IT", subscription_id: "s2", resource_group: "rg-dev-1", service_name: "VM", ResourceId: "/r/3", Tags: { CostCenter: "IT", Environment: "dev" }, periodCost: 30, lastUpdated: "2026-09-21" },
    { ccName: "Untagged", subscription_id: "s2", resource_group: "rg-qa", service_name: "VM", ResourceId: "/r/4", Tags: { Environment: "qa" }, periodCost: 20, lastUpdated: "2026-09-19" },
];

/** Lo mismo pero ya agregado por SQL, que es lo que devuelve el camino sin alcance. */
const AGREGADO = [
    { name: "IT", periodCost: 130, subscriptions: 2, resourceGroups: 2, resources: 2, rgNames: "rg-prod-a,rg-dev-1", lastUpdated: "2026-09-21" },
    { name: "Ops", periodCost: 50, subscriptions: 0, resourceGroups: 1, resources: 0, rgNames: "rg-prod-b", lastUpdated: "2026-09-22" },
    { name: "Untagged", periodCost: 20, subscriptions: 1, resourceGroups: 1, resources: 1, rgNames: "rg-qa", lastUpdated: "2026-09-19" },
];

function stubDb({ exacto }: { exacto: boolean }) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("costWithProvenance")) {
            return [[{ costTotal: 200, costWithProvenance: exacto ? 200 : 0 }]];
        }
        if (s.includes("FROM Perspectives")) return [[{ id: 7, name: "Entorno", description: null }]];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        if (s.includes("GROUP BY ccName")) return [DETALLE];
        if (s.includes("GROUP BY name")) return [AGREGADO];
        if (s.includes("FROM Budgets")) return [[]];
        if (s.includes("FROM CostGroups cg")) return [[]];
        return [[]];
    });
}

async function pedir(qs = "") {
    const res = await GET(req(qs));
    return res.json();
}

beforeEach(() => {
    queryMock.mockReset();
    tagRgMock.mockReset().mockResolvedValue([]);
    // Un conteo de Resource Graph que, si se aplicara bajo alcance, inflaría
    // 'resources' con recursos que el alcance dejó afuera.
    countsMock.mockReset().mockResolvedValue(new Map([["rg-prod-a", 99], ["rg-prod-b", 99]]));
});

describe("GET /api/cost-groups con alcance de Perspective", () => {
    it("acota el gasto al grupo y los totales siguen cuadrando", async () => {
        stubDb({ exacto: true });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");

        expect(j.summary.scopeApplied).toBe(true);
        // Sólo las dos filas con Environment=prod.
        expect(j.summary.totalCostUsd).toBe(150);
        const porNombre = Object.fromEntries(j.groups.map((g: any) => [g.name, g.periodCost]));
        expect(porNombre).toEqual({ IT: 100, Ops: 50 });

        // El criterio 4: la suma de los grupos ES el total, y asignado +
        // sin asignar también. Sin esto el tablero no es auditable.
        const suma = j.groups.reduce((a: number, g: any) => a + g.periodCost, 0);
        expect(suma).toBe(j.summary.totalCostUsd);
        expect(j.summary.allocatedCostUsd + j.summary.unallocatedCostUsd).toBe(j.summary.totalCostUsd);
    });

    it("el plegado hace los mismos descartes que el COUNT(DISTINCT) de SQL", async () => {
        stubDb({ exacto: true });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");
        const ops = j.groups.find((g: any) => g.name === "Ops");

        // 'mg-aggregated' no es una suscripción real y no se cuenta...
        expect(ops.subscriptions).toBe(0);
        // ...y un ResourceId nulo tampoco es un recurso.
        expect(ops.resources).toBe(0);
        expect(ops.resourceGroups).toBe(1);
    });

    it("no enriquece el conteo con Resource Graph, que contaría fuera del alcance", async () => {
        stubDb({ exacto: true });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");

        expect(countsMock).not.toHaveBeenCalled();
        expect(j.groups.find((g: any) => g.name === "IT").resources).toBe(1);
    });

    it("sin grupo deja todo lo asignado, que no es lo mismo que no acotar", async () => {
        stubDb({ exacto: true });
        const j = await pedir("&perspective=7");
        // 'rg-qa' no cae en ninguna regla, así que queda afuera.
        expect(j.summary.totalCostUsd).toBe(150);
    });

    it("si el costo del período llega sin procedencia, NO acota y lo dice", async () => {
        // El reparto se resuelve aproximando por Resource Group y esa
        // aproximación no se puede recortar fila por fila: devolver un tablero
        // que suma menos que la factura sin decir por qué sería peor.
        stubDb({ exacto: false });
        const j = await pedir("&perspective=7&pgroup=Producci%C3%B3n");

        expect(j.summary.scopeApplied).toBe(false);
        expect(j.summary.totalCostUsd).toBe(200);
    });

    it("sin alcance el tablero no cambia: sigue agregando en SQL", async () => {
        stubDb({ exacto: true });
        const j = await pedir();

        expect(j.summary.scopeApplied).toBe(false);
        expect(j.summary.totalCostUsd).toBe(200);
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("GROUP BY ccName"))).toBe(false);
    });
});
