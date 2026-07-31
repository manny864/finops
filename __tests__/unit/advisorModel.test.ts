import { describe, it, expect } from "vitest";
import { parseAzureNumber } from "@/lib/advisorModel";

describe("parseAzureNumber", () => {
  it("parses numbers correctly", () => {
    expect(parseAzureNumber(1234.56)).toBe(1234.56);
    expect(parseAzureNumber(0)).toBe(0);
  });

  it("parses formatted string numbers with commas", () => {
    expect(parseAzureNumber("1,234.56")).toBe(1234.56);
    expect(parseAzureNumber("10,000,000.50")).toBe(10000000.5);
  });

  it("handles empty or invalid inputs gracefully", () => {
    expect(parseAzureNumber(null)).toBe(0);
    expect(parseAzureNumber(undefined)).toBe(0);
    expect(parseAzureNumber("")).toBe(0);
    expect(parseAzureNumber("invalid")).toBe(0);
  });
});
