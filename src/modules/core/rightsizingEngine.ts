// Tamaños canónicos por familia/generación (ordenados de menor a mayor).
// Solo proponemos downgrade dentro de la MISMA familia + features + generación
// para evitar el error: "changing from resource disk to non-resource disk VM
// size and vice-versa is not allowed" (ver https://aka.ms/AAah4sj).
const SAME_FAMILY_DOWNGRADE_SIZES = [2, 4, 8, 16, 32, 48, 64, 96];

/**
 * Devuelve un SKU del mismo familia/generación pero con menor número de vCPUs.
 * Si no encuentra uno seguro, devuelve el SKU original (sin sugerir cambio).
 *
 * Reglas:
 *  - Mantiene prefijo (Standard_), familia (D/E/F/B/A...), features (s, d, a, m...),
 *    sufijo de generación (v2/v3/v4/v5) y promo (_Promo).
 *  - Solo cambia el número (size).
 *
 * Ejemplos:
 *   Standard_D8s_v3   -> Standard_D4s_v3
 *   Standard_D2s_v3   -> Standard_D2s_v3 (ya en mínimo seguro: no se sugiere)
 *   Standard_E16ds_v5 -> Standard_E8ds_v5
 *   Standard_B4ms     -> Standard_B2ms
 *   Standard_DC8as_v5 -> Standard_DC4as_v5
 */
function getDowngradeSku(currentSku: string): string {
    if (!currentSku) return "";

    // Captura: prefix Standard_, familia (letras), número, features (letras opcionales),
    // sufijo opcional (_v3, _v4, _v5, _Promo, etc.)
    // Ej: Standard_D8s_v3 → prefix="Standard_", family="D", size="8", features="s", suffix="_v3"
    //     Standard_DC4as_v5 → family="DC", size="4", features="as", suffix="_v5"
    //     Standard_B2ms → family="B", size="2", features="ms", suffix=""
    const re = /^(Standard_)([A-Za-z]+?)(\d+)([a-z]*)(_v\d+)?(_Promo)?$/i;
    const m = currentSku.match(re);
    if (!m) return currentSku; // Formato no reconocido: no proponer cambio.

    const [, prefix, family, sizeStr, features, version, promo] = m;
    const currentSize = parseInt(sizeStr, 10);
    if (!Number.isFinite(currentSize)) return currentSku;

    // Buscar el tamaño inmediatamente inferior dentro de la lista canónica.
    const smaller = SAME_FAMILY_DOWNGRADE_SIZES
        .filter(s => s < currentSize)
        .pop();
    if (!smaller) return currentSku; // Ya está en el mínimo: no sugerir.

    return `${prefix}${family}${smaller}${features}${version ?? ''}${promo ?? ''}`;
}

export function analyzeVmEfficiency(vm: any, metrics: { maxCpu: number, p95Cpu: number, avgCpu: number, p95Mem: number }) {
    let isUnderutilized = false;
    let recommendedSku = vm.sku || "";
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
