import { describe, it, expect, vi } from "vitest";
import {
    getMockNetworkAnalyticsResponse,
    NETWORK_SERVICE_COLORS,
} from "@/lib/mockNetworkAnalytics";

describe("Azure Network Analytics Service", () => {
    it("should return valid mock response with 3 tiers", () => {
        const pro = getMockNetworkAnalyticsResponse("pro");
        expect(pro.success).toBe(true);
        expect(pro.mock).toBe(true);
        expect(pro.resources.length).toBeGreaterThan(0);
        expect(pro.kpis.totalMonthlyCostUSD).toBeGreaterThan(0);
        expect(pro.serviceBreakdown.length).toBeGreaterThan(0);
        expect(pro.remediations.length).toBeGreaterThan(0);

        const business = getMockNetworkAnalyticsResponse("business");
        expect(business.kpis.totalMonthlyCostUSD).toBeGreaterThan(pro.kpis.totalMonthlyCostUSD);

        const enterprise = getMockNetworkAnalyticsResponse("enterprise");
        expect(enterprise.kpis.totalMonthlyCostUSD).toBeGreaterThan(business.kpis.totalMonthlyCostUSD);
    });

    it("should accurately calculate orphan IPs and potential savings in mock", () => {
        const data = getMockNetworkAnalyticsResponse("pro");
        const orphanIps = data.resources.filter((r) => r.serviceType === "Public IP" && r.isOrphan);
        expect(data.kpis.orphanIpsCount).toBe(orphanIps.length);
        expect(data.kpis.orphanIpsPotentialSavingsUSD).toBeGreaterThan(0);
    });

    it("should have correct blue palette colors configured for all network services", () => {
        expect(NETWORK_SERVICE_COLORS["Load Balancers"]).toBe("#0078D4");
        expect(NETWORK_SERVICE_COLORS["Virtual Networks"]).toBe("#2563EB");
        expect(NETWORK_SERVICE_COLORS["Private Endpoints"]).toBe("#0284C7");
        expect(NETWORK_SERVICE_COLORS["Public IP"]).toBe("#38BDF8");
    });

    it("should generate proper CLI and PowerShell payloads in remediations", () => {
        const data = getMockNetworkAnalyticsResponse("pro");
        for (const rem of data.remediations) {
            expect(rem.commandPayload.cli).toBeTruthy();
            expect(rem.commandPayload.powershell).toBeTruthy();
            expect(rem.estimatedSavingsUSD).toBeGreaterThan(0);
            expect(["ORPHAN_IP", "UNUSED_GATEWAY", "NAT_RIGHTSIZING", "PE_OPTIMIZATION", "ORPHAN_LB"]).toContain(rem.category);
        }
    });

    it("should ensure share of wallet breakdown totals approximately 100%", () => {
        const data = getMockNetworkAnalyticsResponse("pro");
        const totalPercentage = data.serviceBreakdown.reduce((sum, item) => sum + item.percentage, 0);
        expect(totalPercentage).toBeGreaterThanOrEqual(99.0);
        expect(totalPercentage).toBeLessThanOrEqual(101.0);
    });
});
