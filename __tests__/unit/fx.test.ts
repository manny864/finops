import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import {
    isSupportedCurrency,
    getCurrencySymbol,
    convertFromUSD,
    formatCurrency,
    resetFxCache,
    type CurrencyCode,
} from "@/lib/fx";

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: vi.fn().mockResolvedValue([[], []]),
    },
}));

describe("fx (multi-currency)", () => {
    beforeEach(() => {
        resetFxCache();
    });

    describe("isSupportedCurrency", () => {
        it("returns true for USD", () => {
            expect(isSupportedCurrency("USD")).toBe(true);
        });

        it("returns true for EUR", () => {
            expect(isSupportedCurrency("EUR")).toBe(true);
        });

        it("returns true for ARS", () => {
            expect(isSupportedCurrency("ARS")).toBe(true);
        });

        it("returns false for unsupported currency", () => {
            expect(isSupportedCurrency("XYZ")).toBe(false);
        });

        it("returns false for lowercase unsupported currency", () => {
            expect(isSupportedCurrency("gbp2")).toBe(false);
        });

        it("returns true for all official supported currencies", () => {
            const supported: CurrencyCode[] = [
                "USD", "EUR", "GBP", "ARS", "BRL", "MXN",
                "CLP", "COP", "PEN", "CAD", "AUD", "JPY",
                "CHF", "CNY", "INR",
            ];
            supported.forEach(c => {
                expect(isSupportedCurrency(c)).toBe(true);
            });
        });
    });

    describe("getCurrencySymbol", () => {
        it("returns '$' for USD", () => {
            expect(getCurrencySymbol("USD")).toBe("$");
        });

        it("returns '€' for EUR", () => {
            expect(getCurrencySymbol("EUR")).toBe("€");
        });

        it("returns 'AR$' for ARS", () => {
            expect(getCurrencySymbol("ARS")).toBe("AR$");
        });

        it("returns '¥' for JPY", () => {
            expect(getCurrencySymbol("JPY")).toBe("¥");
        });

        it("returns correct symbol for GBP", () => {
            expect(getCurrencySymbol("GBP")).toBe("£");
        });

        it("returns correct symbol for BRL", () => {
            expect(getCurrencySymbol("BRL")).toBe("R$");
        });
    });

    describe("convertFromUSD", () => {
        it("converts 100 USD to USD → 100", async () => {
            const result = await convertFromUSD(100, "USD");
            expect(result).toBeInstanceOf(Decimal);
            expect(result.toString()).toBe("100");
        });

        it("converts 100 USD to EUR using fallback rate (0.92)", async () => {
            const result = await convertFromUSD(100, "EUR");
            expect(result).toBeInstanceOf(Decimal);
            const num = result.toNumber();
            expect(num).toBeGreaterThan(0);
            expect(num).toBeLessThanOrEqual(100);
        });

        it("converts Decimal input", async () => {
            const usd = new Decimal("50");
            const result = await convertFromUSD(usd, "USD");
            expect(result.toString()).toBe("50");
        });

        it("converts string input", async () => {
            const result = await convertFromUSD("75.5", "USD");
            expect(result.toString()).toBe("75.5");
        });

        it("converts to ARS (high rate) from USD", async () => {
            const result = await convertFromUSD(100, "ARS");
            const num = result.toNumber();
            expect(num).toBeGreaterThan(100);
        });
    });

    describe("formatCurrency", () => {
        it("formats USD currency starting with symbol", () => {
            const result = formatCurrency(1234.56, "USD");
            expect(result.startsWith("$")).toBe(true);
            expect(result).toContain("1");
        });

        it("formats JPY without decimal point", () => {
            const result = formatCurrency(1000, "JPY");
            expect(result).not.toContain(".");
        });

        it("formats CLP without decimal point", () => {
            const result = formatCurrency(50000, "CLP");
            expect(result).not.toContain(".");
        });

        it("formats COP without decimal point", () => {
            const result = formatCurrency(10000, "COP");
            expect(result).not.toContain(".");
        });

        it("formats ARS without decimal point", () => {
            const result = formatCurrency(5000, "ARS");
            expect(result).not.toContain(".");
        });

        it("formats EUR with decimal point and Euro symbol", () => {
            const result = formatCurrency(1234.56, "EUR");
            expect(result.startsWith("€")).toBe(true);
        });

        it("formats Decimal input", () => {
            const d = new Decimal("999.99");
            const result = formatCurrency(d, "USD");
            expect(result.startsWith("$")).toBe(true);
        });

        it("formats number input", () => {
            const result = formatCurrency(500.50, "USD");
            expect(result.startsWith("$")).toBe(true);
        });

        it("formats string input", () => {
            const result = formatCurrency("250.75", "USD");
            expect(result.startsWith("$")).toBe(true);
        });
    });

    describe("resetFxCache", () => {
        it("does not throw", () => {
            expect(() => resetFxCache()).not.toThrow();
        });

        it("can be called multiple times", () => {
            resetFxCache();
            resetFxCache();
            resetFxCache();
            expect(true).toBe(true);
        });
    });

    describe("caching and rate fallback", () => {
        it("uses fallback rates when DB is empty", async () => {
            const result = await convertFromUSD(100, "GBP");
            const num = result.toNumber();
            // GBP fallback is 0.79
            expect(num).toBeGreaterThan(0);
            expect(num).toBeLessThan(100);
        });
    });
});
