import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import {
    calculateEmissions,
    calculateDiskEmissions,
    calculateStorageEmissions,
    emissionsEquivalencies,
    suggestGreenMigration,
    regionIntensity,
} from "./carbonService";
import {
    SustainabilitySummary,
    RegionEmissionsItem,
    GreenMigrationRecommendation,
} from "@/types/sustainability.types";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from '@/lib/apiErrors';

export class AzureSustainabilityService {
    /**
     * Retrieves the complete Sustainability & Carbon Footprint summary.
     */
    static async getSustainabilitySummary(
        tenantId: string,
        subscriptionId: string = "All",
        tier: string = "Enterprise"
    ): Promise<SustainabilitySummary> {
        if (isMockTenant(tenantId)) {
            return this.getMockSustainability(tier);
        }

        return this.fetchLiveSustainability(tenantId, subscriptionId);
    }

    /**
     * Synthetic data scaled by tier for Demo/Mock tenants.
     */
    static getMockSustainability(tier: string = "Enterprise"): SustainabilitySummary {
        const normalizedTier = (tier || "Enterprise").toUpperCase();
        let multiplier = 1.0;
        if (normalizedTier === "PROFESSIONAL") multiplier = 0.4;
        else if (normalizedTier === "BUSINESS") multiplier = 0.75;
        else multiplier = 1.0;

        const baseTotal = 26.62 * multiplier;
        const baseAvoided = 0.00;
        const basePotential = 0.09 * multiplier;
        const carKm = Math.round(139 * multiplier);
        const trees = Math.round(1.2 * multiplier * 10) / 10;
        const phones = Math.round(3328 * multiplier);

        const regions: RegionEmissionsItem[] = [
            {
                region: "eastus2",
                resourcesCount: Math.round(18 * multiplier) || 6,
                gridIntensityGramsPerKwh: 380,
                monthlyEmissionsKgCO2e: Math.round(15.24 * multiplier * 100) / 100,
            },
            {
                region: "westus2",
                resourcesCount: Math.round(12 * multiplier) || 4,
                gridIntensityGramsPerKwh: 240,
                monthlyEmissionsKgCO2e: Math.round(6.85 * multiplier * 100) / 100,
            },
            {
                region: "canadacentral",
                resourcesCount: Math.round(8 * multiplier) || 3,
                gridIntensityGramsPerKwh: 130,
                monthlyEmissionsKgCO2e: Math.round(3.12 * multiplier * 100) / 100,
            },
            {
                region: "norwayeast",
                resourcesCount: Math.round(4 * multiplier) || 2,
                gridIntensityGramsPerKwh: 30,
                monthlyEmissionsKgCO2e: Math.round(0.85 * multiplier * 100) / 100,
            },
            {
                region: "swedencentral",
                resourcesCount: Math.round(3 * multiplier) || 1,
                gridIntensityGramsPerKwh: 40,
                monthlyEmissionsKgCO2e: Math.round(0.56 * multiplier * 100) / 100,
            },
        ];

        const recommendations: GreenMigrationRecommendation[] = [
            {
                fromRegion: "eastus2",
                fromIntensity: 380,
                toRegion: "canadacentral",
                toIntensity: 130,
                emissionsReductionPercentage: 65.8,
                co2AvoidedKg: Math.round(10.03 * multiplier * 100) / 100,
                resourcesCount: Math.round(18 * multiplier) || 6,
                sampleResources: ["vm-prod-app-01", "vm-prod-db-01", "stprodappdata"],
            },
            {
                fromRegion: "westus2",
                fromIntensity: 240,
                toRegion: "swedencentral",
                toIntensity: 40,
                emissionsReductionPercentage: 83.3,
                co2AvoidedKg: Math.round(5.71 * multiplier * 100) / 100,
                resourcesCount: Math.round(12 * multiplier) || 4,
                sampleResources: ["vm-analytics-worker-01", "stanalyitcsstore"],
            },
        ];

        return {
            totalCarbonKgCO2e: Math.round(baseTotal * 100) / 100,
            avoidedEmissionsKgCO2e: Math.round(baseAvoided * 100) / 100,
            potentialReductionKgCO2e: Math.round(basePotential * 100) / 100,
            carKilometersEquivalent: carKm,
            treesEquivalent: trees,
            smartphoneChargesEquivalent: phones,
            vmCount: Math.round(24 * multiplier) || 8,
            storageCount: Math.round(14 * multiplier) || 5,
            zombieCount: 0,
            regions,
            recommendations,
        };
    }

