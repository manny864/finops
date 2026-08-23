// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getSaaSOperationsHealth,
    triggerCronJob,
    notifySuperAdmins,
} from "@/services/superAdminOperations.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
        mockNotifyTenant: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: mocks.mockPoolQuery,
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications", () => ({
    notifyTenant: mocks.mockNotifyTenant,
}));

describe("superAdminOperations.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
        mocks.mockNotifyTenant.mockReset();
    });

    it("getSaaSOperationsHealth returns complete mock data when isMock is true", async () => {
        const result = await getSaaSOperationsHealth(true);

        expect(result.generalStatus).toBe("OPERATIONAL");
        expect(result.uptime30dPercent).toBe(100);
        expect(result.unacknowledgedAlertsCount).toBe(0);
        expect(result.syncedTenantsRatio).toBe("3/4");
        expect(result.activeChannelsCount).toBe(2);
        expect(result.components.length).toBe(6);
        expect(result.cronJobs.length).toBe(8);

        const anomalyCron = result.cronJobs.find((c) => c.key === "anomaly-detection");
        expect(anomalyCron).toBeDefined();
        expect(anomalyCron?.status).toBe("HEALTHY");
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("getSaaSOperationsHealth queries database in real mode", async () => {
        mocks.mockPoolQuery
            .mockResolvedValueOnce([[{ ping: 1 }]]) // ping
            .mockResolvedValueOnce([[{ overall_status: "operational", db_latency_ms: 12, azure_sync_ratio: 1.0, captured_at: "2026-08-23T00:00:00Z" }]]) // snapshot
            .mockResolvedValueOnce([[{ operational_count: 30, total_count: 30 }]]) // uptime
            .mockResolvedValueOnce([[{ unacknowledged: 0 }]]) // alerts
            .mockResolvedValueOnce([[{ total_tenants: 4, tenants_sync_ok: 3 }]]) // tenant sync
            .mockResolvedValueOnce([[{ enabled_channels: 2 }]]) // channels
            .mockResolvedValueOnce([ // cron runs
                [
                    {
                        cron_name: "anomaly-detection",
                        status: "HEALTHY",
                        duration_ms: 250,
                        summary: "Scan complete",
                        run_at: "2026-08-23T09:00:00Z",
                    },
                ],
            ]);

        const result = await getSaaSOperationsHealth(false);

        expect(result.generalStatus).toBe("OPERATIONAL");
        expect(result.uptime30dPercent).toBe(100);
        expect(result.syncedTenantsRatio).toBe("3/4");
        expect(result.components.length).toBe(6);
        expect(result.cronJobs.length).toBe(8);
        expect(mocks.mockPoolQuery).toHaveBeenCalled();
    });

    it("triggerCronJob queues manual cron execution and returns tracking jobId", async () => {
        const result = await triggerCronJob("anomaly-detection", true);

        expect(result.success).toBe(true);
        expect(result.cronKey).toBe("anomaly-detection");
        expect(result.jobId).toContain("job_manual_anomaly-detection");
        expect(result.message).toContain("anomaly-detection");
    });

    it("notifySuperAdmins broadcasts incident alert to superadmins", async () => {
        mocks.mockPoolQuery.mockResolvedValueOnce([[{ tenant_id: "tenant-superadmin" }]]);
        mocks.mockNotifyTenant.mockResolvedValueOnce({ sent: 1, failed: 0 });

        const result = await notifySuperAdmins(
            {
                severity: "warning",
                title: "Degradación en Azure ARM Gateway",
                message: "Latencia elevada en llamadas a ARG.",
            },
            false
        );

        expect(result.success).toBe(true);
        expect(result.delivered).toBe(1);
        expect(mocks.mockNotifyTenant).toHaveBeenCalledWith(
            "tenant-superadmin",
            expect.objectContaining({
                title: "Degradación en Azure ARM Gateway",
                severity: "warning",
            })
        );
    });
});
