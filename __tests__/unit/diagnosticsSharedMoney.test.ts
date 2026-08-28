import Decimal from "decimal.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azure", () => ({ getResourceGraphClient: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(), set: vi.fn() } }));

import { distributeCostPerResource } from "@/app/api/intelligence/databases/diagnosticsShared";

/**
 * Este test verificaba que el reparto del total de un tipo entre sus recursos
 * redondeara a centavos sin drift de coma flotante ($10.01 entre 3 = $3.34 cada
 * uno).
 *
 * Ese reparto se eliminó: repartir en partes iguales hacía que recursos con
 * SKUs y precios muy distintos mostraran todos el promedio, indistinguible de
 * su costo real. Ahora sólo se muestra el costo exacto por ResourceId.
 *
 * La propiedad de redondeo sigue verificándose, pero sobre el camino que quedó.
 */
describe("distributeCostPerResource", () => {
    const resources = [
        { id: "one", type: "microsoft.cache/redis" },
        { id: "two", type: "microsoft.cache/redis" },
        { id: "three", type: "microsoft.cache/redis" },
        { id: "mysql", type: "microsoft.dbformysql/flexibleservers" },
    ];
    const costs = new Map([
        ["microsoft.cache/redis", new Decimal("10.01")],
        ["microsoft.dbformysql/flexibleservers", new Decimal("0.30")],
    ]);

    it("ya no reparte el total del tipo entre los recursos", () => {
        const allocation = distributeCostPerResource(resources, costs);

        expect(allocation.size).toBe(0);
        for (const r of resources) {
            expect(allocation.has(r.id)).toBe(false);
        }
    });

    it("redondea a centavos el costo exacto, sin drift de coma flotante", () => {
        const exact = new Map([
            ["one", 3.3366666666666664],
            ["two", 0.1 + 0.2], // 0.30000000000000004 en coma flotante
            ["mysql", 0.3],
        ]);

        const allocation = distributeCostPerResource(resources, costs, exact);

        expect(allocation.get("one")).toBe(3.34);
        expect(allocation.get("two")).toBe(0.3);
        expect(allocation.get("mysql")).toBe(0.3);
        // Sin dato propio: ausente, no un promedio.
        expect(allocation.has("three")).toBe(false);
    });
});
