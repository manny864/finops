import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureCapturedSavingsService } from "@/services/azureCapturedSavings.service";
import pool from "@/modules/storage/db";
import * as snapshotService from "@/services/snapshotService";

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: vi.fn(),
    },
}));

vi.mock("@/services/snapshotService", () => ({
    getSnapshotHistory: vi.fn(),
}));

describe("AzureCapturedSavingsService", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("getMockCapturedSavings", () => {
        it("returns structured mock data for Enterprise tier", () => {
            const data = AzureCapturedSavingsService.getMockCapturedSavings("Enterprise");
            expect(data.currentPotentialSavingsUSD).toBeGreaterThan(0);
            expect(data.currentDetectedWasteUSD).toBeGreaterThan(0);
            expect(data.totalHistoricalSnapshots).toBe(16);
            expect(data.trend.length).toBe(12);
            expect(data.auditLog.length).toBeGreaterThan(0);

            for (const point of data.trend) {
                expect(point.date).toBeDefined();
                expect(point.detectedWasteUSD).toBeGreaterThan(0);
                expect(point.potentialSavingsUSD).toBeGreaterThan(0);
                expect(point.realizedSavingsUSD).toBeGreaterThan(0);
            }
        });

        it("returns scaled mock data for Professional and Business tiers", () => {
            const proData = AzureCapturedSavingsService.getMockCapturedSavings("Professional");
            const entData = AzureCapturedSavingsService.getMockCapturedSavings("Enterprise");
            const bizData = AzureCapturedSavingsService.getMockCapturedSavings("Business");

            expect(proData.currentPotentialSavingsUSD).toBeLessThan(entData.currentPotentialSavingsUSD);
            expect(bizData.currentPotentialSavingsUSD).toBeLessThan(entData.currentPotentialSavingsUSD);
            expect(proData.currentPotentialSavingsUSD).toBeLessThan(bizData.currentPotentialSavingsUSD);
        });

        it("contains well-formed audit log entries with status and monthly savings", () => {
            const data = AzureCapturedSavingsService.getMockCapturedSavings("Enterprise");
            for (const item of data.auditLog) {
                expect(item.id).toBeDefined();
                expect(item.executedBy).toContain("@cscloudsolutions.com.ar");
                expect(item.monthlySavingsUSD).toBeGreaterThan(0);
                expect(["SUCCESS", "FAILED"]).toContain(item.status);
            }
        });
    });

    describe("getCapturedSavings (Routing & Live Tenant Execution)", () => {
        it("returns mock data immediately when tenant is mock/demo", async () => {
            const res = await AzureCapturedSavingsService.getCapturedSavings("demo-tenant-123", "Enterprise");
            expect(res.trend.length).toBe(12);
            expect(res.auditLog.length).toBeGreaterThan(0);
        });

        it("queries database for snapshots and action logs when tenant is real/connected", async () => {
            const mockSnapshots = [
                {
                    date: "2026-06-01",
                    payload: { totalSavings: 120.0, realizedSavings: 80.0 },
                },
                {
                    date: "2026-07-01",
                    payload: { totalSavings: 150.0, realizedSavings: 100.0 },
                },
            ];

            vi.mocked(snapshotService.getSnapshotHistory).mockResolvedValue(mockSnapshots as any);

            const mockActionRows = [
                {
                    id: 1,
                    user_email: "operator@cscloudsolutions.com.ar",
                    action_type: "DELETE_RESOURCE",
                    resource_id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/disks/disk-orphan",
                    resource_type: "Microsoft.Compute/disks",
                    status: "SUCCESS",
                    details: "Disk deleted",
                    timestamp: "2026-07-05T12:00:00Z",
                },
            ];

            vi.mocked(pool.query).mockResolvedValue([mockActionRows] as any);

            const result = await AzureCapturedSavingsService.getCapturedSavings("real-live-tenant-999", "Enterprise");

            expect(result.currentPotentialSavingsUSD).toBe(150.0);
            expect(result.currentDetectedWasteUSD).toBe(150.0);
            expect(result.totalHistoricalSnapshots).toBe(2);
            expect(result.changePercentageVsLast).toBe(25); // (150-120)/120 * 100 = 25%
            expect(result.trend.length).toBe(2);
            expect(result.auditLog.length).toBe(1);
            expect(result.auditLog[0].resourceName).toBe("disk-orphan");
            expect(result.auditLog[0].monthlySavingsUSD).toBe(45.0);
            expect(result.auditLog[0].status).toBe("SUCCESS");
        });

        it("returns clean empty state ($0.00, empty trend/audit) with ZERO mock fallback when live tenant has no historical data", async () => {
            vi.mocked(snapshotService.getSnapshotHistory).mockResolvedValue([]);
            vi.mocked(pool.query).mockResolvedValue([[]] as any);

            const result = await AzureCapturedSavingsService.getCapturedSavings("real-empty-tenant", "Enterprise");

            expect(result.currentPotentialSavingsUSD).toBe(0);
            expect(result.currentDetectedWasteUSD).toBe(0);
            expect(result.totalHistoricalSnapshots).toBe(0);
            expect(result.changePercentageVsLast).toBe(0);
            expect(result.trend).toEqual([]);
            expect(result.auditLog).toEqual([]);
        });
    });
});
