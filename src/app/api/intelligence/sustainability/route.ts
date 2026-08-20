import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { AzureSustainabilityService } from "@/services/azureSustainability.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const subscriptionId = searchParams.get("subscriptionId") || "All";
        const tier = searchParams.get("tier") || "Enterprise";

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        // 1. Check isMockTenant FIRST before any OAuth/Entra token checks
        if (isMockTenant(tenantId)) {
            const summary = AzureSustainabilityService.getMockSustainability(tier);
            return NextResponse.json({
                success: true,
                data: summary,
                // Backward compatibility fields
                footprint: summary.totalCarbonKgCO2e,
                avoided: summary.avoidedEmissionsKgCO2e,
                vmCount: summary.vmCount,
                zombieCount: summary.zombieCount,
                storageCount: summary.storageCount,
                byRegion: summary.regions.map(r => ({
                    region: r.region,
                    kgCO2e: r.monthlyEmissionsKgCO2e,
                    resources: r.resourcesCount,
                    intensity: r.gridIntensityGramsPerKwh,
                })),
                recommendations: summary.recommendations.map(r => ({
                    fromRegion: r.fromRegion,
                    toRegion: r.toRegion,
                    currentIntensity: r.fromIntensity,
                    targetIntensity: r.toIntensity,
                    reductionPct: r.emissionsReductionPercentage,
                    projectedReductionKgCO2: r.co2AvoidedKg,
                    impactedResources: r.resourcesCount,
                })),
                equivalencies: {
                    carKm: summary.carKilometersEquivalent,
                    treesYear: summary.treesEquivalent,
                    phoneCharges: summary.smartphoneChargesEquivalent,
                },
            });
        }

        // 2. Real tenant: require valid token and tenant access
        await requireTenantAccess(request, tenantId);

        // KQL injection guard on subscriptionId
        if (
            subscriptionId.toLowerCase() !== "all" &&
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)
        ) {
            return NextResponse.json({ success: false, error: "subscriptionId inválido" }, { status: 400 });
        }

        const summary = await AzureSustainabilityService.getSustainabilitySummary(tenantId, subscriptionId, tier);

        return NextResponse.json({
            success: true,
            data: summary,
            // Backward compatibility fields
            footprint: summary.totalCarbonKgCO2e,
            avoided: summary.avoidedEmissionsKgCO2e,
            vmCount: summary.vmCount,
            zombieCount: summary.zombieCount,
            storageCount: summary.storageCount,
            byRegion: summary.regions.map(r => ({
                region: r.region,
                kgCO2e: r.monthlyEmissionsKgCO2e,
                resources: r.resourcesCount,
                intensity: r.gridIntensityGramsPerKwh,
            })),
            recommendations: summary.recommendations.map(r => ({
                fromRegion: r.fromRegion,
                toRegion: r.toRegion,
                currentIntensity: r.fromIntensity,
                targetIntensity: r.toIntensity,
                reductionPct: r.emissionsReductionPercentage,
                projectedReductionKgCO2: r.co2AvoidedKg,
                impactedResources: r.resourcesCount,
            })),
            equivalencies: {
                carKm: summary.carKilometersEquivalent,
                treesYear: summary.treesEquivalent,
                phoneCharges: summary.smartphoneChargesEquivalent,
            },
        });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error("Sustainability Fetch Error:", error);
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "Fallo al calcular emisiones.",
            },
            { status: 500 }
        );
    }
}

