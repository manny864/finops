// Grams CO2e per kWh — basado en Microsoft Cloud Carbon (2024 published averages)
// Cubre las regiones más comunes. Default 300 para regiones no listadas.
export const regionCarbonIntensity: Record<string, number> = {
    // Americas
    'eastus': 380,
    'eastus2': 380,
    'westus': 250,
    'westus2': 240,
    'westus3': 220,
    'centralus': 450,
    'southcentralus': 420,
    'northcentralus': 415,
    'canadacentral': 130,
    'canadaeast': 140,
    'brazilsouth': 100,    // Hydro heavy
    'brazilsoutheast': 120,
    // Europe
    'northeurope': 160,
    'westeurope': 210,
    'francecentral': 60,   // Nuclear heavy
    'francesouth': 65,
    'uksouth': 230,
    'ukwest': 240,
    'germanywestcentral': 380,
    'switzerlandnorth': 50,
    'norwayeast': 30,      // Hydro heavy
    'norwaywest': 30,
    'swedencentral': 40,   // Hydro/nuclear
    // Asia / Pacific
    'eastasia': 700,       // HK — coal
    'southeastasia': 480,
    'japaneast': 480,
    'japanwest': 480,
    'koreacentral': 500,
    'koreasouth': 500,
    'australiaeast': 700,
    'australiasoutheast': 710,
    'centralindia': 720,
    'southindia': 700,
    'westindia': 720,
    // Africa / Middle East
    'southafricanorth': 900,
    'uaenorth': 480,
    // Default
    'default': 300,

};

// Power draw promedio (kW) — assumption por VM "standard". Mejora futura: por SKU.
export const STANDARD_VM_POWER_DRAW_KW = 0.15;

// Disco managed standard: ~10W cuando atado y rotando (en reposo 5W).
// Para zombi atado: estimación 50W/h saved when removed.
export const DISK_IDLE_POWER_DRAW_KW = 0.005;

// Storage account redundancy multipliers — más copias = más kWh.
export const STORAGE_REDUNDANCY_MULTIPLIER: Record<string, number> = {
    'LRS': 1,        // 3 copies same DC
    'ZRS': 1.2,      // 3 copies across zones
    'GRS': 2,        // 6 copies, primary+secondary region
    'RA-GRS': 2,
    'GZRS': 2.2,
    'RA-GZRS': 2.2,
};

// kWh por GB-mes almacenado (estimación industria, MS sostenibility 2024).
export const STORAGE_KWH_PER_GB_MONTH = 0.000721;

// Equivalencias (toolkit MS) — para storytelling
export const EQUIVALENCIES = {
    // kg CO2e per km in average gasoline car (EPA)
    KG_CO2_PER_KM_CAR: 0.192,
    // kg CO2 absorbed per mature tree per year
    KG_CO2_PER_TREE_YEAR: 21.77,
    // kg CO2 per smartphone charge
    KG_CO2_PER_PHONE_CHARGE: 0.008,
};

