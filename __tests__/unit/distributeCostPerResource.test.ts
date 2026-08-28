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

import {
    distributeCostPerResource,
    classifyCostIssue,
} from "@/app/api/intelligence/databases/diagnosticsShared";

const plan = (n: number) => ({
    id: `/subscriptions/s1/resourceGroups/rg/providers/Microsoft.Web/serverfarms/plan${n}`,
    type: "microsoft.web/serverfarms",
});

const tipoConTotal = (total: number) =>
    new Map([["microsoft.web/serverfarms", new Decimal(total)]]);

describe("distributeCostPerResource", () => {
    it("devuelve el costo exacto de cada recurso", () => {
        const exact = new Map([
            [plan(1).id.toLowerCase(), 70],
            [plan(2).id.toLowerCase(), 15],
        ]);
        const out = distributeCostPerResource([plan(1), plan(2)], tipoConTotal(85), exact);
        expect(out.get(plan(1).id)).toBe(70);
        expect(out.get(plan(2).id)).toBe(15);
    });

    /**
     * Reportado dos veces: dos App Service Plans con SKUs distintos mostraban el
     * mismo importe. Era el total del tipo repartido en partes iguales. Ahora un
     * recurso sin dato propio queda fuera del Map y la UI dice "sin datos".
     */
    it("NO reparte el total del tipo entre los recursos sin dato propio", () => {
        const out = distributeCostPerResource([plan(1), plan(2), plan(3)], tipoConTotal(90));
        expect(out.size).toBe(0);
        expect(out.get(plan(1).id)).toBeUndefined();
    });

    it("no inventa un promedio para el recurso que sí quedó sin dato", () => {
        const exact = new Map([[plan(1).id.toLowerCase(), 60]]);
        const out = distributeCostPerResource([plan(1), plan(2)], tipoConTotal(90), exact);
        expect(out.get(plan(1).id)).toBe(60);
        // plan(2) no tiene facturación propia: ausente, no 30 ni 15.
        expect(out.has(plan(2).id)).toBe(false);
    });

    it("matchea el ResourceId sin importar mayúsculas", () => {
        // Cost Management devuelve los ids en minúscula; Resource Graph no.
        const exact = new Map([[plan(1).id.toLowerCase(), 42]]);
        const out = distributeCostPerResource([plan(1)], tipoConTotal(90), exact);
        expect(out.get(plan(1).id)).toBe(42);
    });

    it("un costo exacto de 0 se trata como ausencia de dato", () => {
        // 0 en Cost Management es indistinguible de "todavía sin facturación".
        const exact = new Map([[plan(1).id.toLowerCase(), 0]]);
        const out = distributeCostPerResource([plan(1)], tipoConTotal(90), exact);
        expect(out.has(plan(1).id)).toBe(false);
    });

    it("sin costos exactos devuelve un Map vacío", () => {
        expect(distributeCostPerResource([plan(1)], new Map()).size).toBe(0);
    });
});

describe("classifyCostIssue", () => {
    // Una suscripción de patrocinio de Microsoft devuelve este mismo error: no
    // expone Cost Management por API, y no hay permiso que otorgar.
    it("reconoce la falta de acceso a los costos", () => {
        expect(classifyCostIssue("Customer does not have the privilege to see the cost")).toBe("no_access");
        expect(classifyCostIssue("The client is not authorized to perform action")).toBe("no_access");
        expect(classifyCostIssue("Forbidden")).toBe("no_access");
    });

    it("reconoce el throttling", () => {
        expect(classifyCostIssue("Too many requests. Please retry.")).toBe("throttled");
        expect(classifyCostIssue("429")).toBe("throttled");
    });

    it("cae a desconocido sin adivinar", () => {
        expect(classifyCostIssue("connection reset by peer")).toBe("unknown");
        expect(classifyCostIssue("")).toBe("unknown");
    });
});
