export type DiskState = "Attached" | "Unattached" | "Reserved";
export type DiskType = "OSDisk" | "DataDisk";
export type DiskSkuTier = "Premium_LRS" | "PremiumV2_LRS" | "StandardSSD_LRS" | "Standard_LRS" | "UltraSSD_LRS" | string;
export type DiskRedundancy = "LRS" | "ZRS";

export interface DiskPerformanceMetrics {
    avgIops: number;
    peakIops: number;
    avgThroughputMbps: number;
    peakThroughputMbps: number;
    readOpsCount: number;
    writeOpsCount: number;
    isInactive: boolean;
    telemetryPeriodDays: number;
    lastTelemetryDate: string | null;
}

export type DiskRemediationCategory =
    | "ORPHAN"
    | "TIER_DOWNGRADE"
    | "DEALLOCATED_VM_OPTIMIZATION"
    | "BURST_OPTIMIZATION"
    | "RIGHTSIZING";

export interface DiskRemediationAction {
    id: string;
    diskId: string;
    diskName: string;
    title: string;
    description: string;
    category: DiskRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "high" | "medium" | "low";
    actionType: "manual" | "guided" | "automatic";
    impact: string;
    risk: "low" | "medium" | "high";
    commandPayload: {
        azureCli: string;
        powerShell: string;
        jsonRule?: Record<string, unknown>;
    };
}

export interface ManagedDiskDetail {
    id: string;
    name: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    location: string;
    skuName: DiskSkuTier;
    skuTier: "Standard" | "Premium" | "Ultra" | string;
    tierName: string; // e.g. "P10", "E10", "S10", "P4"
    diskSizeGB: number;
    diskSizeBytes: number;
    diskState: DiskState;
    diskType: DiskType;
    redundancyType: DiskRedundancy;
    managedByVmName: string | null;
    managedByVmId: string | null;
    vmPowerState?: "running" | "deallocated" | "stopped" | "unknown";
    osType: "Linux" | "Windows" | null;
    encryptionType: string;
    burstingEnabled: boolean;
    monthlyCostUsd: number;
    billedCostUsd: number;
    costPerGb: number;
    environmentTag: "prod" | "dev" | "staging" | "qa" | "unknown";
    tags: Record<string, string>;
    metrics: DiskPerformanceMetrics;
    recommendations: DiskRemediationAction[];
    isZombieCandidate: boolean;
}

export interface ManagedDisksKpiSummary {
    totalMtdCost: number;
    projectedEndOfMonthCost: number;
    potentialMonthlySavings: number;
    momVariationPercent: number;
    totalDisksCount: number;
    orphanDisksCount: number;
    orphanDisksCost: number;
    underutilizedDisksCount: number;
    underutilizedDisksCost: number;
    healthScore: number;
    totalProvisionedGB: number;
    avgCostPerGb: number;
}

export interface DiskSkuDistributionItem {
    skuName: string;
    count: number;
    totalSizeGB: number;
    monthlyCost: number;
    color: string;
}

export interface ManagedDisksResponse {
    success: boolean;
    mock: boolean;
    kpis: ManagedDisksKpiSummary;
    disks: ManagedDiskDetail[];
    skuDistribution: DiskSkuDistributionItem[];
    remediations: DiskRemediationAction[];
    diagnostics?: Record<string, unknown>;
}
