import { regionCarbonIntensity, STANDARD_VM_POWER_DRAW_KW } from '../lib/carbonData';

export function calculateEmissions(vmHourlyUsage: number, region: string): number {
    const intensity = regionCarbonIntensity[region.toLowerCase()] || regionCarbonIntensity['default'];
    // kWh = Power (kW) * Hours
    const kwh = STANDARD_VM_POWER_DRAW_KW * vmHourlyUsage;
    // Emisions (grams) = kWh * intensity (g/kWh)
    const emissionsGrams = kwh * intensity;
    
    // Return kg CO2e
    return emissionsGrams / 1000;
}
