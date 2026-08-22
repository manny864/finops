/**
 * Tipos TypeScript para el Motor de Detección y Ciclo de Vida de Backups Huérfanos
 * Azure Recovery Services Vaults, Backup Vaults, Storage Consumed, Archive Tiering y Compliance.
 */

export type OrphanBackupType = 'AzureIaasVM' | 'AzureWorkload' | 'AzureStorage' | 'AzureDisk';

export interface OrphanBackupItem {
  id: string;
  name: string;
  workloadType: OrphanBackupType;
  vaultName: string;
  vaultId: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  originalResourceId: string;
  storageConsumedGB: number;
  recoveryPointsCount: number;
  lastBackupTimestamp?: string;
  formattedLastBackup?: string;
  isSoftDeleted: boolean;
  monthlyCostUSD: number;
  isExempted: boolean;
  exemptionReason?: string;
  complianceYears?: number;
  exemptedBy?: string;
  exemptedAt?: string;
}

export interface OrphanBackupsSummary {
  totalMonthlyWasteUSD: number;
  orphanItemsCount: number;
  totalStorageConsumedGB: number;
  exemptedItemsCount: number;
  backups: OrphanBackupItem[];
}

export interface OrphanBackupRemediationPayload {
  protectedItemId: string;
  actionType: 'DELETE_AND_PURGE' | 'MOVE_TO_ARCHIVE' | 'EXEMPT_COMPLIANCE';
  reason?: string;
  complianceYears?: number;
  ticketNumber?: string;
}

export interface TableColumnConfig {
  key: string;
  label: string;
  isVisible: boolean;
  widthPx: number;
}