    /**
     * Live Azure Resource Graph query and emission calculations.
     */
    private static async fetchLiveSustainability(
        tenantId: string,
        subscriptionId: string
    ): Promise<SustainabilitySummary> {
        let credential;
        try {
            credential = await getAzureCredential(tenantId);
        } catch {
            return this.emptySustainability();
        }

        const client = new ResourceGraphClient(credential);
        let vms: any[] = [];
        let disks: any[] = [];
        let storageAccts: any[] = [];

        try {
            let subs: string[] | undefined;
            if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
                subs = [subscriptionId];
            } else {
                subs = await getSubscriptionsForTenant(tenantId, credential);
            }

            const subFilter = subscriptionId && subscriptionId.toLowerCase() !== "all"
                ? `| where subscriptionId =~ '${subscriptionId}'`
                : "";

            // 1. Active VMs
            const vmQuery = `
                Resources
                | where type =~ 'Microsoft.Compute/virtualMachines'
                ${subFilter}
                | project name, location, resourceGroup, subscriptionId
            `;
            const vmRes = await client.resources({ query: vmQuery, subscriptions: subs });
            vms = (vmRes.data as any[]) || [];

            // 2. Zombie / Unattached Disks
            const diskQuery = `
                Resources
                | where type =~ 'Microsoft.Compute/disks'
                | where properties.diskState == 'Unattached'
                ${subFilter}
                | project name, location, sizeGB = toint(properties.diskSizeGB)
            `;
            const diskRes = await client.resources({ query: diskQuery, subscriptions: subs });
            disks = (diskRes.data as any[]) || [];

            // 3. Storage Accounts
            const storageQuery = `
                Resources
                | where type =~ 'Microsoft.Storage/storageAccounts'
                ${subFilter}
                | project name, location, sku = tostring(sku.name)
            `;
            const stRes = await client.resources({ query: storageQuery, subscriptions: subs });
            storageAccts = (stRes.data as any[]) || [];
        } catch (e) {
            console.warn(`[AzureSustainabilityService] Error querying ARG for tenant ${tenantId}:`, errorMessage(e));
            return this.emptySustainability();
        }

        let totalFootprint = 0;
        const regionMap: Record<string, { kg: number; resources: number; intensity: number; names: string[] }> = {};

        // VM footprint (730h / month)
        for (const vm of vms) {
            const loc = (vm.location || "default").toLowerCase();
            const kg = calculateEmissions(730, loc);
            totalFootprint += kg;
            if (!regionMap[loc]) {
                regionMap[loc] = { kg: 0, resources: 0, intensity: regionIntensity(loc), names: [] };
            }
            regionMap[loc].kg += kg;
            regionMap[loc].resources += 1;
            if (regionMap[loc].names.length < 5 && vm.name) {
                regionMap[loc].names.push(vm.name);
            }
        }

        // Storage footprint (assumes standard 500GB / storage account)
        for (const sa of storageAccts) {
            const loc = (sa.location || "default").toLowerCase();
            const sku = (sa.sku || "Standard_LRS").toString();
            const redundancy = sku.split("_").pop() || "LRS";
            const assumedGB = 500;
            const kg = calculateStorageEmissions(assumedGB, loc, redundancy, 1);
            totalFootprint += kg;
            if (!regionMap[loc]) {
                regionMap[loc] = { kg: 0, resources: 0, intensity: regionIntensity(loc), names: [] };
            }
            regionMap[loc].kg += kg;
            regionMap[loc].resources += 1;
            if (regionMap[loc].names.length < 5 && sa.name) {
                regionMap[loc].names.push(sa.name);
            }
        }

        // Avoided emissions from zombie disks
        let avoided = 0;
        for (const d of disks) {
            avoided += calculateDiskEmissions(730, d.location);
        }

        // Green migration recommendations
        const regionsRanked = Object.entries(regionMap).sort((a, b) => b[1].kg - a[1].kg);
        const recommendations: GreenMigrationRecommendation[] = [];
        let totalPotentialAvoidedKg = 0;

        for (const [region, regData] of regionsRanked) {
            const rec = suggestGreenMigration(region);
            if (rec) {
                const projectedReductionKg = regData.kg * (rec.reductionPct / 100);
                totalPotentialAvoidedKg += projectedReductionKg;
                recommendations.push({
                    fromRegion: rec.fromRegion,
                    fromIntensity: rec.currentIntensity,
                    toRegion: rec.toRegion,
                    toIntensity: rec.targetIntensity,
                    emissionsReductionPercentage: Math.round(rec.reductionPct * 10) / 10,
                    co2AvoidedKg: Math.round(projectedReductionKg * 100) / 100,
                    resourcesCount: regData.resources,
                    sampleResources: regData.names,
                });
            }
        }

        const eq = emissionsEquivalencies(totalFootprint);

        const regionsList: RegionEmissionsItem[] = Object.entries(regionMap).map(([reg, d]) => ({
            region: reg,
            resourcesCount: d.resources,
            gridIntensityGramsPerKwh: d.intensity,
            monthlyEmissionsKgCO2e: Math.round(d.kg * 100) / 100,
        }));

        return {
            totalCarbonKgCO2e: Math.round(totalFootprint * 100) / 100,
            avoidedEmissionsKgCO2e: Math.round(avoided * 100) / 100,
            potentialReductionKgCO2e: Math.round(totalPotentialAvoidedKg * 100) / 100,
            carKilometersEquivalent: Math.round(eq.carKm),
            treesEquivalent: Math.round(eq.treesYear * 10) / 10,
            smartphoneChargesEquivalent: Math.round(eq.phoneCharges),
            vmCount: vms.length,
            storageCount: storageAccts.length,
            zombieCount: disks.length,
            regions: regionsList.sort((a, b) => b.monthlyEmissionsKgCO2e - a.monthlyEmissionsKgCO2e),
            recommendations,
        };
    }

    private static emptySustainability(): SustainabilitySummary {
        return {
            totalCarbonKgCO2e: 0,
            avoidedEmissionsKgCO2e: 0,
            potentialReductionKgCO2e: 0,
            carKilometersEquivalent: 0,
            treesEquivalent: 0,
            smartphoneChargesEquivalent: 0,
            vmCount: 0,
            storageCount: 0,
            zombieCount: 0,
            regions: [],
            recommendations: [],
        };
    }
}
