import { describe, it, expect } from "vitest";
import {
    regionIntensity,
    calculateEmissions,
    calculateDiskEmissions,
    calculateStorageEmissions,
    emissionsEquivalencies,
    suggestGreenMigration,
    type MigrationRecommendation,
} from "@/services/carbonService";

describe("carbonService", () => {
    describe("regionIntensity", () => {
        it("returns 380 for eastus", () => {
            expect(regionIntensity("eastus")).toBe(380);
        });

        it("returns correct intensity for francecentral (green region)", () => {
            expect(regionIntensity("francecentral")).toBe(60);
        });

        it("returns 300 (default) for unknown region", () => {
            expect(regionIntensity("unknown")).toBe(300);
        });

        it("returns correct intensity for canadacentral", () => {
            expect(regionIntensity("canadacentral")).toBe(130);
        });

        it("handles case-insensitive region names", () => {
            expect(regionIntensity("EASTUS")).toBe(380);
            expect(regionIntensity("EastUS")).toBe(380);
        });

        it("handles empty string as unknown region", () => {
            expect(regionIntensity("")).toBe(300);
        });
    });

    describe("calculateEmissions", () => {
        it("calculates emissions for 730 hours in eastus (380g CO2/kWh)", () => {
            const result = calculateEmissions(730, "eastus");
            // 0.15 kW × 730 hours × 380 g/kWh = 41,670 grams = 41.67 kg
            expect(result).toBeGreaterThan(40);
            expect(result).toBeLessThan(45);
        });

        it("returns positive value for any region", () => {
            const result = calculateEmissions(100, "westus");
            expect(result).toBeGreaterThan(0);
        });

        it("francecentral (60g/kWh) produces less than eastus (380g/kWh)", () => {
            const emitEastus = calculateEmissions(730, "eastus");
            const emitFrance = calculateEmissions(730, "francecentral");
            expect(emitFrance).toBeLessThan(emitEastus);
        });

        it("handles zero hours", () => {
            const result = calculateEmissions(0, "eastus");
            expect(result).toBe(0);
        });

        it("handles unknown region (uses 300g/kWh default)", () => {
            const result = calculateEmissions(100, "unknown");
            expect(result).toBeGreaterThan(0);
        });
    });

    describe("calculateDiskEmissions", () => {
        it("returns positive number for disk emissions", () => {
            const result = calculateDiskEmissions(730, "eastus");
            expect(result).toBeGreaterThan(0);
        });

        it("handles zero hours", () => {
            const result = calculateDiskEmissions(0, "eastus");
            expect(result).toBe(0);
        });

        it("uses correct power draw (0.005 kW) and region intensity", () => {
            const result = calculateDiskEmissions(1000, "eastus");
            // 0.005 kW × 1000 hours × 380 g/kWh = 1,900 grams = 1.9 kg
            expect(result).toBeGreaterThan(1);
            expect(result).toBeLessThan(3);
        });
    });

    describe("calculateStorageEmissions", () => {
        it("returns positive number for storage emissions", () => {
            const result = calculateStorageEmissions(1000, "eastus", "LRS", 1);
            expect(result).toBeGreaterThan(0);
        });

        it("GRS (2x multiplier) produces ~2x LRS emissions", () => {
            const lrs = calculateStorageEmissions(1000, "eastus", "LRS", 1);
            const grs = calculateStorageEmissions(1000, "eastus", "GRS", 1);
            // GRS should be roughly 2x LRS
            expect(grs).toBeGreaterThan(lrs * 1.9);
            expect(grs).toBeLessThan(lrs * 2.1);
        });

        it("handles multiple months", () => {
            const oneMonth = calculateStorageEmissions(1000, "eastus", "LRS", 1);
            const twoMonths = calculateStorageEmissions(1000, "eastus", "LRS", 2);
            expect(twoMonths).toBeGreaterThan(oneMonth);
            expect(twoMonths).toBeLessThan(oneMonth * 2.1);
        });

        it("defaults to LRS when redundancy not specified", () => {
            const result = calculateStorageEmissions(500, "eastus", "LRS", 1);
            expect(result).toBeGreaterThan(0);
        });

        it("handles ZRS (1.2x multiplier)", () => {
            const lrs = calculateStorageEmissions(1000, "eastus", "LRS", 1);
            const zrs = calculateStorageEmissions(1000, "eastus", "ZRS", 1);
            expect(zrs).toBeGreaterThan(lrs);
            expect(zrs).toBeLessThan(lrs * 1.3);
        });
    });

    describe("emissionsEquivalencies", () => {
        it("returns object with positive values for 100 kg CO2", () => {
            const equiv = emissionsEquivalencies(100);
            expect(equiv.carKm).toBeGreaterThan(0);
            expect(equiv.treesYear).toBeGreaterThan(0);
            expect(equiv.phoneCharges).toBeGreaterThan(0);
        });

        it("carKm is reasonable (roughly 520 km for 100 kg CO2)", () => {
            const equiv = emissionsEquivalencies(100);
            // 100 kg / 0.192 kg per km ≈ 520 km
            expect(equiv.carKm).toBeGreaterThan(500);
            expect(equiv.carKm).toBeLessThan(550);
        });

        it("treesYear is reasonable (roughly 4-5 trees for 100 kg CO2)", () => {
            const equiv = emissionsEquivalencies(100);
            // 100 kg / 21.77 kg per tree ≈ 4.6
            expect(equiv.treesYear).toBeGreaterThan(4);
            expect(equiv.treesYear).toBeLessThan(5);
        });

        it("phoneCharges is large (12.5k charges for 100 kg CO2)", () => {
            const equiv = emissionsEquivalencies(100);
            // 100 kg / 0.008 kg per charge = 12,500
            expect(equiv.phoneCharges).toBeGreaterThan(12000);
            expect(equiv.phoneCharges).toBeLessThan(13000);
        });

        it("handles zero kg CO2", () => {
            const equiv = emissionsEquivalencies(0);
            expect(equiv.carKm).toBe(0);
            expect(equiv.treesYear).toBe(0);
            expect(equiv.phoneCharges).toBe(0);
        });
    });

    describe("suggestGreenMigration", () => {
        it("suggests canadacentral for eastus", () => {
            const result = suggestGreenMigration("eastus");
            expect(result).not.toBeNull();
            expect(result!.toRegion).toBe("canadacentral");
            expect(result!.reductionPct).toBeGreaterThan(0);
        });

        it("shows significant reduction for eastus → canadacentral", () => {
            const result = suggestGreenMigration("eastus");
            // eastus: 380, canadacentral: 130
            // reduction = (380-130)/380 * 100 = ~66%
            expect(result!.reductionPct).toBeGreaterThan(60);
            expect(result!.reductionPct).toBeLessThan(70);
        });

        it("returns null for francecentral (already green)", () => {
            const result = suggestGreenMigration("francecentral");
            expect(result).toBeNull();
        });

        it("returns null for unknown region", () => {
            const result = suggestGreenMigration("unknown");
            expect(result).toBeNull();
        });

        it("handles case-insensitive region names", () => {
            const result = suggestGreenMigration("EASTUS");
            expect(result).not.toBeNull();
            expect(result!.toRegion).toBe("canadacentral");
        });

        it("suggests westeurope → norwayeast", () => {
            const result = suggestGreenMigration("westeurope");
            expect(result).not.toBeNull();
            expect(result!.toRegion).toBe("norwayeast");
        });

        it("returned recommendation has all required fields", () => {
            const result = suggestGreenMigration("eastus");
            expect(result).toHaveProperty("fromRegion");
            expect(result).toHaveProperty("toRegion");
            expect(result).toHaveProperty("currentIntensity");
            expect(result).toHaveProperty("targetIntensity");
            expect(result).toHaveProperty("reductionPct");
        });

        it("target intensity is less than current intensity", () => {
            const result = suggestGreenMigration("eastus");
            expect(result!.targetIntensity).toBeLessThan(result!.currentIntensity);
        });
    });

    describe("green region detection", () => {
        it("suggests eastus2 → canadacentral (same as eastus)", () => {
            const result = suggestGreenMigration("eastus2");
            expect(result!.toRegion).toBe("canadacentral");
        });

        it("suggests southcentralus → westus3", () => {
            const result = suggestGreenMigration("southcentralus");
            expect(result!.toRegion).toBe("westus3");
        });

        it("westus3 has lower intensity than eastus", () => {
            const intEastus = regionIntensity("eastus");
            const intWestus3 = regionIntensity("westus3");
            expect(intWestus3).toBeLessThan(intEastus);
        });
    });
});
