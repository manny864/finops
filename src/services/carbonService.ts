import {
    regionCarbonIntensity,
    STANDARD_VM_POWER_DRAW_KW,
    STORAGE_KWH_PER_GB_MONTH,
    STORAGE_REDUNDANCY_MULTIPLIER,
    DISK_IDLE_POWER_DRAW_KW,
    EQUIVALENCIES,
} from "../lib/carbonData";
import Decimal from "decimal.js";

export function regionIntensity(region: string): number {
    const r = (region || "").toLowerCase();
    return regionCarbonIntensity[r] || regionCarbonIntensity["default"];
}

/**
 * Emisiones de un VM. Devuelve kg CO2e usando Decimal.js (precisión).
 */
export function calculateEmissions(vmHourlyUsage: number, region: string): number {
    const intensity = regionIntensity(region);
    const kwh = new Decimal(STANDARD_VM_POWER_DRAW_KW).mul(vmHourlyUsage);
    const grams = kwh.mul(intensity);
    return grams.div(1000).toNumber();
}

/**
 * Emisiones de un disco standby (zombie). vmHourlyUsage = horas estimadas.
 */
export function calculateDiskEmissions(hours: number, region: string): number {
    const intensity = regionIntensity(region);
    const kwh = new Decimal(DISK_IDLE_POWER_DRAW_KW).mul(hours);
    const grams = kwh.mul(intensity);
    return grams.div(1000).toNumber();
}

/**
 * Emisiones de storage (GB-mes × redundancy multiplier × intensity región).
 */
export function calculateStorageEmissions(
    gbStored: number,
    region: string,
    redundancy: string = "LRS",
    months: number = 1
): number {
    const intensity = regionIntensity(region);
    const mult = STORAGE_REDUNDANCY_MULTIPLIER[redundancy.toUpperCase()] || 1;
    const kwh = new Decimal(STORAGE_KWH_PER_GB_MONTH).mul(gbStored).mul(months).mul(mult);
    const grams = kwh.mul(intensity);
    return grams.div(1000).toNumber();
}

/**
 * Convierte kg CO2e a equivalencias humanas para storytelling.
 */
export function emissionsEquivalencies(kgCO2: number) {
    const v = new Decimal(kgCO2);
    return {
        carKm: v.div(EQUIVALENCIES.KG_CO2_PER_KM_CAR).toNumber(),
        treesYear: v.div(EQUIVALENCIES.KG_CO2_PER_TREE_YEAR).toNumber(),
        phoneCharges: v.div(EQUIVALENCIES.KG_CO2_PER_PHONE_CHARGE).toNumber(),
    };
}

/**
 * Recomendación de migración: dado un set de regiones actuales, sugiere
 * la región "verde" más cercana del mismo continente con mayor reducción.
 */
const GREEN_PEERS: Record<string, string> = {
    // US oriente → west/canada
    'eastus': 'canadacentral',
    'eastus2': 'canadacentral',
    'centralus': 'canadacentral',
    'southcentralus': 'westus3',
    'northcentralus': 'canadacentral',
    // EU → norway/sweden/france
    'westeurope': 'norwayeast',
    'germanywestcentral': 'norwayeast',
    'uksouth': 'francecentral',
    'ukwest': 'francecentral',
    // APAC → australia southeast es más limpio que east
    'eastasia': 'southeastasia',
    'koreacentral': 'japaneast',
    // India / África no tienen peer verde regional —no recomendamos

};

export interface MigrationRecommendation {
    fromRegion: string;
    toRegion: string;
    currentIntensity: number;
    targetIntensity: number;
    reductionPct: number;
}

export function suggestGreenMigration(currentRegion: string): MigrationRecommendation | null {
    const r = currentRegion.toLowerCase();
    const target = GREEN_PEERS[r];
    if (!target) return null;
    const cur = regionIntensity(r);
    const tgt = regionIntensity(target);
    if (tgt >= cur) return null;
    return {
        fromRegion: r,
        toRegion: target,
        currentIntensity: cur,
        targetIntensity: tgt,
        reductionPct: ((cur - tgt) / cur) * 100,
    };
}

