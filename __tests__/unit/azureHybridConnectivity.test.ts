import { describe, it, expect } from "vitest";
import {
    getMockHybridConnectivityData,
    HYBRID_NETWORK_COLORS,
} from "@/services/azureHybridConnectivity.service";
import { HybridNetworkServiceType } from "@/types/hybridConnectivity.types";

describe("Azure Hybrid Connectivity FinOps Service", () => {
    it("should return rich mock dataset with expected KPIs for Professional tier", () => {
        const data = getMockHybridConnectivityData("demo-tenant-pro");
        expect(data.success).toBe(true);
        expect(data.mock).toBe(true);
        expect(data.resources.length).toBeGreaterThanOrEqual(10);
        expect(data.kpis.totalCostUSD).toBeGreaterThan(10000); // Base ~$12,874.99
        expect(data.kpis.totalGatewaysCount).toBeGreaterThanOrEqual(3);
        expect(data.kpis.totalCircuitsCount).toBeGreaterThanOrEqual(2);
        expect(data.kpis.disconnectedTunnelsCount).toBeGreaterThanOrEqual(1);
        expect(data.kpis.orphanedGatewaysCount).toBeGreaterThanOrEqual(1);
    });

    it("should scale costs and resources appropriately for Business and Enterprise tiers", () => {
        const proData = getMockHybridConnectivityData("demo-pro");
        const bizData = getMockHybridConnectivityData("demo-business");
        const entData = getMockHybridConnectivityData("demo-enterprise");

        expect(bizData.kpis.totalCostUSD).toBeCloseTo(proData.kpis.totalCostUSD * 2.5, 1);
        expect(entData.kpis.totalCostUSD).toBeCloseTo(proData.kpis.totalCostUSD * 6.0, 1);
    });

    it("should assign exactly $0.00 base cost to Local Network Gateways (Metadata config)", () => {
        const data = getMockHybridConnectivityData("demo-tenant");
        const localGateways = data.resources.filter((r) => r.serviceType === "Local Network Gateway");
        expect(localGateways.length).toBeGreaterThan(0);
        for (const lg of localGateways) {
            expect(lg.monthlyCostUSD).toBe(0);
            expect(lg.connectionStatus).toBe("ConfigOnly");
        }
    });

    it("should detect orphan gateways and disconnected tunnels in remediations", () => {
        const data = getMockHybridConnectivityData("demo-tenant");
        const orphanRem = data.remediations.find((r) => r.category === "ORPHAN_GATEWAY");
        const disconnRem = data.remediations.find((r) => r.category === "DISCONNECTED_TUNNEL");
        const arbitrageRem = data.remediations.find((r) => r.category === "EXPRESSROUTE_ARBITRAGE");
        const rightsizeRem = data.remediations.find((r) => r.category === "GATEWAY_RIGHTSIZING");

        expect(orphanRem).toBeDefined();
        expect(orphanRem?.actionType).toBe("DELETE");
        expect(orphanRem?.commandPayload.cli).toContain("az network vnet-gateway delete");
        expect(orphanRem?.commandPayload.powershell).toContain("Remove-AzVirtualNetworkGateway");

        expect(disconnRem).toBeDefined();
        expect(disconnRem?.actionType).toBe("DELETE");
        expect(disconnRem?.commandPayload.cli).toContain("az network vpn-connection delete");

        expect(arbitrageRem).toBeDefined();
        expect(arbitrageRem?.actionType).toBe("RECONFIGURE");
        expect(arbitrageRem?.commandPayload.cli).toContain("MeteredData");

        expect(rightsizeRem).toBeDefined();
        expect(rightsizeRem?.actionType).toBe("RIGHTSIZE");
        expect(rightsizeRem?.commandPayload.cli).toContain("VpnGw2");
    });

    it("should conform to strict corporate blue color palette for all hybrid services", () => {
        const expectedServices: HybridNetworkServiceType[] = [
            "ExpressRoute",
            "Virtual WAN",
            "VPN Gateway",
            "Connection",
            "Local Network Gateway",
        ];

        for (const svc of expectedServices) {
            expect(HYBRID_NETWORK_COLORS[svc]).toBeDefined();
            expect(HYBRID_NETWORK_COLORS[svc]).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }

        expect(HYBRID_NETWORK_COLORS["ExpressRoute"]).toBe("#0078D4");
        expect(HYBRID_NETWORK_COLORS["Virtual WAN"]).toBe("#2563EB");
        expect(HYBRID_NETWORK_COLORS["VPN Gateway"]).toBe("#0284C7");
        expect(HYBRID_NETWORK_COLORS["Connection"]).toBe("#38BDF8");
        expect(HYBRID_NETWORK_COLORS["Local Network Gateway"]).toBe("#94A3B8");
    });

    it("should provide valid share of wallet breakdown totaling 100%", () => {
        const data = getMockHybridConnectivityData("demo-tenant");
        const totalPct = data.kpis.breakdown.reduce((sum, b) => sum + b.percentage, 0);
        expect(totalPct).toBeGreaterThanOrEqual(99.0);
        expect(totalPct).toBeLessThanOrEqual(100.5);
    });
});
