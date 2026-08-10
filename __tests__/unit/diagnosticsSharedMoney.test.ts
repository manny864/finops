import Decimal from "decimal.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azure", () => ({ getResourceGraphClient: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(), set: vi.fn() } }));

import { distributeCostPerResource } from "@/app/api/intelligence/databases/diagnosticsShared";

describe("distributeCostPerResource", () => {
    it("rounds Decimal allocations to cents without floating-point drift", () => {
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

        const allocation = distributeCostPerResource(resources, costs);

        expect(allocation.get("one")).toBe(3.34);
        expect(allocation.get("two")).toBe(3.34);
        expect(allocation.get("three")).toBe(3.34);
        expect(allocation.get("mysql")).toBe(0.3);
    });
});