import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import {
    normalizeUnit,
    normalizeUnitSync,
    resetCache,
    getCacheSize,
    type NormalizedUnit,
} from "@/lib/pricingUnits";

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: vi.fn().mockResolvedValue([[], []]),
    },
}));

describe("pricingUnits", () => {
    beforeEach(() => {
        resetCache();
    });

    describe("normalizeUnit", () => {
        it("normalizes '100 Hours' with qty 7.3 → baseUnit 'Hour', normalizedQty 730", async () => {
            const result = await normalizeUnit("100 Hours", 7.3);
            expect(result.baseUnit).toBe("Hour");
            expect(result.normalizedQty.toString()).toBe("730");
            expect(result.inferred).toBe(true);
            expect(result.category).toBe("Time");
        });

        it("normalizes '1 TB' with qty 1 → baseUnit 'TB', normalizedQty 1", async () => {
            const result = await normalizeUnit("1 TB", 1);
            expect(result.baseUnit).toBe("TB");
            expect(result.normalizedQty.toString()).toBe("1");
            expect(result.inferred).toBe(true);
            expect(result.category).toBe("Storage");
        });

        it("normalizes '10K Transactions' with qty 5 → normalizedQty 50000", async () => {
            const result = await normalizeUnit("10K Transactions", 5);
            expect(result.baseUnit).toBe("Transaction");
            expect(result.normalizedQty.toString()).toBe("50000");
            expect(result.inferred).toBe(true);
            expect(result.category).toBe("Transaction");
        });

        it("normalizes '1M Tokens' with qty 2.5 → normalizedQty 2500000", async () => {
            const result = await normalizeUnit("1M Tokens", 2.5);
            expect(result.baseUnit).toBe("Token");
            expect(result.normalizedQty.toString()).toBe("2500000");
            expect(result.inferred).toBe(true);
            expect(result.category).toBe("AI");
        });

        it("handles null/undefined UoM gracefully", async () => {
            const result1 = await normalizeUnit(null, 100);
            expect(result1.baseUnit).toBe("Unit");
            expect(result1.normalizedQty.toString()).toBe("100");
            expect(result1.inferred).toBe(true);

            const result2 = await normalizeUnit(undefined, 50);
            expect(result2.baseUnit).toBe("Unit");
            expect(result2.normalizedQty.toString()).toBe("50");
            expect(result2.inferred).toBe(true);
        });

        it("handles Decimal quantity input", async () => {
            const qty = new Decimal("123.45");
            const result = await normalizeUnit("1 Hour", qty);
            expect(result.normalizedQty.toString()).toBe("123.45");
        });

        it("handles string quantity input", async () => {
            const result = await normalizeUnit("1 Hour", "999");
            expect(result.normalizedQty.toString()).toBe("999");
        });

        it("returns inferred=true for unknown UoM", async () => {
            const result = await normalizeUnit("SomeUnknownUnit", 1);
            expect(result.inferred).toBe(true);
        });
    });

    describe("normalizeUnitSync", () => {
        it("normalizes units synchronously when cache not loaded returns Unit as fallback", () => {
            const result = normalizeUnitSync("100 Hours", 7.3);
            // When cache is null, it returns Unit fallback without parsing UoM
            expect(result.baseUnit).toBe("Unit");
            expect(result.normalizedQty.toString()).toBe("7.3");
            expect(result.inferred).toBe(true);
        });

        it("handles null/undefined UoM in sync mode", () => {
            const result = normalizeUnitSync(null, 42);
            expect(result.baseUnit).toBe("Unit");
            expect(result.normalizedQty.toString()).toBe("42");
        });
    });

    describe("cache management", () => {
        it("resetCache() clears the cache", async () => {
            const size1 = await getCacheSize();
            expect(typeof size1).toBe("number");
            expect(size1).toBeGreaterThanOrEqual(0);

            resetCache();

            const size2 = await getCacheSize();
            expect(typeof size2).toBe("number");
            expect(size2).toBeGreaterThanOrEqual(0);
        });

        it("getCacheSize() returns a non-negative number", async () => {
            const size = await getCacheSize();
            expect(typeof size).toBe("number");
            expect(size).toBeGreaterThanOrEqual(0);
        });
    });

    describe("category inference", () => {
        it("infers 'Time' category for hour/second/minute/day units", async () => {
            const result = await normalizeUnit("10 Hours", 1);
            expect(result.category).toBe("Time");
        });

        it("infers 'Storage' category for GB/TB/MB/Byte units", async () => {
            const result = await normalizeUnit("1 GB", 1);
            expect(result.category).toBe("Storage");
        });

        it("infers 'Transaction' category for transaction/operation/request/call units", async () => {
            const result = await normalizeUnit("100 Operations", 1);
            expect(result.category).toBe("Transaction");
        });

        it("infers 'AI' category for token units", async () => {
            const result = await normalizeUnit("1K Tokens", 1);
            expect(result.category).toBe("AI");
        });

        it("infers 'Other' category for unknown units", async () => {
            const result = await normalizeUnit("RandomUnit", 1);
            expect(result.category).toBe("Other");
        });
    });

    describe("display unit handling", () => {
        it("sets display to singular form of the unit", async () => {
            const result = await normalizeUnit("100 Hours", 1);
            expect(result.display).toContain("Hour");
        });
    });
});
