/**
 * Servicio Azure FinOps: Motor de Detección, Gestión de Almacenamiento y Compliance de Backups Huérfanos
 * Detección de protectedItems en Recovery Services Vaults sin recurso origen en ARM,
 * cálculo de almacenamiento devengado, tarifas de bóveda y exenciones por compliance legal.
 */

import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  OrphanBackupItem,
  OrphanBackupsSummary,
  OrphanBackupType,
} from "@/types/azureOrphanBackups.types";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import { withArgLimit } from "@/lib/argConcurrency";

const INSTANCE_FEE_BY_TYPE: Record<OrphanBackupType, number> = {
  AzureIaasVM: 10.0,
  AzureWorkload: 8.0,
  AzureStorage: 5.0,
  AzureDisk: 5.0,
};

const STORAGE_VAULT_RATE_PER_GB = 0.0224; // Azure Standard LRS Vault rate

export function calculateBackupMonthlyCost(
  workloadType: OrphanBackupType,
  storageConsumedGB: number
): number {
  const instanceFee = INSTANCE_FEE_BY_TYPE[workloadType] || 6.0;
  const storageFee = (storageConsumedGB || 0) * STORAGE_VAULT_RATE_PER_GB;
  return Number((instanceFee + storageFee).toFixed(2));
}

