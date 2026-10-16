import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query } }));

import { getTopBreakdown } from "@/services/costGroupDetailMetricsService";

beforeEach(() => query.mockReset().mockResolvedValue([[]]));

describe("cost group breakdown SQL boundary", () => {
    it.each(["service_name", "MeterName", "ServiceFamily"] as const)("accepts catalog column %s", async (column) => {
        await getTopBreakdown("tenant-a", "resource_group = ?", ["tenant-a", "rg-own"], column);
        expect(query).toHaveBeenCalledOnce();
        expect(query.mock.calls[0][0]).toContain(`NULLIF(${column}, '')`);
        expect(query.mock.calls[0][1]).toEqual(["tenant-a", "rg-own"]);
    });
    it.each(["tenant_id", "service_name) OR 1=1 --", "service_name, tenant_id", "", "SERVICE_NAME"])(
        "rejects non-catalog structure before querying: %s", async (column) => {
            // @ts-expect-error Simulate an untyped runtime caller.
            await expect(getTopBreakdown("tenant-a", "1=1", ["tenant-a"], column))
                .rejects.toThrow("Unsupported cost group breakdown column");
            expect(query).not.toHaveBeenCalled();
        },
    );
    it.each([0, -1, 1.5, 101, NaN, Infinity])("rejects an invalid result limit %s", async (limit) => {
        await expect(getTopBreakdown("tenant-a", "1=1", ["tenant-a"], "service_name", limit))
            .rejects.toThrow("Cost group breakdown limit");
        expect(query).not.toHaveBeenCalled();
    });
    it("preserves decimal aggregation and the Other bucket", async () => {
        query.mockResolvedValue([[{ name: "VM", cost: "12.10" }, { name: "Disk", cost: "0.20" }, { name: "IP", cost: "0.30" }]]);
        expect(await getTopBreakdown("tenant-a", "1=1", ["tenant-a"], "service_name", 1))
            .toEqual([{ name: "VM", cost: 12.1 }, { name: "Other", cost: 0.5 }]);
    });
});
