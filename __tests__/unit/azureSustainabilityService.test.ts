import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureSustainabilityService } from "@/services/azureSustainability.service";
import * as azureLib from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

vi.mock("@azure/arm-resourcegraph");

describe("AzureSustainabilityService", () => {
    describe("getMockSustainability", () => {
        it("returns structured mock data for Enterprise tier", () => {
            const data = AzureSustainabilityService.getMockSustainability("Enterprise");
            expect(data.totalCarbonKgCO2e).toBeGreaterThan(0);
            expect(data.avoidedEmissionsKgCO2e).toBeGreaterThanOrEqual(0);
            expect(data.potentialReductionKgCO2e).toBeGreaterThan(0);
            expect(data.carKilometersEquivalent).toBeGreaterThan(0);
            expect(data.treesEquivalent).toBeGreaterThan(0);
            expect(data.smartphoneChargesEquivalent).toBeGreaterThan(0);
            expect(data.vmCount).toBeGreaterThan(0);
            expect(data.storageCount).toBeGreaterThan(0);
            expect(data.regions.length).toBeGreaterThan(0);
            expect(data.recommendations.length).toBeGreaterThan(0);
        });

        it("returns scaled mock data for Professional tier", () => {
            const proData = AzureSustainabilityService.getMockSustainability("Professional");
            const entData = AzureSustainabilityService.getMockSustainability("Enterprise");
            expect(proData.totalCarbonKgCO2e).toBeLessThan(entData.totalCarbonKgCO2e);
            expect(proData.vmCount).toBeLessThan(entData.vmCount);
        });

        it("returns scaled mock data for Business tier", () => {
            const bizData = AzureSustainabilityService.getMockSustainability("Business");
            expect(bizData.totalCarbonKgCO2e).toBeGreaterThan(0);
            expect(bizData.regions.length).toBeGreaterThanOrEqual(2);
        });

        it("ensures green migration recommendations have valid reduction percentages", () => {
            const data = AzureSustainabilityService.getMockSustainability("Enterprise");
            for (const rec of data.recommendations) {
                expect(rec.fromIntensity).toBeGreaterThan(rec.toIntensity);
                expect(rec.emissionsReductionPercentage).toBeGreaterThan(0);
                expect(rec.co2AvoidedKg).toBeGreaterThan(0);
            }
        });
    });

    describe("getSustainabilitySummary (Live Azure simulation)", () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it("queries Resource Graph for VMs, disks and storage and aggregates emissions", async () => {
            vi.spyOn(azureLib, "getAzureCredential").mockResolvedValue({} as any);
            vi.spyOn(azureLib, "getSubscriptionsForTenant").mockResolvedValue(["sub-456"]);

            const mockResources = vi.fn().mockImplementation(async ({ query }: { query: string }) => {
                if (query.includes("Microsoft.Compute/virtualMachines")) {
                    return {
                        data: [
                            { location: "eastus2", name: "vm-prod-01" },
                            { location: "eastus2", name: "vm-prod-02" },
                            { location: "canadacentral", name: "vm-green-01" },
                        ],
                    };
                }
                if (query.includes("Microsoft.Compute/disks")) {
                    return {
                        data: [
                            { location: "eastus2", name: "disk-orphan-01", sizeGB: 128 },
                        ],
                    };
                }
                if (query.includes("Microsoft.Storage/storageAccounts")) {
                    return {
                        data: [
                            { location: "eastus2", name: "staccprod", sku: "Standard_LRS" },
                        ],
                    };
                }
                return { data: [] };
            });

            vi.mocked(ResourceGraphClient).mockImplementation(function (this: any) {
                return {
                    resources: mockResources,
                };
            } as any);

            const result = await AzureSustainabilityService.getSustainabilitySummary(
                "real-tenant-123",
                "sub-456",
                "Enterprise"
            );

            expect(result.vmCount).toBe(3);
            expect(result.zombieCount).toBe(1);
            expect(result.storageCount).toBe(1);
            expect(result.totalCarbonKgCO2e).toBeGreaterThan(0);
            expect(result.avoidedEmissionsKgCO2e).toBeGreaterThan(0);
            expect(result.regions.length).toBeGreaterThan(0);
            expect(result.recommendations.length).toBeGreaterThan(0);
        });

        it("returns legitimate empty state with $0.00 / 0.00kg and ZERO mock fallback when tenant has no resources", async () => {
            vi.spyOn(azureLib, "getAzureCredential").mockResolvedValue({} as any);
            vi.spyOn(azureLib, "getSubscriptionsForTenant").mockResolvedValue(["sub-empty"]);

            const mockResources = vi.fn().mockResolvedValue({ data: [] });

            vi.mocked(ResourceGraphClient).mockImplementation(function (this: any) {
                return {
                    resources: mockResources,
                };
            } as any);

            const result = await AzureSustainabilityService.getSustainabilitySummary(
                "real-empty-tenant",
                "sub-empty",
                "Enterprise"
            );

            expect(result.totalCarbonKgCO2e).toBe(0);
            expect(result.avoidedEmissionsKgCO2e).toBe(0);
            expect(result.potentialReductionKgCO2e).toBe(0);
            expect(result.vmCount).toBe(0);
            expect(result.storageCount).toBe(0);
            expect(result.zombieCount).toBe(0);
            expect(result.regions).toEqual([]);
            expect(result.recommendations).toEqual([]);
        });
    });
});
