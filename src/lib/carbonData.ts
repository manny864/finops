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

    // ── Regiones AWS ─────────────────────────────────────────────────────────
    // Los nombres de region de AWS (us-east-1) no colisionan con los de Azure
    // (eastus), asi que conviven en el mismo mapa sin ambiguedad.
    //
    // Fuente: intensidad de la red electrica de la geografia donde vive cada
    // region, la misma base que las filas de Azure. AWS publica su propio
    // Customer Carbon Footprint Tool, pero solo con **datos ya facturados y con
    // hasta 3 meses de retraso**, y sin API publica: no sirve para estimar el
    // impacto de una decision que se toma hoy. Estas cifras son estimaciones
    // para comparar regiones entre si, no un reporte auditable de emisiones.
    'us-east-1': 380,        // Virginia
    'us-east-2': 450,        // Ohio
    'us-west-1': 250,        // California del Norte
    'us-west-2': 240,        // Oregon — hidroelectrica
    'ca-central-1': 130,     // Canada — hidro
    'ca-west-1': 140,
    'sa-east-1': 100,        // Sao Paulo — hidro
    'eu-west-1': 160,        // Irlanda — eolica
    'eu-west-2': 230,        // Londres
    'eu-west-3': 60,         // Paris — nuclear
    'eu-central-1': 380,     // Frankfurt
    'eu-central-2': 50,      // Zurich
    'eu-north-1': 40,        // Estocolmo — hidro/nuclear
    'eu-south-1': 330,       // Milan
    'eu-south-2': 200,       // Espana
    'ap-northeast-1': 480,   // Tokio
    'ap-northeast-2': 500,   // Seul
    'ap-northeast-3': 480,   // Osaka
    'ap-southeast-1': 480,   // Singapur
    'ap-southeast-2': 700,   // Sidney — carbon
    'ap-southeast-3': 650,   // Yakarta
    'ap-southeast-4': 710,   // Melbourne
    'ap-south-1': 720,       // Mumbai — carbon
    'ap-south-2': 700,       // Hyderabad
    'ap-east-1': 700,        // Hong Kong — carbon
    'me-south-1': 480,       // Bahrein
    'me-central-1': 480,     // EAU
    'af-south-1': 900,       // Ciudad del Cabo — carbon
    'il-central-1': 450,     // Tel Aviv
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

