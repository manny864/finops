import { describe, it, expect, beforeEach, vi } from "vitest";

const mockOverview = {
    success: true,
    mock: false,
    empty: false,
    total: 137.61,
    projectedTotal: 275.0,
    dailyBurnRate: 4.43,
    topCategory: "Compute",
    topCategoryPercentage: 81,
    overallMomVariation: 5.2,
    categories: [
        {
            category: "Compute",
            totalCost: 111.29,
            percentage: 80.87,
            dailyBurnRate: 3.59,
            projectedCost: 222.58,
            momVariation: 4.1,
            hasSpike: false,
            services: [{ name: "Virtual Machines", cost: 111.29, count: 1, percentageOfCategory: 100 }],
            budget: { monthlyBudget: 150, spentPercentage: 74, isOverBudget: false, remainingBudget: 38.71 },
            commitmentMix: { commitmentPct: 35, onDemandPct: 65, commitmentAmount: 38.95, onDemandAmount: 72.34 },
            recommendation: "Rightsizing",
            remediationActionLabel: "Rightsizing ✨",
            remediationActionKey: "compute_rightsizing",
            potentialSavings: 30,
            resources: [],
            iconName: "cpu",
            color: "#0054A6",
        },
        {
            category: "Networking",
            totalCost: 15.03,
            percentage: 10.92,
            dailyBurnRate: 0.48,
            projectedCost: 30.06,
            momVariation: 12.0,
            hasSpike: false,
            services: [{ name: "Virtual Network", cost: 15.03, count: 1, percentageOfCategory: 100 }],
            budget: { monthlyBudget: 25, spentPercentage: 60, isOverBudget: false, remainingBudget: 9.97 },
            commitmentMix: { commitmentPct: 0, onDemandPct: 100, commitmentAmount: 0, onDemandAmount: 15.03 },
            recommendation: "Auditar Egress",
            remediationActionLabel: "Auditar Egress ✨",
            remediationActionKey: "networking_egress",
            potentialSavings: 5,
            resources: [],
            iconName: "network",
            color: "#8B5CF6",
        },
        {
            category: "Storage",
            totalCost: 11.29,
            percentage: 8.21,
            dailyBurnRate: 0.36,
            projectedCost: 22.58,
            momVariation: 1.0,
            hasSpike: false,
            services: [{ name: "Storage Accounts", cost: 11.29, count: 1, percentageOfCategory: 100 }],
            budget: { monthlyBudget: 20, spentPercentage: 56, isOverBudget: false, remainingBudget: 8.71 },
            commitmentMix: { commitmentPct: 0, onDemandPct: 100, commitmentAmount: 0, onDemandAmount: 11.29 },
            recommendation: "Lifecycle",
            remediationActionLabel: "Lifecycle ✨",
            remediationActionKey: "storage_lifecycle",
            potentialSavings: 3,
            resources: [],
            iconName: "hard-drive",
            color: "#10B981",
        },
    ],
    historical6Months: [],
    optimizationOpportunities: [],
    diagnostics: { requestedDays: 30, effectiveDays: 30, rowsFound: 3, source: "mock-test" },
};

const getRealCategoryOverviewMock = vi.fn().mockResolvedValue(mockOverview);

vi.mock("@/services/categoryConsumptionService", () => ({
    getRealCategoryOverview: (...args: unknown[]) => getRealCategoryOverviewMock(...args),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ tenantId: "real-tenant" }),
    AuthError: class AuthError extends Error { status = 401; },
}));

const poolQueryMock = vi.fn();
vi.mock("mysql2/promise", () => ({
    default: {
        createPool: () => ({
            query: (...args: unknown[]) => poolQueryMock(...args),
            getConnection: vi.fn(),
        }),
    },
}));

import { GET } from "@/app/api/intelligence/cost-by-category/route";

function makeRequest(days = 30) {
    return {
        url: `http://localhost/api/intelligence/cost-by-category?tenantId=real-tenant&days=${days}`,
        headers: new Headers(),
    } as any;
}

describe("cost-by-category route", () => {
    beforeEach(() => {
        getRealCategoryOverviewMock.mockClear();
        getRealCategoryOverviewMock.mockResolvedValue(mockOverview);
    });

    it("agrega por categoría, ordena por costo y devuelve el modelo enriquecido", async () => {
        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.mock).toBe(false);
        expect(body.total).toBeCloseTo(137.61, 2);
        expect(body.categories.map((c: any) => c.category)).toEqual(["Compute", "Networking", "Storage"]);
        expect(body.topCategory).toBe("Compute");
        expect(body.categories[0].percentage).toBeCloseTo(80.87, 1);
    });

    it("devuelve empty=true cuando no hay filas", async () => {
        getRealCategoryOverviewMock.mockResolvedValueOnce({
            success: true,
            mock: false,
            empty: true,
            total: 0,
            projectedTotal: 0,
            dailyBurnRate: 0,
            topCategory: null,
            topCategoryPercentage: 0,
            overallMomVariation: 0,
            categories: [],
            historical6Months: [],
            optimizationOpportunities: [],
        });

        const res = await GET(makeRequest());
        const body = await res.json();
        expect(body.empty).toBe(true);
        expect(body.total).toBe(0);
        expect(body.categories).toEqual([]);
    });
});

describe("insertCostCategorySnapshotRow", () => {
    beforeEach(() => { poolQueryMock.mockReset(); poolQueryMock.mockResolvedValue([[], []]); });

    it("inserta en CostCategorySnapshots con la clave (tenant,sub,date,resource_type)", async () => {
        const { insertCostCategorySnapshotRow } =
            await vi.importActual<typeof import("@/modules/storage/db")>("@/modules/storage/db");
        await insertCostCategorySnapshotRow("t1", "2026-07-03", {
            subscriptionId: "sub-1",
            resourceType: "microsoft.compute/virtualmachines",
            cost: 42,
        });
        const [sql, params] = poolQueryMock.mock.calls[0];
        expect(String(sql)).toContain("INSERT INTO CostCategorySnapshots");
        expect(params).toEqual(["t1", "sub-1", "2026-07-03", "microsoft.compute/virtualmachines", 42]);
    });
});
