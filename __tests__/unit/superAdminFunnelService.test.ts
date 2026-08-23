// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { getSignupFunnelAnalytics } from "@/services/superAdminFunnel.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
        mockGetConnection: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: mocks.mockPoolQuery,
        getConnection: mocks.mockGetConnection,
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("superAdminFunnel.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
        mocks.mockGetConnection.mockReset();
    });

    it("getSignupFunnelAnalytics returns mock metrics and items when isMock is true", async () => {
        const result = await getSignupFunnelAnalytics({}, true);

        expect(result.metrics.totalSignups30d).toBe(3);
        expect(result.metrics.activeTrials).toBe(1);
        expect(result.metrics.convertedCount).toBe(1);
        expect(result.metrics.conversionRatePercent).toBe(33.33);
        expect(result.metrics.churnRatePercent).toBe(0.0);
        expect(result.metrics.funnelSteps.length).toBe(4);
        expect(result.recentSignups.length).toBe(3);
        expect(result.recentSignups[0].userEmail).toBe("laura.sanchez@fintechlatam.com");
        expect(result.recentSignups[0].planTier).toBe("Enterprise");
    });

    it("filters mock results by email, status and plan", async () => {
        const filteredByPlan = await getSignupFunnelAnalytics({ plan: "Business" }, true);
        expect(filteredByPlan.recentSignups.length).toBe(1);
        expect(filteredByPlan.recentSignups[0].userEmail).toBe("diego.torres@cloudretail.io");

        const filteredByStatus = await getSignupFunnelAnalytics({ status: "EXPIRED" }, true);
        expect(filteredByStatus.recentSignups.length).toBe(1);
        expect(filteredByStatus.recentSignups[0].userEmail).toBe("valeria.castro@logisticsplus.com");

        const filteredByEmail = await getSignupFunnelAnalytics({ searchEmail: "laura" }, true);
        expect(filteredByEmail.recentSignups.length).toBe(1);
        expect(filteredByEmail.recentSignups[0].userEmail).toBe("laura.sanchez@fintechlatam.com");
    });

    it("queries database and normalizes legacy plan tiers in real mode", async () => {
        const mockConn = {
            query: vi
                .fn()
                .mockResolvedValueOnce([[{ count: 5 }]]) // signups30d
                .mockResolvedValueOnce([[{ count: 2 }]]) // trialsActive
                .mockResolvedValueOnce([[{ count: 2 }]]) // converted
                .mockResolvedValueOnce([[{ count: 0 }]]) // churned
                .mockResolvedValueOnce([
                    // funnel
                    { event_type: "signup_started", count: 5 },
                    { event_type: "azure_app_registered", count: 4 },
                    { event_type: "onboarding_completed", count: 3 },
                    { event_type: "converted_to_paid", count: 2 },
                ])
                .mockResolvedValueOnce([
                    [
                        {
                            id: "ev-1",
                            tenant_id: "t-live-1",
                            user_email: "test@live.com",
                            plan: "essential", // Should normalize to Professional
                            status: "ACTIVE",
                            trial_days_left: 5,
                            created_at: "2026-08-15T12:00:00Z",
                        },
                    ],
                ]),
            release: vi.fn(),
        };

        mocks.mockGetConnection.mockResolvedValue(mockConn);

        const result = await getSignupFunnelAnalytics({}, false);

        expect(result.metrics.totalSignups30d).toBe(5);
        expect(result.metrics.activeTrials).toBe(2);
        expect(result.metrics.convertedCount).toBe(2);
        expect(result.metrics.conversionRatePercent).toBe(40);
        expect(result.recentSignups.length).toBe(1);
        expect(result.recentSignups[0].planTier).toBe("Professional");
        expect(mockConn.release).toHaveBeenCalled();
    });
});
