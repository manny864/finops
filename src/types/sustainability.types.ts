/**
 * Types strictly defined for Green FinOps (Sustainability & Cloud Carbon Footprint).
 */

export interface RegionEmissionsItem {
    region: string;
    resourcesCount: number;
    gridIntensityGramsPerKwh: number;
    monthlyEmissionsKgCO2e: number;
}

export interface GreenMigrationRecommendation {
    fromRegion: string;
    fromIntensity: number;
    toRegion: string;
    toIntensity: number;
    emissionsReductionPercentage: number;
    co2AvoidedKg: number;
    resourcesCount: number;
    sampleResources?: string[];
}

export interface SustainabilitySummary {
    totalCarbonKgCO2e: number;
    avoidedEmissionsKgCO2e: number;
    potentialReductionKgCO2e: number;
    carKilometersEquivalent: number;
    treesEquivalent: number;
    smartphoneChargesEquivalent: number;
    vmCount: number;
    storageCount: number;
    zombieCount: number;
    regions: RegionEmissionsItem[];
    recommendations: GreenMigrationRecommendation[];
}

export interface SustainabilityApiResponse {
    success: boolean;
    degraded?: boolean;
    error?: string;
    data?: SustainabilitySummary;
    // Backward compatibility fields for any legacy consumer
    footprint?: number;
    avoided?: number;
    vmCount?: number;
    zombieCount?: number;
    storageCount?: number;
    byRegion?: Array<{ region: string; kgCO2e: number; resources: number; intensity: number }>;
    recommendations?: Array<{
        fromRegion: string;
        toRegion: string;
        currentIntensity: number;
        targetIntensity: number;
        reductionPct: number;
        projectedReductionKgCO2: number;
        impactedResources: number;
    }>;
    equivalencies?: { carKm: number; treesYear: number; phoneCharges: number };
}
