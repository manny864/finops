// Coordenadas aproximadas (lat/lng del datacenter/región) para las regiones
// de Azure más comunes. No hay API de geocoding — Azure no expone lat/lng por
// región públicamente en Resource Graph/ARM, así que se mantiene un mapa
// estático local (sin llamadas externas).
export const AZURE_REGION_COORDS: Record<string, { lat: number; lng: number; label: string }> = {
    eastus: { lat: 37.3719, lng: -79.8164, label: "East US" },
    eastus2: { lat: 36.6681, lng: -78.3889, label: "East US 2" },
    centralus: { lat: 41.5908, lng: -93.6208, label: "Central US" },
    northcentralus: { lat: 41.8819, lng: -87.6278, label: "North Central US" },
    southcentralus: { lat: 29.4167, lng: -98.5, label: "South Central US" },
    westus: { lat: 37.783, lng: -122.417, label: "West US" },
    westus2: { lat: 47.233, lng: -119.852, label: "West US 2" },
    westus3: { lat: 33.448, lng: -112.074, label: "West US 3" },
    canadacentral: { lat: 43.653, lng: -79.383, label: "Canada Central" },
    canadaeast: { lat: 46.817, lng: -71.217, label: "Canada East" },
    brazilsouth: { lat: -23.5505, lng: -46.6333, label: "Brazil South" },
    brazilsoutheast: { lat: -22.9068, lng: -43.1729, label: "Brazil Southeast" },
    northeurope: { lat: 53.3478, lng: -6.2597, label: "North Europe" },
    westeurope: { lat: 52.3667, lng: 4.9, label: "West Europe" },
    uksouth: { lat: 50.941, lng: -0.799, label: "UK South" },
    ukwest: { lat: 53.427, lng: -3.084, label: "UK West" },
    francecentral: { lat: 46.3772, lng: 2.373, label: "France Central" },
    germanywestcentral: { lat: 50.110, lng: 8.682, label: "Germany West Central" },
    switzerlandnorth: { lat: 47.451, lng: 8.564, label: "Switzerland North" },
    norwayeast: { lat: 59.913, lng: 10.752, label: "Norway East" },
    swedencentral: { lat: 60.674, lng: 17.142, label: "Sweden Central" },
    polandcentral: { lat: 52.2297, lng: 21.0122, label: "Poland Central" },
    italynorth: { lat: 45.4642, lng: 9.19, label: "Italy North" },
    spaincentral: { lat: 40.4168, lng: -3.7038, label: "Spain Central" },
    southeastasia: { lat: 1.283, lng: 103.833, label: "Southeast Asia" },
    eastasia: { lat: 22.267, lng: 114.188, label: "East Asia" },
    japaneast: { lat: 35.68, lng: 139.77, label: "Japan East" },
    japanwest: { lat: 34.6939, lng: 135.5022, label: "Japan West" },
    koreacentral: { lat: 37.5665, lng: 126.978, label: "Korea Central" },
    australiaeast: { lat: -33.86, lng: 151.2094, label: "Australia East" },
    australiasoutheast: { lat: -37.8136, lng: 144.9631, label: "Australia Southeast" },
    centralindia: { lat: 18.5204, lng: 73.8567, label: "Central India" },
    southindia: { lat: 13.0827, lng: 80.2707, label: "South India" },
    westindia: { lat: 19.088, lng: 72.868, label: "West India" },
    uaenorth: { lat: 25.2048, lng: 55.2708, label: "UAE North" },
    southafricanorth: { lat: -25.7313, lng: 28.2184, label: "South Africa North" },
    qatarcentral: { lat: 25.2854, lng: 51.531, label: "Qatar Central" },
    israelcentral: { lat: 32.0853, lng: 34.7818, label: "Israel Central" },
};

export function getRegionCoords(region: string | null | undefined) {
    if (!region) return null;
    const key = region.toLowerCase().replace(/\s+/g, "");
    return AZURE_REGION_COORDS[key] || null;
}
