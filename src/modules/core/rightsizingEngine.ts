function getDowngradeSku(currentSku: string): string {
    if (!currentSku) return "Standard_B2s";
    
    // Normalizar a una clave estándar si existe
    const skuMapping: Record<string, string> = {
        "standard_d16s_v3": "Standard_D8s_v3",
        "standard_d8s_v3": "Standard_D4s_v3",
        "standard_d4s_v3": "Standard_D2s_v3",
        "standard_d2s_v3": "Standard_B2s",
        "standard_d4ds_v4": "Standard_D2ds_v4",
        "standard_d2ds_v4": "Standard_B2s",
        "standard_b4ms": "Standard_B2ms",
        "standard_b2ms": "Standard_B2s",
        "standard_e8s_v3": "Standard_E4s_v3",
        "standard_f8s_v2": "Standard_F4s_v2"
    };
    
    const key = currentSku.toLowerCase();
    if (skuMapping[key]) {
        return skuMapping[key];
    }
    
    // Buscar un número en el SKU para reducirlo a la mitad
    const match = currentSku.match(/(\d+)/);
    if (match) {
        const num = parseInt(match[1], 10);
        if (num > 2) {
            const halved = Math.floor(num / 2);
            return currentSku.replace(String(num), String(halved));
        }
    }
    
    return "Standard_B2s"; // Fallback mínimo seguro
}

export function analyzeVmEfficiency(vm: any, metrics: { maxCpu: number, p95Cpu: number, avgCpu: number, p95Mem: number }) {
    let isUnderutilized = false;
    let recommendedSku = vm.sku || "Standard_B2s";
    let status = "Optimized";

    // Idle threshold: P95 CPU < 10%
    if (metrics.p95Cpu > 0 && metrics.p95Cpu < 10) {
        isUnderutilized = true;
        status = "Idle";
        recommendedSku = getDowngradeSku(vm.sku);
    } 
    // Oversized threshold: P95 CPU < 40%
    else if (metrics.p95Cpu > 0 && metrics.p95Cpu < 40) {
        isUnderutilized = true;
        status = "Oversized";
        recommendedSku = getDowngradeSku(vm.sku);
    }

    // Si ya estamos en el mínimo o el SKU recomendado coincide con el actual, evitar marcarlo como subutilizado
    if (recommendedSku.toLowerCase() === (vm.sku || "").toLowerCase()) {
        isUnderutilized = false;
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
