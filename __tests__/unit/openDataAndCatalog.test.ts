import { describe, it, expect } from "vitest";
import { parseCSV } from "@/lib/openData";
import { kqlCatalog } from "@/modules/core/kqlCatalog";

describe("openData.parseCSV", () => {
    it("parsea el header actual de Regions.csv (OriginalValue,RegionId,RegionName)", () => {
        const rows = parseCSV("OriginalValue,RegionId,RegionName\nus east,eastus,East US\n");
        expect(rows[0]).toEqual(["OriginalValue", "RegionId", "RegionName"]);
        expect(rows[1]).toEqual(["us east", "eastus", "East US"]);
    });

    it("respeta comas dentro de campos entrecomillados", () => {
        const rows = parseCSV('a,b\n"x,y",z\n');
        expect(rows[1]).toEqual(["x,y", "z"]);
    });
});

describe("kqlCatalog — colector de Application Gateways sin uso (FinOps Toolkit gap)", () => {
    it("incluye unusedAppGateways apuntando al tipo ARM correcto", () => {
        expect(kqlCatalog.unusedAppGateways).toBeDefined();
        expect(kqlCatalog.unusedAppGateways).toContain("microsoft.network/applicationgateways");
        // detecta ausencia de backend o de reglas de ruteo
        expect(kqlCatalog.unusedAppGateways).toMatch(/backendAddressPools|requestRoutingRules/);
        // proyecta las columnas que el motor de zombies consume
        expect(kqlCatalog.unusedAppGateways).toContain("subscriptionId");
    });

    it("incluye emptySqlElasticPools (join a databases por elasticPoolId)", () => {
        expect(kqlCatalog.emptySqlElasticPools).toBeDefined();
        expect(kqlCatalog.emptySqlElasticPools).toContain("microsoft.sql/servers/elasticpools");
        expect(kqlCatalog.emptySqlElasticPools).toContain("microsoft.sql/servers/databases");
        expect(kqlCatalog.emptySqlElasticPools).toMatch(/join/i);
        expect(kqlCatalog.emptySqlElasticPools).toContain("subscriptionId");
    });

    it("incluye idleVmss (scale sets con capacity 0)", () => {
        expect(kqlCatalog.idleVmss).toBeDefined();
        expect(kqlCatalog.idleVmss).toContain("microsoft.compute/virtualmachinescalesets");
        expect(kqlCatalog.idleVmss).toMatch(/capacity/i);
        expect(kqlCatalog.idleVmss).toContain("subscriptionId");
    });
});
