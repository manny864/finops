// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getLoadTestHistory,
    getSystemPerformanceAlerts,
    executeLoadTest,
    acknowledgePerformanceAlert,
    resolvePerformanceAlert,
} from "@/services/loadTesting.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: mocks.mockPoolQuery,
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("loadTesting.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("getLoadTestHistory returns mock history runs when isMock is true", async () => {
        const history = await getLoadTestHistory(true);

        expect(history.length).toBe(3);
        const statusRun = history.find((h) => h.targetLabel === "status");
        expect(statusRun).toBeDefined();
        expect(statusRun?.p95LatencyMs).toBe(113);
        expect(statusRun?.concurrencyLevel).toBe(10);
        expect(statusRun?.throughputReqPerSec).toBe(77.6);
    });

    it("getSystemPerformanceAlerts returns pending alerts in mock mode", async () => {
        const alerts = await getSystemPerformanceAlerts(true, true);

        expect(alerts.length).toBe(1);
        expect(alerts[0].alertType).toBe("HIGH_LATENCY_P95");
        expect(alerts[0].severity).toBe("WARNING");
        expect(alerts[0].status).toBe("PENDING");
    });

    it("executeLoadTest performs simulated run in mock mode", async () => {
        const result = await executeLoadTest(
            {
                targetEndpoint: "/api/status",
                concurrencyLevel: 10,
                durationSeconds: 5,
            },
            "superadmin@cscloudsolutions.com",
            true
        );

        expect(result.success).toBe(true);
        expect(result.result.totalRequests).toBe(388);
        expect(result.result.p95Ms).toBe(113);
        expect(result.result.concurrency).toBe(10);
    });

    it("acknowledgePerformanceAlert updates status in database", async () => {
        mocks.mockPoolQuery.mockResolvedValueOnce([{}]);

        const result = await acknowledgePerformanceAlert("alert-001", "superadmin@cscloudsolutions.com", false);

        expect(result.success).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalled();
    });

    it("resolvePerformanceAlert resolves alert in database", async () => {
        mocks.mockPoolQuery.mockResolvedValueOnce([{}]);

        const result = await resolvePerformanceAlert("alert-001", "superadmin@cscloudsolutions.com", false);

        expect(result.success).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalled();
    });
});
