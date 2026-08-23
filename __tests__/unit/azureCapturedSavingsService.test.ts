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
            // El conteo refleja la serie devuelta; antes era el literal 16.
            expect(data.totalHistoricalSnapshots).toBe(data.trend.length);
            expect(data.trend.length).toBe(12);
            expect(data.auditLog.length).toBeGreaterThan(0);

            for (const point of data.trend) {
                expect(point.date).toBeDefined();
                expect(point.detectedWasteUSD).toBeGreaterThan(0);
                expect(point.potentialSavingsUSD).toBeGreaterThanOrEqual(0);
                // El ahorro realizado sale de los eventos del mes: los meses sin
                // remediaciones son legítimamente 0, no un % del desperdicio.
                expect(point.realizedSavingsUSD).toBeGreaterThanOrEqual(0);
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
                expect(item.executedBy).toBeTruthy();
                // Los eventos de origen `azure` no tienen usuario de la plataforma:
                // se detectan porque el recurso dejó de facturar.
                if (item.origin === "platform" && item.status === "SUCCESS") {
                    expect(item.executedBy).toContain("@cscloudsolutions.com.ar");
                }
                expect(item.monthlySavingsUSD).toBeGreaterThanOrEqual(0);
                if (item.status === "FAILED") expect(item.monthlySavingsUSD).toBe(0);
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

            expect(result.currentDetectedWasteUSD).toBe(150.0);
            // Potencial = desperdicio detectado - ahorro ya capturado en el mes.
            // Antes potencial y desperdicio eran el MISMO campo (ambos 150).
            const realizedJul = result.trend[1].realizedSavingsUSD;
            expect(result.currentPotentialSavingsUSD).toBeCloseTo(150.0 - realizedJul, 2);
            expect(result.totalHistoricalSnapshots).toBe(2);
            expect(result.trend.length).toBe(2);
            expect(result.auditLog.length).toBeGreaterThanOrEqual(1);
            const platformEvent = result.auditLog.find((a) => a.origin === "platform");
            expect(platformEvent?.resourceName).toBe("disk-orphan");
            expect(platformEvent?.resourceGroup).toBe("rg-1");
            expect(platformEvent?.status).toBe("SUCCESS");
            // El ahorro se mide contra el costo real del recurso; ya no se asigna
            // el literal 45 por ser una acción de borrado.
            expect(platformEvent?.monthlySavingsUSD).not.toBe(45.0);
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
