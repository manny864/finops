export type VaultType = "RecoveryServicesVault" | "BackupVault";
export type RedundancyType = "LocallyRedundant" | "GeoRedundant" | "ZoneRedundant";
export type WorkloadType =
    | "AzureIaasVM"
    | "AzureFileShare"
    | "SQLDataBase"
    | "HANADataBase"
    | "Disk"
    | "VirtualMachine"
    | "KubernetesService"
    | string;

export type ProtectionState =
    | "Protected"
    | "ProtectionStopped"
    | "SoftDeleted"
    | "ProtectionPaused"
    | string;

export type BackupTier = "Snapshot" | "VaultStandard" | "VaultArchive" | string;

export interface ProtectedItemDetail {
    id: string;
    name: string;
    vaultId: string;
    vaultName: string;
    workloadType: WorkloadType;
    sourceResourceId: string | null;
    sourceResourceName: string;
    isSourceResourceDeleted: boolean; // Huérfano
    protectionState: ProtectionState;
    policyName: string;
    retentionDays: number;
    backupTier: BackupTier;
    storageConsumedGB: number;
    monthlyCostUsd: number;
    lastBackupStatus: "Healthy" | "Warning" | "Failed" | "Unknown";
    lastBackupTime: string | null;
    isOrphanCandidate: boolean;
}

export interface BackupStorageBreakdown {
    totalStorageGB: number;
    snapshotTierGB: number;
    vaultStandardGB: number;
    vaultArchiveGB: number;
    orphanedStorageGB: number;
}

export type BackupRemediationCategory =
    | "ORPHAN_PURGE"
    | "ARCHIVE_TIERING"
    | "REDUNDANCY_OPTIMIZATION"
    | "ASR_CLEANUP";

export interface BackupRemediationAction {
    id: string;
    vaultId: string;
    vaultName: string;
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
    category: BackupRemediationCategory;
    estimatedSavingsUSD: number;
    confidence: "high" | "medium" | "low";
    actionType: "manual" | "guided" | "automatic";
    risk: "low" | "medium" | "high";
    commandPayload: {
        azureCli: string;
        powerShell: string;
        jsonRule?: Record<string, unknown>;
    };
}

export interface BackupVaultDetail {
    id: string;
    name: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    location: string;
    vaultType: VaultType;
    skuName: string;
    redundancy: RedundancyType;
    crossRegionRestoreEnabled: boolean;
    softDeleteEnabled: boolean;
    softDeleteRetentionDays: number;
    immutabilityState: "Disabled" | "Unlocked" | "Locked";
    storageBreakdown: BackupStorageBreakdown;
    protectedItemsCount: number;
    orphanedItemsCount: number;
    asrProtectedItemsCount: number;
    monthlyCostUsd: number;
    billedCostUsd: number;
    costPerGb: number;
    environmentTag: "prod" | "dev" | "staging" | "qa" | "unknown";
    tags: Record<string, string>;
    protectedItems: ProtectedItemDetail[];
    recommendations: BackupRemediationAction[];
}

export interface BackupsKpiSummary {
    totalMtdCost: number;
    projectedEndOfMonthCost: number;
    potentialMonthlySavings: number;
    momVariationPercent: number;
    totalVaultsCount: number;
    totalProtectedItemsCount: number;
    orphanedItemsCount: number;
    orphanedStorageCost: number;
    asrInstancesCount: number;
    healthScore: number;
    totalStorageGB: number;
}

export interface BackupsResponse {
    success: boolean;
    mock: boolean;
    kpis: BackupsKpiSummary;
    vaults: BackupVaultDetail[];
    allProtectedItems: ProtectedItemDetail[];
    storageBreakdown: BackupStorageBreakdown;
    remediations: BackupRemediationAction[];
}
