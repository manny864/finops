// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import Decimal from "decimal.js";

// El módulo arrastra el SDK de Azure y redis; para probar la aritmética pura
// del reparto alcanza con neutralizarlos.
vi.mock("@azure/arm-costmanagement", () => ({ CostManagementClient: class {} }));
vi.mock("@/lib/azure", () => ({ getResourceGraphClient: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/lib/azureCostColumn", () => ({
    findCostColumnIndex: vi.fn(() => 0),
    withCostColumn: vi.fn(),
}));

import { distributeCostPerResource } from "@/app/api/intelligence/databases/diagnosticsShared";

const plan = (n: number) => ({
    id: `/subscriptions/s1/resourceGroups/rg/providers/Microsoft.Web/serverfarms/plan${n}`,
    type: "microsoft.web/serverfarms",
});

describe("distributeCostPerResource", () => {
    it("sin datos exactos reparte el total del tipo en partes iguales", () => {
        const out = distributeCostPerResource(
            [plan(1), plan(2), plan(3)],
            new Map([["microsoft.web/serverfarms", new Decimal(90)]]),
        );
        expect(out.get(plan(1).id)).toBe(30);
        expect(out.get(plan(2).id)).toBe(30);
        expect(out.get(plan(3).id)).toBe(30);
    });

    // El bug: con tres planes de costos muy distintos, los tres mostraban $30.
    it("usa el costo exacto de cada recurso cuando está disponible", () => {
        const exact = new Map([
            [plan(1).id.toLowerCase(), 70],
            [plan(2).id.toLowerCase(), 15],
            [plan(3).id.toLowerCase(), 5],
        ]);
        const out = distributeCostPerResource(
            [plan(1), plan(2), plan(3)],
            new Map([["microsoft.web/serverfarms", new Decimal(90)]]),
            exact,
        );
        expect(out.get(plan(1).id)).toBe(70);
        expect(out.get(plan(2).id)).toBe(15);
        expect(out.get(plan(3).id)).toBe(5);
    });

    it("matchea el ResourceId sin importar mayúsculas", () => {
        // Cost Management devuelve los ids en minúscula; Resource Graph no.
        const exact = new Map([[plan(1).id.toLowerCase(), 42]]);
        const out = distributeCostPerResource(
            [plan(1)],
            new Map([["microsoft.web/serverfarms", new Decimal(90)]]),
            exact,
        );
        expect(out.get(plan(1).id)).toBe(42);
    });

    // La parte que importa: sin restar lo ya imputado, el total se infla.
    it("reparte sólo el remanente entre los recursos sin dato propio", () => {
        const exact = new Map([[plan(1).id.toLowerCase(), 60]]);
        const out = distributeCostPerResource(
            [plan(1), plan(2), plan(3)],
            new Map([["microsoft.web/serverfarms", new Decimal(90)]]),
            exact,
        );
        expect(out.get(plan(1).id)).toBe(60);
        // Quedan $30 para repartir entre 2, no $90/3 ni $90/2.
        expect(out.get(plan(2).id)).toBe(15);
        expect(out.get(plan(3).id)).toBe(15);

        const total = [plan(1), plan(2), plan(3)].reduce((a, p) => a + (out.get(p.id) || 0), 0);
        expect(total).toBeCloseTo(90, 2);
    });

    it("no inventa costo negativo si lo exacto supera el total del tipo", () => {
        // Puede pasar por desfases de consolidación entre ambas consultas.
        const exact = new Map([[plan(1).id.toLowerCase(), 200]]);
        const out = distributeCostPerResource(
            [plan(1), plan(2)],
            new Map([["microsoft.web/serverfarms", new Decimal(90)]]),
            exact,
        );
        expect(out.get(plan(1).id)).toBe(200);
        expect(out.get(plan(2).id)).toBe(0);
    });

    it("un costo exacto de 0 no se toma como dato y cae al respaldo", () => {
        // 0 en Cost Management es indistinguible de "todavía sin facturación".
        const exact = new Map([[plan(1).id.toLowerCase(), 0]]);
        const out = distributeCostPerResource(
            [plan(1), plan(2)],
            new Map([["microsoft.web/serverfarms", new Decimal(90)]]),
            exact,
        );
        expect(out.get(plan(1).id)).toBe(45);
        expect(out.get(plan(2).id)).toBe(45);
    });

    it("separa los totales por tipo de recurso", () => {
        const sql = { id: "/subscriptions/s1/providers/Microsoft.Sql/servers/db1", type: "microsoft.sql/servers" };
        const out = distributeCostPerResource(
            [plan(1), plan(2), sql],
            new Map([
                ["microsoft.web/serverfarms", new Decimal(50)],
                ["microsoft.sql/servers", new Decimal(80)],
            ]),
        );
        expect(out.get(plan(1).id)).toBe(25);
        expect(out.get(plan(2).id)).toBe(25);
        expect(out.get(sql.id)).toBe(80);
    });

    it("sin costo del tipo devuelve 0, no NaN", () => {
        const out = distributeCostPerResource([plan(1)], new Map());
        expect(out.get(plan(1).id)).toBe(0);
    });
});
