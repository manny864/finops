export type DataLakeAccessTier = "Hot" | "Cool" | "Cold";
export type DataLakeRedundancy = "LRS" | "ZRS" | "GRS" | "GZRS";

export interface DataLakeStorageBreakdown {
    totalStorageBytes: number;
    totalStorageGB: number;
    totalStorageTB: number;
    hotTierBytes: number;
    coolTierBytes: number;
    coldTierBytes: number;
    archiveTierBytes: number;
    hotTierGB: number;
    coolTierGB: number;
    coldTierGB: number;
    archiveTierGB: number;
}

export interface DataLakeMetrics {
    transactionsCount: number;
    readOpsCount: number;
    writeOpsCount: number;
    listOpsCount: number;
    egressBytes: number;
    ingressBytes: number;
    storageCostUSD: number;
    transactionsCostUSD: number;
    transactionCostRatio: number;
    hasSmallFilesAnomaly: boolean;
}

export type DataLakeRemediationCategory =
    | "LIFECYCLE_TIERING"
    | "REDUNDANCY_OPTIMIZATION"
    | "STORAGE_RESERVATION"
    | "TRANSACTION_OPTIMIZATION";

export interface DataLakeRemediationAction {
    id: string;
    accountId: string;
    accountName: string;
    /**
     * Claves i18n. Va la clave y no la frase armada porque el payload se cachea
     * del lado del cliente (SWR) con una clave que no incluye el locale: con el
     * texto armado en el servidor, cambiar de idioma dejaba las recomendaciones
     * en el idioma anterior hasta la revalidacion.
     */
    titleKey: string;
    descKey: string;
    impactKey: string;
    /** Valores a interpolar. Numeros y nombres de recurso, nunca frases. */
    params?: Record<string, string | number>;
    category: DataLakeRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "high" | "medium" | "low";
    actionType: "manual" | "guided" | "automatic";
    risk: "low" | "medium" | "high";
    commandPayload: {
        azureCli: string;
        powerShell: string;
        jsonPolicy?: Record<string, unknown>;
    };
}

export interface DataLakeAccountDetail {
    id: string;
    name: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    location: string;
    skuName: string;
    skuTier: string;
    kind: string;
    isHnsEnabled: boolean;
    accessTier: DataLakeAccessTier;
    redundancyType: DataLakeRedundancy;
    hasLifecyclePolicy: boolean;
    lifecycleRulesCount: number;
    privateEndpointsCount: number;
    publicAccessBlocked: boolean;
    storageBreakdown: DataLakeStorageBreakdown;
    metrics: DataLakeMetrics;
    monthlyCostUsd: number;
    billedCostUsd: number;
    costPerTb: number;
    environmentTag: "prod" | "dev" | "staging" | "qa" | "unknown";
    tags: Record<string, string>;
    recommendations: DataLakeRemediationAction[];
}

export interface DataLakeKpiSummary {
    totalMtdCost: number;
    projectedEndOfMonthCost: number;
    potentialMonthlySavings: number;
    momVariationPercent: number;
    totalAccountsCount: number;
    costPerTbManaged: number;
    coldCandidatesTotalGB: number;
    healthScore: number;
    totalStorageTB: number;
    totalStorageGB: number;
}

export interface DataLakeResponse {
    success: boolean;
    mock: boolean;
    kpis: DataLakeKpiSummary;
    accounts: DataLakeAccountDetail[];
    storageBreakdown: DataLakeStorageBreakdown;
    remediations: DataLakeRemediationAction[];
}
