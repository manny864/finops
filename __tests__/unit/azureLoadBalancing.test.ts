import { describe, it, expect } from "vitest";
import { getMockLoadBalancingData } from "@/services/azureLoadBalancing.service";
import { LOAD_BALANCING_COLORS } from "@/types/loadBalancing.types";

describe("Azure Load Balancing & Ingress FinOps Service", () => {
    it("should return valid mock data with KPIs, resources, and remediations for demo tenant", () => {
        const data = getMockLoadBalancingData("demo-tenant-id");

        expect(data.success).toBe(true);
        expect(data.mock).toBe(true);
        expect(data.kpis).toBeDefined();
        expect(data.kpis.totalCostUSD).toBeGreaterThan(0);
        expect(data.kpis.totalGatewaysCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.totalFrontDoorsCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.totalLoadBalancersCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.totalTrafficManagersCount).toBeGreaterThanOrEqual(1);
        expect(data.resources.length).toBeGreaterThan(0);
        expect(data.remediations.length).toBeGreaterThan(0);
    });

    it("should scale mock costs appropriately for Business and Enterprise tiers", () => {
        const proData = getMockLoadBalancingData("demo-tenant-id");
        const bizData = getMockLoadBalancingData("demo-business-tenant");
        const entData = getMockLoadBalancingData("demo-enterprise-tier-3");

        expect(bizData.kpis.totalCostUSD).toBeCloseTo(proData.kpis.totalCostUSD * 2.5, 0);
        expect(entData.kpis.totalCostUSD).toBeCloseTo(proData.kpis.totalCostUSD * 6.0, 0);
    });

    it("should correctly identify orphan Load Balancers and generate ORPHAN_LB remediation", () => {
        const data = getMockLoadBalancingData("demo-tenant-id");
        const orphanLb = data.resources.find((r) => r.isOrphan);

        expect(orphanLb).toBeDefined();
        expect(orphanLb?.serviceType).toBe("Load Balancer");
        expect(orphanLb?.operationalState).toBe("Orphan");

        const orphanRemediation = data.remediations.find((rem) => rem.category === "ORPHAN_LB");
        expect(orphanRemediation).toBeDefined();
        expect(orphanRemediation?.commandPayload.cli).toContain("az network lb delete");
        expect(orphanRemediation?.commandPayload.powershell).toContain("Remove-AzLoadBalancer");
    });

    it("should calibrate realistic FinOps cost for Traffic Manager", () => {
        const data = getMockLoadBalancingData("demo-tenant-id");
        const tm = data.resources.find((r) => r.serviceType === "Traffic Manager");

        expect(tm).toBeDefined();
        expect(tm?.monthlyCostUSD).toBeLessThan(50); // Calibrated realistic cost vs DNS query volume
    });

    it("should use strict corporate blue palette in service breakdown", () => {
        const data = getMockLoadBalancingData("demo-tenant-id");

        expect(data.kpis.breakdown).toHaveLength(4);
        for (const item of data.kpis.breakdown) {
            expect(item.color).toBe(LOAD_BALANCING_COLORS[item.serviceName]);
        }

        const totalPct = data.kpis.breakdown.reduce((sum, item) => sum + item.percentage, 0);
        expect(totalPct).toBeCloseTo(100, 0);
    });

    it("should include Front Door downgrade and App Gateway autoscale remediations with executable scripts", () => {
        const data = getMockLoadBalancingData("demo-tenant-id");

        const fdRem = data.remediations.find((r) => r.category === "FRONTDOOR_SKU_DOWNGRADE");
        expect(fdRem).toBeDefined();
        expect(fdRem?.commandPayload.cli).toContain("az afd profile update");
        expect(fdRem?.commandPayload.powershell).toContain("Update-AzFrontDoorCdnProfile");

        const appGwRem = data.remediations.find((r) => r.category === "APP_GATEWAY_AUTOSCALE");
        expect(appGwRem).toBeDefined();
        expect(appGwRem?.commandPayload.cli).toContain("az network application-gateway update");
    });
});
