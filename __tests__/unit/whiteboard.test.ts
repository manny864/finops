import { describe, expect, it } from "vitest";
import { formatCurrencyAxis } from "@/lib/whiteboard";

describe("formatCurrencyAxis", () => {
  it("shows whole dollars for datasets below one thousand", () => {
    expect(formatCurrencyAxis(0, 450.66)).toBe("$0");
    expect(formatCurrencyAxis(50, 450.66)).toBe("$50");
    expect(formatCurrencyAxis(450.66, 450.66)).toBe("$451");
  });

  it("shows one-decimal thousands for larger datasets", () => {
    expect(formatCurrencyAxis(1500, 4200)).toBe("$1.5k");
    expect(formatCurrencyAxis(4000, 4200)).toBe("$4.0k");
  });

  it("fails closed for non-finite values", () => {
    expect(formatCurrencyAxis(Number.NaN, 450)).toBe("$0");
  });
});