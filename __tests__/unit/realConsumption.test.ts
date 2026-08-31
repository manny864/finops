import { describe, it, expect } from "vitest";
import {
    getMockRealConsumptionOverview,
    getServiceRemediationRule,
    getServiceIconName,
} from "@/services/realConsumptionService";

describe("realConsumptionService", () => {
    it("returns rich calibrated mock overview matching target specifications", () => {
        const overview = getMockRealConsumptionOverview("demo-tenant-mock");

        expect(overview).toBeDefined();
        expect(overview.totalCost).toBe(372.13);
        expect(overview.dailyBurnRate).toBeGreaterThan(0);
        // `>=` y no `>`: la proyección es costo/díasTranscurridos × díasDelMes,
        // así que el ÚLTIMO día del mes el factor es exactamente 1 y proyección
        // == total. Con `>` estricto este test fallaba cada 31 de agosto (y todo
        // último día de mes) sin que nada estuviera roto — reventó en CI el
        // 2026-08-31.
        expect(overview.projectedCost).toBeGreaterThanOrEqual(overview.totalCost);
        expect(overview.hasAnomalies).toBe(true);
        expect(overview.anomalyCount).toBeGreaterThanOrEqual(1);

        // Verify services list
        expect(overview.services.length).toBeGreaterThanOrEqual(6);

        // Verify Redis Cache dominance
        const redis = overview.services.find((s) => s.serviceKey === "redis");
        expect(redis).toBeDefined();
        expect(redis?.totalCost).toBe(86.92);
        expect(redis?.percentageOfTotal).toBeCloseTo(23.36, 1);
        expect(redis?.remediationActionKey).toBe("redis_downgrade");

        // Verify Container Apps
        const containerApps = overview.services.find((s) => s.serviceKey === "container_apps");
        expect(containerApps).toBeDefined();
        expect(containerApps?.totalCost).toBe(72.77);
        expect(containerApps?.percentageOfTotal).toBeCloseTo(19.56, 1);
        expect(containerApps?.remediationActionKey).toBe("container_apps_scale_to_zero");

        // Verify Foundry Models Anomaly
        const foundry = overview.services.find((s) => s.serviceKey === "foundry_models");
        expect(foundry).toBeDefined();
        expect(foundry?.hasAnomaly).toBe(true);
        expect(foundry?.momVariation).toBe(48.3);

        // Verify Top 5 Share of Wallet
        expect(overview.top5ShareOfWallet.length).toBeGreaterThanOrEqual(5);
        const shareSum = overview.top5ShareOfWallet.reduce((s, i) => s + i.percentage, 0);
        expect(shareSum).toBeCloseTo(100, 0);
    });

    it("returns correct remediation rules by service type", () => {
        const redisRule = getServiceRemediationRule("Redis Cache", 86.92);
        expect(redisRule.remediationActionKey).toBe("redis_downgrade");
        expect(redisRule.potentialSavings).toBeGreaterThan(0);

        const acaRule = getServiceRemediationRule("Azure Container Apps", 72.77);
        expect(acaRule.remediationActionKey).toBe("container_apps_scale_to_zero");

        const aiRule = getServiceRemediationRule("Foundry Models", 37.78);
        expect(aiRule.remediationActionKey).toBe("foundry_quota_limit");

        const searchRule = getServiceRemediationRule("Azure Cognitive Search", 18.48);
        expect(searchRule.remediationActionKey).toBe("search_tier_review");

        const acrRule = getServiceRemediationRule("Container Registry", 10.84);
        expect(acrRule.remediationActionKey).toBe("acr_downgrade_basic");

        const vnetRule = getServiceRemediationRule("Virtual Network", 32.29);
        expect(vnetRule.remediationActionKey).toBe("vnet_ip_audit");
    });

    it("returns appropriate icon names", () => {
        expect(getServiceIconName("Redis Cache")).toBe("database");
        expect(getServiceIconName("Azure Container Apps")).toBe("box");
        expect(getServiceIconName("Foundry Models")).toBe("brain");
        expect(getServiceIconName("Azure Cognitive Search")).toBe("search");
        expect(getServiceIconName("Container Registry")).toBe("archive");
        expect(getServiceIconName("Virtual Network")).toBe("network");
        expect(getServiceIconName("Virtual Machines")).toBe("server");
    });
});