export function computeOrphanBackupsMetrics(
  backups: OrphanBackupItem[]
): OrphanBackupsSummary {
  const activeBackups = backups.filter((b) => !b.isExempted);
  const exemptedBackups = backups.filter((b) => b.isExempted);

  const totalMonthlyWasteUSD = Number(
    activeBackups.reduce((sum, b) => sum + (b.monthlyCostUSD || 0), 0).toFixed(2)
  );

  const totalStorageConsumedGB = Number(
    activeBackups.reduce((sum, b) => sum + (b.storageConsumedGB || 0), 0).toFixed(1)
  );

  return {
    totalMonthlyWasteUSD,
    orphanItemsCount: activeBackups.length,
    totalStorageConsumedGB,
    exemptedItemsCount: exemptedBackups.length,
    backups,
  };
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockOrphanBackupsSummary(tenantId: string): OrphanBackupsSummary {
  const isEnterprise = tenantId.includes("4444") || tenantId.includes("enterprise");
  const now = new Date();

  const dMinus20 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const dMinus45 = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const dMinus90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const dMinus120 = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();

  const backups: OrphanBackupItem[] = [
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-backups-prod/providers/Microsoft.RecoveryServices/vaults/rsv-core-prod/backupFabrics/Azure/protectionContainers/IaasVMContainer;iaasvmcontainerv2;rg-legacy-apps;vm-legacy-crm-01/protectedItems/VM;iaasvmcontainerv2;rg-legacy-apps;vm-legacy-crm-01",
      name: "vm-legacy-crm-01",
      workloadType: "AzureIaasVM",
      vaultName: "rsv-core-prod",
      vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-backups-prod/providers/Microsoft.RecoveryServices/vaults/rsv-core-prod",
      location: "eastus2",
      resourceGroup: "rg-backups-prod",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      originalResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-legacy-apps/providers/Microsoft.Compute/virtualMachines/vm-legacy-crm-01",
      storageConsumedGB: 280.5,
      recoveryPointsCount: 28,
      lastBackupTimestamp: dMinus45,
      isSoftDeleted: false,
      monthlyCostUSD: calculateBackupMonthlyCost("AzureIaasVM", 280.5),
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-backups-prod/providers/Microsoft.RecoveryServices/vaults/rsv-core-prod/backupFabrics/Azure/protectionContainers/StorageContainer;storage;rg-data-archive;stgarchivedata2024/protectedItems/AzureFileShare;share-reports-2024",
      name: "share-reports-2024",
      workloadType: "AzureStorage",
      vaultName: "rsv-core-prod",
      vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-backups-prod/providers/Microsoft.RecoveryServices/vaults/rsv-core-prod",
      location: "eastus2",
      resourceGroup: "rg-backups-prod",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      originalResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-data-archive/providers/Microsoft.Storage/storageAccounts/stgarchivedata2024",
      storageConsumedGB: 520.0,
      recoveryPointsCount: 14,
      lastBackupTimestamp: dMinus90,
      isSoftDeleted: false,
      monthlyCostUSD: calculateBackupMonthlyCost("AzureStorage", 520.0),
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-dr/providers/Microsoft.RecoveryServices/vaults/rsv-analytics-dr/backupFabrics/Azure/protectionContainers/vmsql;sqldb-bi-temp;sqlinstance-bi/protectedItems/SQLDataBase;sqldb-bi-temp;model",
      name: "sqldb-bi-temp",
      workloadType: "AzureWorkload",
      vaultName: "rsv-analytics-dr",
      vaultId: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-dr/providers/Microsoft.RecoveryServices/vaults/rsv-analytics-dr",
      location: "westeurope",
      resourceGroup: "rg-analytics-dr",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      originalResourceId: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-bi/providers/Microsoft.Sql/servers/sqlinstance-bi/databases/sqldb-bi-temp",
      storageConsumedGB: 110.0,
      recoveryPointsCount: 42,
      lastBackupTimestamp: dMinus20,
      isSoftDeleted: false,
      monthlyCostUSD: calculateBackupMonthlyCost("AzureWorkload", 110.0),
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-backups-prod/providers/Microsoft.RecoveryServices/vaults/rsv-core-prod/backupFabrics/Azure/protectionContainers/IaasVMContainer;iaasvmcontainerv2;rg-finance-old;vm-fin-audit-2023/protectedItems/VM;iaasvmcontainerv2;rg-finance-old;vm-fin-audit-2023",
      name: "vm-fin-audit-2023",
      workloadType: "AzureIaasVM",
      vaultName: "rsv-core-prod",
      vaultId: "/subscriptions/demo-sub-01/resourceGroups/rg-backups-prod/providers/Microsoft.RecoveryServices/vaults/rsv-core-prod",
      location: "eastus2",
      resourceGroup: "rg-backups-prod",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      originalResourceId: "/subscriptions/demo-sub-01/resourceGroups/rg-finance-old/providers/Microsoft.Compute/virtualMachines/vm-fin-audit-2023",
      storageConsumedGB: 450.0,
      recoveryPointsCount: 60,
      lastBackupTimestamp: dMinus120,
      isSoftDeleted: false,
      monthlyCostUSD: calculateBackupMonthlyCost("AzureIaasVM", 450.0),
      isExempted: true,
      exemptionReason: "Retención requerida por auditoría impositiva SOX / Ley fiscal (Ticket SEC-9912)",
      complianceYears: 5,
      exemptedBy: "ciso@cscloudsolutions.com",
      exemptedAt: "2026-01-15",
    },
  ];

  if (isEnterprise) {
    backups.push({
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-dr/providers/Microsoft.RecoveryServices/vaults/rsv-analytics-dr/backupFabrics/Azure/protectionContainers/IaasVMContainer;iaasvmcontainerv2;rg-lakehouse-poc;vm-spark-master-poc/protectedItems/VM;iaasvmcontainerv2;rg-lakehouse-poc;vm-spark-master-poc",
      name: "vm-spark-master-poc",
      workloadType: "AzureIaasVM",
      vaultName: "rsv-analytics-dr",
      vaultId: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-dr/providers/Microsoft.RecoveryServices/vaults/rsv-analytics-dr",
      location: "westeurope",
      resourceGroup: "rg-analytics-dr",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      originalResourceId: "/subscriptions/demo-sub-02/resourceGroups/rg-lakehouse-poc/providers/Microsoft.Compute/virtualMachines/vm-spark-master-poc",
      storageConsumedGB: 195.0,
      recoveryPointsCount: 15,
      lastBackupTimestamp: dMinus45,
      isSoftDeleted: false,
      monthlyCostUSD: calculateBackupMonthlyCost("AzureIaasVM", 195.0),
      isExempted: false,
    });
  }

  return computeOrphanBackupsMetrics(backups);
}

/**
 * Escanea y ensambla datos de backups huérfanos en vivo desde Azure Resource Graph y Recovery Services API.
 */
