import { describe, it, expect } from "vitest";
import { BASIC_NETWORK_REMEDIATION_CATEGORIES } from "@/types/basicNetworking.types";
import {
    getMockBasicNetworkingResponse,
    BASIC_NETWORK_COLORS,
    detectBasicNetworkEnvironment,
} from "@/services/azureBasicNetworking.service";

describe("Azure Basic Networking Service", () => {
    it("should return valid mock response with 40 baseline resources in Professional tier", () => {
        const pro = getMockBasicNetworkingResponse("demo-tenant-id");
        expect(pro.success).toBe(true);
        expect(pro.mock).toBe(true);
        expect(pro.resources.length).toBe(40);
        expect(pro.kpis.totalResourcesCount).toBe(40);
        expect(pro.kpis.virtualNetworksCount).toBe(14);
        expect(pro.kpis.privateEndpointsCount).toBe(6);
        expect(pro.kpis.privateDnsZonesCount).toBe(8);
        expect(pro.kpis.nsgUdrCount).toBe(12);
        expect(pro.kpis.totalCostUSD).toBeGreaterThan(0);
        expect(pro.kpis.projectedEndOfMonthCostUSD).toBeGreaterThan(0);
        expect(pro.kpis.orphanedResourcesCount).toBeGreaterThan(0);
    });

    it("should scale costs across Business and Enterprise tiers", () => {
        const pro = getMockBasicNetworkingResponse("demo-tenant-id");
        const business = getMockBasicNetworkingResponse("44444444-5555-6666-7777-888888888888");
        const enterprise = getMockBasicNetworkingResponse("33333333-4444-5555-6666-777777777777");

        expect(business.kpis.totalCostUSD).toBeGreaterThan(pro.kpis.totalCostUSD);
        expect(enterprise.kpis.totalCostUSD).toBeGreaterThan(business.kpis.totalCostUSD);
    });

    it("should accurately detect environment from tags and names", () => {
        expect(detectBasicNetworkEnvironment({ Env: "production" }, "vnet-01", "rg-01")).toBe("prod");
        expect(detectBasicNetworkEnvironment({}, "vnet-dev-spoke", "rg-dev")).toBe("dev");
        expect(detectBasicNetworkEnvironment({}, "pe-staging-sql", "rg-stg")).toBe("staging");
        expect(detectBasicNetworkEnvironment({}, "nsg-qa-test", "rg-qa")).toBe("qa");
        expect(detectBasicNetworkEnvironment({}, "vnet-unknown", "rg-misc")).toBe("unknown");
    });

    it("should configure strict corporate blue palette for all 5 basic network service types", () => {
        expect(BASIC_NETWORK_COLORS["Virtual Networks"]).toBe("#0078D4");
        expect(BASIC_NETWORK_COLORS["Private Endpoints"]).toBe("#2563EB");
        expect(BASIC_NETWORK_COLORS["Private DNS Zones"]).toBe("#38BDF8");
        expect(BASIC_NETWORK_COLORS["Network Security Group"]).toBe("#93C5FD");
        expect(BASIC_NETWORK_COLORS["Route Table"]).toBe("#60A5FA");
    });

    it("should provide actionable remediations with executable Azure CLI and PowerShell scripts", () => {
        const data = getMockBasicNetworkingResponse("demo-tenant-id");
        expect(data.remediations.length).toBeGreaterThan(0);

        for (const rem of data.remediations) {
            expect(rem.commandPayload.cli).toBeTruthy();
            expect(rem.commandPayload.powershell).toBeTruthy();
            // El texto ya no viaja en el payload: se resuelve del catalogo con
            // `rem_<category>_...`, asi que lo que hay que exigir es que la
            // categoria sea una de las conocidas. Se usa la constante exportada
            // en vez de repetir la lista: antes estaba escrita a mano aca y
            // podia quedar vieja sin que nada avisara.
            expect(BASIC_NETWORK_REMEDIATION_CATEGORIES as readonly string[]).toContain(rem.category);
            expect(["DELETE", "DISASSOCIATE", "RIGHTSIZE", "AUDIT"]).toContain(rem.actionType);
        }
    });

    it("should correctly identify orphan NSGs, UDRs, and empty VNets", () => {
        const data = getMockBasicNetworkingResponse("demo-tenant-id");
        const orphans = data.resources.filter((r) => r.isOrphan);
        expect(orphans.length).toBe(data.kpis.orphanedResourcesCount);

        const orphanNsg = orphans.find((r) => r.serviceType === "Network Security Group");
        expect(orphanNsg).toBeDefined();
        expect(orphanNsg?.orphanReasonKey).toBe("orph_NSG_UNUSED");

        const orphanUdr = orphans.find((r) => r.serviceType === "Route Table");
        expect(orphanUdr).toBeDefined();
        expect(orphanUdr?.orphanReasonKey).toBe("orph_UDR_NO_SUBNET");

        const emptyVnet = orphans.find((r) => r.serviceType === "Virtual Networks");
        expect(emptyVnet).toBeDefined();
        expect(emptyVnet?.orphanReasonKey).toBe("orph_VNET_EMPTY");
    });
});
