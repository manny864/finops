import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, getAllSubsMock, getExcludedMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    getAllSubsMock: vi.fn(),
    getExcludedMock: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/azure", () => ({
    getAllSubscriptionsForTenant: getAllSubsMock,
    getExcludedSubscriptionIds: getExcludedMock,
}));

import { getSubscriptionRollup } from "@/services/tenantAccountStatus.service";

const SUB_WITH_COST = "11111111-1111-1111-1111-111111111111";
const SUB_NO_COST = "22222222-2222-2222-2222-222222222222"; // "RPA Patrocinio Producción"

beforeEach(() => {
    queryMock.mockReset();
    getAllSubsMock.mockReset();
    getExcludedMock.mockReset().mockResolvedValue(new Set());
});

describe("getSubscriptionRollup (MEJ-25)", () => {
    it("incluye una suscripción descubierta por ARM aunque no tenga gasto ingerido este mes", async () => {
        queryMock.mockResolvedValue([[
            { subscriptionId: SUB_WITH_COST, monthlySpend: 100, seriesCount: 3, lastSample: new Date() },
        ]]);
        // Descubierta por Management API/delegación pero sin CostSnapshots este mes:
        // antes de este fix, no aparecía en la tabla ni tenía botón de desvincular.
        getAllSubsMock.mockResolvedValue([SUB_WITH_COST, SUB_NO_COST]);

        const items = await getSubscriptionRollup("tenant-1");

        const ids = items.map((i) => i.subscriptionId);
        expect(ids).toContain(SUB_WITH_COST);
        expect(ids).toContain(SUB_NO_COST);

        const noCost = items.find((i) => i.subscriptionId === SUB_NO_COST)!;
        expect(noCost.monthlySpendUSD).toBe(0);
        expect(noCost.isIngestionHealthy).toBe(false);
    });

    it("una suscripción desvinculada no aparece aunque el descubrimiento la traiga", async () => {
        queryMock.mockResolvedValue([[]]);
        getAllSubsMock.mockResolvedValue([SUB_NO_COST]);
        getExcludedMock.mockResolvedValue(new Set([SUB_NO_COST.toLowerCase()]));

        const items = await getSubscriptionRollup("tenant-1");
        expect(items).toHaveLength(0);
    });

    it("si el descubrimiento ARM falla, no rompe: degrada a lo que haya en CostSnapshots", async () => {
        queryMock.mockResolvedValue([[
            { subscriptionId: SUB_WITH_COST, monthlySpend: 50, seriesCount: 1, lastSample: new Date() },
        ]]);
        getAllSubsMock.mockRejectedValue(new Error("ARM no disponible"));

        const items = await getSubscriptionRollup("tenant-1");
        expect(items.map((i) => i.subscriptionId)).toEqual([SUB_WITH_COST]);
    });
});
