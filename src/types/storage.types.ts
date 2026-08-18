export type BlobRedundancy = "Standard_LRS" | "Standard_ZRS" | "Standard_GRS" | "Standard_RAGRS" | "Standard_GZRS" | "Standard_RAGZRS" | "Premium_LRS" | "Premium_ZRS" | string;
export type BlobAccessTier = "Hot" | "Cool" | "Cold" | "Archive" | "Premium" | string;
export type StorageKind = "StorageV2" | "BlobStorage" | "BlockBlobStorage" | "FileStorage" | "Storage" | string;

export interface StorageCapacityBreakdown {
    totalUsedBytes: number;
    blobBytes: number;
    fileBytes: number;
    queueBytes: number;
    tableBytes: number;
    hotTierBytes: number;
    coolTierBytes: number;
    coldTierBytes: number;
    archiveTierBytes: number;
}

export interface StorageMetrics {
    transactionsCount: number;
    egressBytes: number;
    ingressBytes: number;
    avgDailyCost: number;
    apiOperationsCost?: number;
    capacityCost?: number;
    redundancyCost?: number;
}

export interface StorageAccountDetail {
    id: string;
    name: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName?: string;
    location: string;
    tier: BlobAccessTier;
    skuName: BlobRedundancy;
    skuTier: "Standard" | "Premium" | string;
    kind: StorageKind;
    redundancyType: "LRS" | "ZRS" | "GRS" | "RA-GRS" | "GZRS" | "RA-GZRS" | string;
    isHnsEnabled: boolean; // Hierarchical Namespace (ADLS Gen2)
    publicAccessAllowed: boolean;
    minimumTlsVersion: "TLS1_0" | "TLS1_1" | "TLS1_2" | string;
    supportsHttpsTrafficOnly: boolean;
    hasLifecyclePolicy: boolean;
    lifecycleRulesCount?: number;
    deleteRetentionEnabled: boolean;
    deleteRetentionDays: number;
    isVersioningEnabled: boolean;
    activeServices: Array<"blob" | "file" | "queue" | "table" | "adls_gen2">;
    environmentTag?: "prod" | "dev" | "staging" | "test" | "qa" | string;
    tags?: Record<string, string>;
    usedGb: number | null;
    monthlyCost: number;
    billedCost?: number;
    retailRatePerGb?: number;
    costSource?: string;
    capacitySource?: "azure-monitor" | "billed-attribution" | "unavailable";
    capacityUpdatedAt?: string | null;
    metrics?: StorageMetrics;
    isZombieCandidate?: boolean;
}

export type StorageRemediationActionType =
    | "LIFECYCLE_POLICY_CREATE"
    | "REDUNDANCY_OPTIMIZE_LRS"
    | "ZOMBIE_ACCOUNT_PURGE"
    | "SOFT_DELETE_RETENTION_ADJUST"
    | "SECURITY_HARDENING_PUBLIC_ACCESS"
    | "TIER_TRANSITION_COOL";

export interface StorageRemediationAction {
    id: string;
    title: string;
    description: string;
    impactDescription?: string;
    category: "Cost" | "Governance" | "Security" | "Performance";
    actionType: StorageRemediationActionType;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    confidence: "HIGH" | "MEDIUM" | "LOW";
    estimatedSavingsUSD: number;
    estimatedSavingsPct?: number;
    targetAccountId?: string;
    targetAccountName?: string;
    targetResourceGroup?: string;
    jsonPayload?: string;
    cliCommand?: string;
    powershellCommand?: string;
    implementationSteps?: string[];
}

export interface StorageTierDistribution {
    hot: { percent: number; gb: number; cost: number };
    cool: { percent: number; gb: number; cost: number };
    cold: { percent: number; gb: number; cost: number };
    archive: { percent: number; gb: number; cost: number };
}

export interface StorageComposition {
    blob: { gb: number; cost: number };
    files: { gb: number; cost: number };
    queue: { gb: number; cost: number };
    table: { gb: number; cost: number };
}

export interface StorageEfficiencyResponse {
    success: boolean;
    mock?: boolean;
    empty?: boolean;
    message?: string;
    tiers: StorageTierDistribution;
    totalGb: number;
    totalCost: number;
    costPerGb: number;
    projectedEndOfMonthCost?: number;
    benchmarkLrsCostPerGb?: number;
    accountsCount?: number;
    redundancyCounts?: {
        lrs: number;
        zrs: number;
        grs: number;
        other: number;
    };
    recommendation?: {
        movableGb: number;
        potentialSavings: number;
        fromTier: string;
        toTier: string;
    };
    remediations?: StorageRemediationAction[];
    storageComposition: StorageComposition;
    accounts: StorageAccountDetail[];
    diagnostics?: Record<string, unknown>;
}
