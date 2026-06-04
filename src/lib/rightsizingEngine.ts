export function analyzeVmEfficiency(vm: any, metrics: { maxCpu: number, avgCpu: number }) {
    const skuMapping: Record<string, string> = {
        "Standard_D8s_v3": "Standard_D4s_v3",
        "Standard_D4s_v3": "Standard_D2s_v3",
        "Standard_B4ms": "Standard_B2ms",
        "Standard_B2ms": "Standard_B2s",
        "Standard_E8s_v3": "Standard_E4s_v3",
        "Standard_F8s_v2": "Standard_F4s_v2"
    };

    let isUnderutilized = false;
    let recommendedSku = "Sin recomendación clara";

    if (metrics.maxCpu > 0 && metrics.maxCpu < 20) {
        isUnderutilized = true;
        
        if (vm.sku && skuMapping[vm.sku]) {
            recommendedSku = skuMapping[vm.sku];
        } else {
            recommendedSku = "Analizar reducción (1 tier menos)";
        }
    }

    return {
        isUnderutilized,
        recommendedSku,
        maxCpu: metrics.maxCpu,
        avgCpu: metrics.avgCpu
    };
}
