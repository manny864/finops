// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// La ruta arrastra SDKs de Azure y la base; para probar la tabla de precios
// pura alcanza con neutralizarlos.
vi.mock("@azure/arm-costmanagement", () => ({ CostManagementClient: class {} }));
vi.mock("@azure/arm-resourcegraph", () => ({ ResourceGraphClient: class {} }));
vi.mock("@/lib/azure", () => ({ getResourceGraphClient: vi.fn(), getAzureCredential: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() }, initializeDatabase: vi.fn() }));

import { estimateAppServiceMonthlyCost } from "@/app/api/intelligence/compute/workloads/route";

describe("estimateAppServiceMonthlyCost", () => {
    it("distingue los tiers clásicos", () => {
        expect(estimateAppServiceMonthlyCost("S1", "Standard", 1, true)).toBe(43.8);
        expect(estimateAppServiceMonthlyCost("B1", "Basic", 1, true)).toBe(13.14);
        expect(estimateAppServiceMonthlyCost("P0v3", "PremiumV3", 1, true)).toBe(36.5);
        expect(estimateAppServiceMonthlyCost("F1", "Free", 1, true)).toBe(0);
    });

    it("escala por cantidad de workers", () => {
        // 131.4 y no `43.8 * 3`: en coma flotante eso da 131.39999999999998 y
        // la función redondea a centavos, que es lo correcto para un importe.
        expect(estimateAppServiceMonthlyCost("S1", "Standard", 3, true)).toBe(131.4);
    });

    it("cobra distinto Linux que Windows", () => {
        expect(estimateAppServiceMonthlyCost("S1", "Standard", 1, true)).toBe(43.8);
        expect(estimateAppServiceMonthlyCost("S1", "Standard", 1, false)).toBe(73.0);
    });

    /**
     * Reportado: dos App Service Plans con SKUs distintos (FC1 y EP1) mostraban
     * exactamente el mismo costo. Eran dos fallas encadenadas — el SKU no
     * llegaba al estimador, y aun llegando, "EP1" colisionaba por substring con
     * los Premium v2 ("EP1".includes("P1")) y cotizaba $73 en vez de $153.30.
     */
    describe("SKUs de Functions no colisionan con los Premium v2", () => {
        it("EP1 es Elastic Premium, no Premium v2", () => {
            expect(estimateAppServiceMonthlyCost("EP1", "ElasticPremium", 1, true)).toBe(153.3);
            expect(estimateAppServiceMonthlyCost("EP1", "ElasticPremium", 1, true)).not.toBe(73.0);
        });

        it("EP2 y EP3 escalan sobre EP1", () => {
            expect(estimateAppServiceMonthlyCost("EP2", "ElasticPremium", 1, true)).toBe(306.6);
            expect(estimateAppServiceMonthlyCost("EP3", "ElasticPremium", 1, true)).toBe(613.2);
        });

        it("FC1 es Flex Consumption", () => {
            expect(estimateAppServiceMonthlyCost("FC1", "FlexConsumption", 1, true)).toBe(28.5);
        });

        // El corazón del reporte.
        it("FC1 y EP1 no cuestan lo mismo", () => {
            const fc1 = estimateAppServiceMonthlyCost("FC1", "FlexConsumption", 1, true);
            const ep1 = estimateAppServiceMonthlyCost("EP1", "ElasticPremium", 1, true);
            expect(fc1).not.toBe(ep1);
        });

        it("los Premium v2 reales siguen cotizando como antes", () => {
            expect(estimateAppServiceMonthlyCost("P1v2", "PremiumV2", 1, true)).toBe(73.0);
            expect(estimateAppServiceMonthlyCost("P2v2", "PremiumV2", 1, true)).toBe(146.0);
        });
    });

    it("SKUs distintos dan precios distintos en general", () => {
        const precios = ["B1", "S1", "P1v3", "P2v3", "EP1", "FC1"].map((s) =>
            estimateAppServiceMonthlyCost(s, "Standard", 1, true),
        );
        // Ningún precio se repite: si el SKU no llegara al estimador, todos
        // caerían al mismo valor por tier.
        expect(new Set(precios).size).toBe(precios.length);
    });
});
