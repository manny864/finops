import { describe, it, expect } from "vitest";
import { minorUnitsToDecimalString, decimalToCents, centsToDecimal } from "@/lib/money";

describe("money.minorUnitsToDecimalString", () => {
    it("converts cents string to exact decimal string", () => {
        expect(minorUnitsToDecimalString("12345", "USD")).toBe("123.45");
        expect(minorUnitsToDecimalString("100", "EUR")).toBe("1.00");
        expect(minorUnitsToDecimalString("5", "USD")).toBe("0.05");
        expect(minorUnitsToDecimalString("0", "USD")).toBe("0.00");
    });

    it("handles negative amounts (refunds/credits)", () => {
        expect(minorUnitsToDecimalString("-12345", "USD")).toBe("-123.45");
        expect(minorUnitsToDecimalString("-5", "USD")).toBe("-0.05");
    });

    it("zero-decimal currencies pass through unchanged", () => {
        expect(minorUnitsToDecimalString("500", "JPY")).toBe("500");
        expect(minorUnitsToDecimalString("1000", "KRW")).toBe("1000");
    });

    it("accepts numeric input", () => {
        expect(minorUnitsToDecimalString(12345, "USD")).toBe("123.45");
    });

    it("rejects invalid input", () => {
        expect(minorUnitsToDecimalString("12.45", "USD")).toBeNull();
        expect(minorUnitsToDecimalString("abc", "USD")).toBeNull();
        expect(minorUnitsToDecimalString(null, "USD")).toBeNull();
        expect(minorUnitsToDecimalString(undefined, "USD")).toBeNull();
        expect(minorUnitsToDecimalString(123.45, "USD")).toBeNull();
    });

    it("preserves precision beyond float safety (no float math)", () => {
        expect(minorUnitsToDecimalString("900719925474099299", "USD")).toBe("9007199254740992.99");
    });
});

describe("money.decimalToCents / centsToDecimal roundtrip", () => {
    it("roundtrips typical amounts", () => {
        expect(decimalToCents("123.45")).toBe(12345);
        expect(centsToDecimal(12345)).toBe(123.45);
        expect(decimalToCents("0.1")).toBe(10);
    });
});
