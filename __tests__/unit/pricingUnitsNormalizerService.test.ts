// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getPricingUnitsCatalog,
    testNormalization,
    reseedPricingUnitsCatalog,
    SEED_CATALOG_ITEMS,
} from "@/services/pricingUnitsNormalizer.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: mocks.mockPoolQuery,
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("pricingUnitsNormalizer.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
        // Simular dataset en base de datos para loadCache
        const seedRows = SEED_CATALOG_ITEMS.map((s) => ({
            uom_raw: s.rawUom,
            block_size: s.blockSize,
            base_unit: s.baseUnit,
            display_unit: s.displayUnit,
            category: s.category,
        }));
        mocks.mockPoolQuery.mockResolvedValue([seedRows]);
    });

    it("getPricingUnitsCatalog returns 45 UoMs in mock mode", async () => {
        const result = await getPricingUnitsCatalog(true);

        expect(result.success).toBe(true);
        expect(result.totalCount).toBe(45);
        expect(result.items.length).toBe(45);

        const hours100 = result.items.find((i) => i.rawUomName === "100 Hours");
        expect(hours100).toBeDefined();
        expect(hours100?.blockSizeMultiplier).toBe(100);
        expect(hours100?.baseUnitKey).toBe("Hour");
        expect(hours100?.category).toBe("COMPUTE");

        const tokens1M = result.items.find((i) => i.rawUomName === "1M Tokens");
        expect(tokens1M).toBeDefined();
        expect(tokens1M?.blockSizeMultiplier).toBe(1000000);
        expect(tokens1M?.category).toBe("AI");
    });

    it("testNormalization accurately calculates FOCUS 1.1 PricingQuantity", async () => {
        const result = await testNormalization({
            unitOfMeasure: "100 Hours",
            quantity: 7.3,
        });

        expect(result.success).toBe(true);
        expect(result.originalUom).toBe("100 Hours");
        expect(result.originalQuantity).toBe(7.3);
        expect(result.normalizedQuantity).toBe(730);
        expect(result.baseUnit).toBe("Hour");
        expect(result.displayUnit).toBe("Hours");
        expect(result.formattedResult).toContain("730.00 Hours");
    });

    it("testNormalization handles 1M Tokens multiplier", async () => {
        const result = await testNormalization({
            unitOfMeasure: "1M Tokens",
            quantity: 2.5,
        });

        expect(result.success).toBe(true);
        expect(result.normalizedQuantity).toBe(2500000);
        expect(result.baseUnit).toBe("Token");
    });

    it("reseedPricingUnitsCatalog re-populates the 45 units", async () => {
        const result = await reseedPricingUnitsCatalog(true);

        expect(result.success).toBe(true);
        expect(result.inserted).toBe(45);
        expect(result.message).toContain("45 UoMs");
    });
});
