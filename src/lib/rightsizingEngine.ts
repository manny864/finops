export function evaluateRightsizing(maxCpu: number, currentSku: string) {
    if (maxCpu === 0) {
        return null;
    }

    if (maxCpu < 20) {
        return getDowngradeSku(currentSku);
    }
    
    return null;
}

function getDowngradeSku(currentSku: string) {
    const skuMap: Record<string, string> = {
        "Standard_D4s_v3": "Standard_D2s_v3",
        "Standard_D8s_v3": "Standard_D4s_v3",
        "Standard_D4_v4": "Standard_D2_v4",
        "Standard_E4s_v3": "Standard_E2s_v3",
        "Standard_B4ms": "Standard_B2ms",
        "Standard_B8ms": "Standard_B4ms"
    };
    
    return skuMap[currentSku] || "Revisar familia de SKU (posible downgrade a la mitad de vCPUs)";
}
