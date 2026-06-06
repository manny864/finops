export function analyzeVmEfficiency(vm: any, metrics: { maxCpu: number, p95Cpu: number, avgCpu: number, p95Mem: number }) {
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

    let status = "Optimized";
    // Idle threshold: P95 CPU < 10%
    if (metrics.p95Cpu > 0 && metrics.p95Cpu < 10) {
        isUnderutilized = true;
        status = "Idle";
        recommendedSku = "Apagar/Deallocate";
    } 
    // Oversized threshold: P95 CPU < 40%
    else if (metrics.p95Cpu > 0 && metrics.p95Cpu < 40) {
        isUnderutilized = true;
        status = "Oversized";
        if (vm.sku && skuMapping[vm.sku]) {
            recommendedSku = skuMapping[vm.sku];
        } else {
            recommendedSku = "Analizar reducción (1 tier menos)";
        }
    }

    return {
        isUnderutilized,
        status,
        recommendedSku,
        maxCpu: metrics.maxCpu,
        p95Cpu: metrics.p95Cpu,
        avgCpu: metrics.avgCpu
    };
}
