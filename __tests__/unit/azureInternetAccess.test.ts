import { describe, it, expect } from "vitest";
import { getMockInternetAccessData } from "@/services/azureInternetAccess.service";
import { INTERNET_ACCESS_COLORS } from "@/types/internetAccess.types";

describe("Azure Internet Access & Perimeter Security FinOps Service", () => {
    it("should return valid mock data with KPIs, resources, and remediations for demo tenant", () => {
        const data = getMockInternetAccessData("demo-tenant-id");

        expect(data.success).toBe(true);
        expect(data.mock).toBe(true);
        expect(data.kpis).toBeDefined();
        expect(data.kpis.totalCostUSD).toBeGreaterThan(0);
        expect(data.kpis.totalPublicIpsCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.totalNatGatewaysCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.totalFirewallsCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.totalDdosPlansCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.perimeterSecurityCostUSD).toBeGreaterThan(0);
        expect(data.resources.length).toBeGreaterThan(0);
        expect(data.remediations.length).toBeGreaterThan(0);
    });

    it("should scale mock costs appropriately for Business and Enterprise tiers", () => {
        const proData = getMockInternetAccessData("demo-tenant-id");
        const bizData = getMockInternetAccessData("demo-business-tenant");
        const entData = getMockInternetAccessData("demo-enterprise-tier-3");

        expect(bizData.kpis.totalCostUSD).toBeCloseTo(proData.kpis.totalCostUSD * 2.5, 0);
        expect(entData.kpis.totalCostUSD).toBeCloseTo(proData.kpis.totalCostUSD * 6.0, 0);
    });

    it("should correctly identify orphan unattached Public IPs and generate ORPHAN_IP remediation", () => {
        const data = getMockInternetAccessData("demo-tenant-id");
        const orphanPip = data.resources.find((r) => r.isOrphan && r.serviceType === "Public IP");

        expect(orphanPip).toBeDefined();
        expect(orphanPip?.associationStatus).toBe("Unattached");

        const orphanRemediation = data.remediations.find((rem) => rem.category === "ORPHAN_IP");
        expect(orphanRemediation).toBeDefined();
        expect(orphanRemediation?.commandPayload.cli).toContain("az network public-ip delete");
        expect(orphanRemediation?.commandPayload.powershell).toContain("Remove-AzPublicIpAddress");
    });

    it("should generate DDOS_ARBITRAGE remediation when DDoS Network Plan has low IP count", () => {
        const data = getMockInternetAccessData("demo-tenant-id");
        const ddosRem = data.remediations.find((rem) => rem.category === "DDOS_ARBITRAGE");

        expect(ddosRem).toBeDefined();
        expect(ddosRem?.estimatedSavingsUSD).toBeGreaterThan(1000);
        expect(ddosRem?.commandPayload.cli).toContain("az network ddos-protection delete");
    });

    it("should use strict corporate blue palette in service breakdown", () => {
        const data = getMockInternetAccessData("demo-tenant-id");

        expect(data.kpis.breakdown).toHaveLength(4);
        for (const item of data.kpis.breakdown) {
            expect(item.color).toBe(INTERNET_ACCESS_COLORS[item.serviceName]);
        }

        const totalPct = data.kpis.breakdown.reduce((sum, item) => sum + item.percentage, 0);
        expect(totalPct).toBeCloseTo(100, 0);
    });

    it("should include Firewall and NAT Gateway rightsizing remediations with executable scripts", () => {
        const data = getMockInternetAccessData("demo-tenant-id");

        const fwRem = data.remediations.find((r) => r.category === "FIREWALL_RIGHTSIZING");
        expect(fwRem).toBeDefined();
        expect(fwRem?.commandPayload.cli).toContain("az network firewall update");

        const natRem = data.remediations.find((r) => r.category === "NAT_RIGHTSIZING");
        expect(natRem).toBeDefined();
        expect(natRem?.commandPayload.cli).toContain("az network nat gateway delete");
    });
});
