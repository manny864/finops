// Tamaños canónicos por familia/generación (ordenados de menor a mayor).
// Solo proponemos cambios dentro de la MISMA familia + features + generación
// para evitar el error: "changing from resource disk to non-resource disk VM
// size and vice-versa is not allowed" (ver https://aka.ms/AAah4sj).
const SAME_FAMILY_SIZES = [2, 4, 8, 16, 32, 48, 64, 96];

/** Qué hacer con la VM. `NONE` = ya está bien dimensionada. */
export type RightsizingAction = "DOWNGRADE" | "UPGRADE" | "NONE";

/**
 * Umbrales de CPU. Los de bajada estaban hardcodeados en el if; los de subida
 * son nuevos.
 *
 * `UPGRADE_SUSTAINED_P95` (80%): la VM vive saturada, no es un pico. Es el
 * mismo corte que usa Azure Advisor para marcar una VM como under-provisioned.
 *
 * `UPGRADE_PEAK_MAX` + `UPGRADE_PEAK_FLOOR`: un maxCpu alto SOLO no alcanza.
 * Una VM que toca 100% dos minutos por día y vive al 5% es exactamente el
 * caso de uso de la serie B (burstable), y sugerir un SKU más grande ahí sube
 * la factura sin resolver nada. Se exige que el piso sostenido ya esté alto
 * (p95 >= 60) para leer los picos como saturación real y no como ráfaga.
 */
const DOWNGRADE_IDLE_P95 = 10;
const DOWNGRADE_OVERSIZED_P95 = 40;
const UPGRADE_SUSTAINED_P95 = 80;
const UPGRADE_PEAK_MAX = 95;
const UPGRADE_PEAK_FLOOR = 60;

/**
 * Descompone un SKU de Azure en sus partes para poder cambiarle solo el número.
 *
 * Ej: Standard_D8s_v3   → prefix="Standard_", family="D",  size=8, features="s",  suffix="_v3"
 *     Standard_DC4as_v5 → family="DC", size=4, features="as", suffix="_v5"
 *     Standard_B2ms     → family="B",  size=2, features="ms", suffix=""
 */
function parseSku(currentSku: string) {
    const m = (currentSku || "").match(/^(Standard_)([A-Za-z]+?)(\d+)([a-z]*)(_v\d+)?(_Promo)?$/i);
    if (!m) return null;
    const size = parseInt(m[3], 10);
    if (!Number.isFinite(size)) return null;
    return { prefix: m[1], family: m[2], size, features: m[4], version: m[5] ?? "", promo: m[6] ?? "" };
}

function rebuildSku(p: NonNullable<ReturnType<typeof parseSku>>, size: number): string {
    return `${p.prefix}${p.family}${size}${p.features}${p.version}${p.promo}`;
}

/**
 * SKU de la misma familia/generación con MENOS vCPUs.
 * Devuelve el SKU original si el formato no se reconoce o ya está en el mínimo.
 */
function getDowngradeSku(currentSku: string): string {
    if (!currentSku) return "";
    const p = parseSku(currentSku);
    if (!p) return currentSku; // Formato no reconocido: no proponer cambio.
    const smaller = SAME_FAMILY_SIZES.filter((s) => s < p.size).pop();
    if (!smaller) return currentSku; // Ya está en el mínimo.
    return rebuildSku(p, smaller);
}

/**
 * SKU de la misma familia/generación con MÁS vCPUs. Espejo del downgrade:
 * quedarse en la familia evita el cambio resource-disk / non-resource-disk y
 * mantiene comparables las features (s = premium storage, etc.).
 */
function getUpgradeSku(currentSku: string): string {
    if (!currentSku) return "";
    const p = parseSku(currentSku);
    if (!p) return currentSku;
    const bigger = SAME_FAMILY_SIZES.find((s) => s > p.size);
    if (!bigger) return currentSku; // Ya está en el tope de la familia.
    return rebuildSku(p, bigger);
}

export function analyzeVmEfficiency(
    vm: any,
    metrics: { maxCpu: number; p95Cpu: number; avgCpu: number; p95Mem: number }
) {
    let action: RightsizingAction = "NONE";
    let recommendedSku = vm.sku || "";
    let status = "Optimized";

    // Sin telemetría (p95 en 0) no se concluye nada en ninguna dirección: una
    // VM sin métricas no es una VM ociosa.
    const hasTelemetry = metrics.p95Cpu > 0;

    if (hasTelemetry && metrics.p95Cpu < DOWNGRADE_IDLE_P95) {
        action = "DOWNGRADE";
        status = "Idle";
        recommendedSku = getDowngradeSku(vm.sku);
    } else if (hasTelemetry && metrics.p95Cpu < DOWNGRADE_OVERSIZED_P95) {
        action = "DOWNGRADE";
        status = "Oversized";
        recommendedSku = getDowngradeSku(vm.sku);
    } else if (hasTelemetry && metrics.p95Cpu >= UPGRADE_SUSTAINED_P95) {
        action = "UPGRADE";
        status = "Saturated";
        recommendedSku = getUpgradeSku(vm.sku);
    } else if (
        hasTelemetry &&
        metrics.maxCpu >= UPGRADE_PEAK_MAX &&
        metrics.p95Cpu >= UPGRADE_PEAK_FLOOR
    ) {
        action = "UPGRADE";
        status = "Peaking";
        recommendedSku = getUpgradeSku(vm.sku);
    }

    // Si no hay SKU destino distinto (mínimo o tope de la familia), no hay
    // recomendación que aplicar.
    if (recommendedSku.toLowerCase() === (vm.sku || "").toLowerCase()) {
        action = "NONE";
        status = "Optimized";
    }

    return {
        action,
        /** Se mantiene por compatibilidad: es cierto solo para las bajadas. */
        isUnderutilized: action === "DOWNGRADE",
        status,
        recommendedSku,
        maxCpu: metrics.maxCpu,
        p95Cpu: metrics.p95Cpu,
        avgCpu: metrics.avgCpu,
    };
}
