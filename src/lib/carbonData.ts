export const regionCarbonIntensity: Record<string, number> = {
    'eastus': 380,
    'westus': 250,
    'northeurope': 160,
    'westeurope': 210,
    'centralus': 450,
    'southcentralus': 420,
    'brazilsouth': 100, // Hydro heavy
    'francecentral': 60, // Nuclear heavy
    'default': 300
};

export const STANDARD_VM_POWER_DRAW_KW = 0.15; // Assume an average VM draws 150 Watts (0.15 kW)