export async function scanLiveOrphanBackups(tenantId: string): Promise<OrphanBackupsSummary> {
  const credential = await getAzureCredential(tenantId);
  const argClient = await getResourceGraphClient(tenantId);

  // 1. Obtener mapas de suscripciones
  const subNameMap = await getSubscriptionNameMap(tenantId, credential);

  // 2. Inventariar todos los Recovery Services Vaults y todos los Resource IDs del tenant
  const [vaultsRes, allResRes, exemptionsRows] = await Promise.all([
    withArgLimit(() =>
      argClient.resources({
        query: `Resources | where type =~ 'microsoft.recoveryservices/vaults' | project name, resourceGroup, subscriptionId, location, id`,
      })
    ).catch(() => ({ data: [] })),
    withArgLimit(() =>
      argClient.resources({
        query: `Resources | project id`,
      })
    ).catch(() => ({ data: [] })),
    pool
      .query(
        `SELECT resource_id AS resourceId, reason, created_by AS createdBy, created_at AS createdAt
         FROM RecommendationExemptions
         WHERE tenant_id = ? AND recommendation_type IN ('orphan_backup', 'backup', 'zombies')`,
        [tenantId]
      )
      .catch(() => [[]]),
  ]);

  const vaults = (vaultsRes.data as any[]) || [];
  const existingResourceIds = new Set(
    ((allResRes.data as any[]) || []).map((r) => String(r.id).toLowerCase())
  );

  const exemptionsMap = new Map<string, { reason: string; createdBy?: string; createdAt?: string }>();
  for (const row of (exemptionsRows as any)?.[0] || []) {
    if (row.resourceId) {
      exemptionsMap.set(String(row.resourceId).toLowerCase(), {
        reason: row.reason || "Eximido por compliance",
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      });
    }
  }

  const foundBackups: OrphanBackupItem[] = [];

  // 3. Consultar protectedItems para cada Vault
  const ARM_BASE = "https://management.azure.com";
  let token = "";
  try {
    const tokenData = await credential.getToken(`${ARM_BASE}/.default`);
    token = tokenData?.token || "";
  } catch (e) {
    console.warn("[Orphan Backups] Error obtaining ARM token:", errorMessage(e));
  }

  if (token && vaults.length > 0) {
    for (const vault of vaults) {
      try {
        const url = `${ARM_BASE}/subscriptions/${vault.subscriptionId}/resourceGroups/${vault.resourceGroup}/providers/Microsoft.RecoveryServices/vaults/${vault.name}/backupProtectedItems?api-version=2023-04-01`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const json = await res.json();
          const items = json.value || [];
          for (const item of items) {
            const props = item.properties || {};
            const sourceResourceId = String(props.sourceResourceId || "").toLowerCase();

            // Si sourceResourceId existe y no está en existingResourceIds, o está desasociado
            const isOrphan =
              Boolean(sourceResourceId) &&
              !existingResourceIds.has(sourceResourceId) &&
              !sourceResourceId.includes("microsoft.recoveryservices");

            if (isOrphan || props.protectionState === "ProtectionStopped") {
              const workloadType: OrphanBackupType =
                props.workloadType === "AzureIaasVM" || props.workloadType === "VM"
                  ? "AzureIaasVM"
                  : props.workloadType === "SQLDataBase" || props.workloadType === "AzureWorkload"
                  ? "AzureWorkload"
                  : props.workloadType === "AzureFileShare" || props.workloadType === "AzureStorage"
                  ? "AzureStorage"
                  : "AzureDisk";

              const rawBytes = Number(props.storageConsumedInBytes || 0);
              const storageConsumedGB = rawBytes > 0 ? Number((rawBytes / (1024 * 1024 * 1024)).toFixed(1)) : 120.0;
              const recoveryPointsCount = Number(props.recoveryPointsCount || 14);

              const subId = vault.subscriptionId || "default-sub";
              const resolvedSubName = resolveSubscriptionName(subId, subNameMap);
              const lowerItemId = String(item.id).toLowerCase();
              const exemption = exemptionsMap.get(lowerItemId);

              const monthlyCostUSD = calculateBackupMonthlyCost(workloadType, storageConsumedGB);

              foundBackups.push({
                id: item.id,
                name: item.name || item.id.split("/").pop() || "protected-item",
                workloadType,
                vaultName: vault.name,
                vaultId: vault.id,
                location: vault.location || "eastus",
                resourceGroup: vault.resourceGroup,
                subscriptionId: subId,
                subscriptionName: resolvedSubName,
                originalResourceId: props.sourceResourceId || "recurso-eliminado",
                storageConsumedGB,
                recoveryPointsCount,
                lastBackupTimestamp: props.lastRecoveryPoint || props.lastBackupTime,
                isSoftDeleted: Boolean(props.isScheduledForDeferredDelete),
                monthlyCostUSD,
                isExempted: Boolean(exemption),
                exemptionReason: exemption?.reason,
                exemptedBy: exemption?.createdBy,
                exemptedAt: exemption?.createdAt,
              });
            }
          }
        }
      } catch (vaultErr) {
        console.warn(`[Orphan Backups] Error scanning vault ${vault.name}:`, errorMessage(vaultErr));
      }
    }
  }

  return computeOrphanBackupsMetrics(foundBackups);
}
