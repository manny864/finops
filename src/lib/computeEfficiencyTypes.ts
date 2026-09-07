/**
 * Tipos del panel de Unit Economics / Rate Optimization de "Eficiencia de
 * Cómputo" (`/intelligence/compute-efficiency`,
 * `GET /api/intelligence/compute-cost-per-core`).
 */

export type VmArchitecture = 'ARM' | 'AMD' | 'Intel';
export type PurchaseType = 'PAYG' | 'Spot' | 'Reserved/SavingsPlan';

export interface UnitEconomicsMetrics {
    /** $/vCore-mes usando cores derivados de MeterName (compatibilidad histórica). */
    costPerCore: number;
    /** $/vCore-mes usando el inventario real de VMs (Resource Graph), más preciso cuando está disponible. */
    costPerCoreInventory: number | null;
    /** $/GiB-RAM-mes: costo total de cómputo dividido entre GiB de RAM aprovisionada. */
    costPerGiB: number | null;
    /** GiB de RAM totales aprovisionados en el inventario de VMs. */
    totalRamGiB: number | null;
    /** % de CPU promedio real (Azure Monitor, ponderado por cores) sobre una muestra de VMs. null si no hay datos/permiso. */
    avgCpuUtilization: number | null;
    /** Costo por vCore que realmente "trabaja": costPerCore / (avgCpuUtilization/100). */
    effectiveCorePriceUtilized: number | null;
}

export interface PurchaseMixSummary {
    totalCores: number;
    paygCores: number;
    spotCores: number;
    /** vCores con Azure Hybrid Benefit activo (licenseType = Windows_Server/Windows_Client). */
    ahubActiveCores: number;
    /** vCores con SO Windows detectado pero SIN AHUB activo (oportunidad). */
    ahubEligibleCores: number;
    /** % de ahorro agregado ya obtenido por RI/Savings Plans (billed vs effective cost). */
    commitmentCoveragePct: number;
    /** true si se pudo leer inventario real vía Resource Graph (Reader). */
    inventoryAvailable: boolean;
}

export interface ArchitectureMixItem {
    architecture: VmArchitecture;
    cores: number;
    cost: number;
    costPerCore: number;
}

export interface GenerationMixItem {
    generation: string;
    cores: number;
    costPerCore: number;
}

export interface SkuEfficiencyDetail {
    sku: string;
    architecture: VmArchitecture;
    generation: string;
    /** Instancias de este SKU en el inventario. */
    instances: number;
    /** vCPU de UNA instancia del SKU, no del agregado. */
    cores: number;
    /** RAM en GiB de UNA instancia del SKU, no del agregado. */
    ramGiB: number | null;
    purchaseType: PurchaseType;
    ahubActive: boolean;
    cost: number;
    costPerCore: number;
    costPerGiB: number | null;
    suggestedAction: string | null;
}

export interface RegionEfficiencyDetail {
    region: string;
    cores: number;
    costPerCore: number;
    /** % más caro (positivo) o más barato (negativo) vs. la región más económica del set. */
    deltaVsCheapestPct: number;
}

export interface SubscriptionEfficiencyDetail {
    subscriptionId: string;
    subscriptionName: string;
    cores: number;
    totalCost: number;
    costPerCore: number;
    /** % de cobertura de compromisos (RI/SP) en esta suscripción. */
    commitmentCoveragePct: number;
}

export type RateOptimizationActionType = 'savings_plan' | 'arm_migration' | 'ahub' | 'region_arbitrage';

export interface RateOptimizationAction {
    id: string;
    type: RateOptimizationActionType;
    title: string;
    description: string;
    /** true cuando el ahorro es una estimación basada en benchmarks públicos, no en una cotización real. */
    estimated: boolean;
    potentialSavingsPct: number;
    potentialMonthlySavings: number;
    ctaLabel: string;
    ctaHref: string;
}

export interface ComputeEfficiencySummary {
    success: boolean;
    mock: boolean;
    error?: string;

    // Backward-compat (dashboard legado consumía estos campos planos):
    totalCores: number;
    totalCost: number;
    effectiveCost: number;
    costPerCore: number;
    costPerCoreNoCommitments: number;
    savingsFromCommitments: number;
    byRegion: { region: string; cores: number; costPerCore: number }[];
    bySku: { sku: string; cores: number; cost: number; costPerCore: number }[];
    trend: { month: string; costPerCore: number }[];
    benchmark: number;

    // Nuevo: Unit Economics + Rate Optimization
    unitEconomics: UnitEconomicsMetrics;
    purchaseMix: PurchaseMixSummary;
    architectureMix: ArchitectureMixItem[];
    generationMix: GenerationMixItem[];
    skuDetail: SkuEfficiencyDetail[];
    regionDetail: RegionEfficiencyDetail[];
    subscriptionDetail: SubscriptionEfficiencyDetail[];
    rateOptimizationActions: RateOptimizationAction[];
}
