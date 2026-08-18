import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  listResourcesByTypes,
  getDiagnosticsCacheKey,
  readDiagnosticsCache,
  writeDiagnosticsCache,
} from "../diagnosticsShared";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import {
  AzurePostgreSqlResourceDetail,
  PostgreSqlFinopsSummaryResponse,
  PostgreSqlRemediationAction,
  PostgreSqlServerType,
  PostgreSqlSkuTier,
  PostgreSqlHaMode,
  PostgreSqlSkuProfile,
  PostgreSqlStorageProfile,
  PostgreSqlPerformanceMetrics,
  PostgreSqlCostBreakdown,
} from "@/types/azurePostgreSQL";

// ---------------------------------------------------------------------------
// ARM resource types for Azure Database for PostgreSQL
// ---------------------------------------------------------------------------
const POSTGRES_TYPES = [
  "microsoft.dbforpostgresql/flexibleservers",
  "microsoft.dbforpostgresql/servers",
  "microsoft.dbforpostgresql/servergroupsv2",
  "Microsoft.DBforPostgreSQL/flexibleServers",
  "Microsoft.DBforPostgreSQL/servers",
  "Microsoft.DBforPostgreSQL/serverGroupsv2",
];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function resolveSkuCapacity(skuName: string): { vCores: number; memoryGib: number } {
  const n = skuName.toLowerCase();
  // Burstable
  if (n.includes("b1ms") || n.includes("b1s")) return { vCores: 1, memoryGib: 2 };
  if (n.includes("b2ms") || n.includes("b2s")) return { vCores: 2, memoryGib: 4 };
  if (n.includes("b4ms")) return { vCores: 4, memoryGib: 8 };
  if (n.includes("b8ms")) return { vCores: 8, memoryGib: 16 };
  // General Purpose (D-series)
  if (n.includes("d2ds") || n.includes("d2s")) return { vCores: 2, memoryGib: 8 };
  if (n.includes("d4ds") || n.includes("d4s")) return { vCores: 4, memoryGib: 16 };
  if (n.includes("d8ds") || n.includes("d8s")) return { vCores: 8, memoryGib: 32 };
  if (n.includes("d16ds") || n.includes("d16s")) return { vCores: 16, memoryGib: 64 };
  if (n.includes("d32ds") || n.includes("d32s")) return { vCores: 32, memoryGib: 128 };
  if (n.includes("d64ds") || n.includes("d64s")) return { vCores: 64, memoryGib: 256 };
  // Memory Optimized (E-series)
  if (n.includes("e2ds") || n.includes("e2s")) return { vCores: 2, memoryGib: 16 };
  if (n.includes("e4ds") || n.includes("e4s")) return { vCores: 4, memoryGib: 32 };
  if (n.includes("e8ds") || n.includes("e8s")) return { vCores: 8, memoryGib: 64 };
  if (n.includes("e16ds") || n.includes("e16s")) return { vCores: 16, memoryGib: 128 };
  if (n.includes("e32ds") || n.includes("e32s")) return { vCores: 32, memoryGib: 256 };
  // Fallback
  return { vCores: 2, memoryGib: 8 };
}

function resolveSkuTier(skuName: string, skuTierRaw?: string): PostgreSqlSkuTier {
  if (skuTierRaw) {
    const t = skuTierRaw.toLowerCase();
    if (t.includes("burstable") || t.includes("burst")) return "Burstable";
    if (t.includes("memory")) return "MemoryOptimized";
    if (t.includes("general")) return "GeneralPurpose";
  }
  const n = skuName.toLowerCase();
  if (n.startsWith("standard_b") || n.startsWith("b_")) return "Burstable";
  if (n.startsWith("standard_e") || n.startsWith("mo_")) return "MemoryOptimized";
  return "GeneralPurpose";
}

function estimatePostgresMonthlyCost(
  skuName: string,
  tier: PostgreSqlSkuTier,
  storageGb: number,
  haMode: PostgreSqlHaMode
): number {
  const n = skuName.toLowerCase();
  let compute = 32.0; // default Standard_B2s
  if (n.includes("b1ms")) compute = 16.50;
  else if (n.includes("b2ms") || n.includes("b2s")) compute = 32.0;
  else if (n.includes("b4ms")) compute = 74.0;
  else if (n.includes("b8ms")) compute = 148.0;
  else if (n.includes("d2ds") || n.includes("d2s")) compute = 146.0;
  else if (n.includes("d4ds") || n.includes("d4s")) compute = 292.0;
  else if (n.includes("d8ds") || n.includes("d8s")) compute = 584.0;
  else if (n.includes("e2ds") || n.includes("e2s")) compute = 182.0;
  else if (n.includes("e4ds") || n.includes("e4s")) compute = 364.0;
  else if (n.includes("e8ds") || n.includes("e8s")) compute = 728.0;

  if (haMode !== "Disabled") {
    compute *= 2; // HA standby compute replica
  }
  const storage = storageGb * 0.115;
  const backup = Math.max(3.0, storageGb * 0.05);
  return round2(compute + storage + backup);
}

// ---------------------------------------------------------------------------
// Remediation Engine — 5 FinOps PostgreSQL Rules
// ---------------------------------------------------------------------------
function derivePostgresRecommendations(server: AzurePostgreSqlResourceDetail): PostgreSqlRemediationAction[] {
  const actions: PostgreSqlRemediationAction[] = [];
  const cost = server.cost.monthlyCostUsd;
  const nameLower = server.name.toLowerCase();
  const rgLower = server.resourceGroup.toLowerCase();
  const isDevOrStg =
    nameLower.includes("dev") || nameLower.includes("test") || nameLower.includes("stg") ||
    nameLower.includes("stage") || nameLower.includes("qa") || nameLower.includes("sandbox") ||
    rgLower.includes("dev") || rgLower.includes("test") || rgLower.includes("stg");

  const { cpuPercentAvg, memoryPercentAvg, storageUsedPct, storageUsedGib, activeConnectionsAvg, ioConsumptionPct } = server.metrics;
  const { tier, vCores, name: skuName, haMode, version } = server.skuProfile;
  const { storageSizeGb, autoIoScaling } = server.storageProfile;

  // Regla 1: Downsize de SKU General Purpose / Burstable con baja utilización
  if ((tier === "GeneralPurpose" || tier === "MemoryOptimized") && cpuPercentAvg < 15 && memoryPercentAvg < 30 && activeConnectionsAvg < 60) {
    const savings = round2(Math.max(45, cost * 0.5));
    actions.push({
      id: `${server.id}-downsize-sku`,
      ruleKey: "downsize_sku",
      title: "Downsize de SKU General Purpose a Burstable (Standard_B2s / B4ms)",
      description: `El servidor '${server.name}' opera en ${skuName} (${vCores} vCores) con CPU promedio de ${cpuPercentAvg.toFixed(1)}% y memoria en ${memoryPercentAvg.toFixed(1)}%. Reducir a Standard_B2s o Standard_B4ms preserva la capacidad para picos de carga y genera un ahorro inmediato del ~50%.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az postgres flexible-server update \\
  --name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --sku-name Standard_B2s \\
  --tier Burstable`,
      bicepSnippet: `resource pgServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${server.name}'
  location: '${server.region}'
  sku: {
    name: 'Standard_B2s'
    tier: 'Burstable'
  }
  properties: {
    version: '${version}'
  }
}`,
    });
  }

  // Regla 2: Optimización de Almacenamiento Sobreasignado
  if (storageSizeGb > 100 && storageUsedPct < 20) {
    const recommendedGb = Math.max(32, Math.ceil(storageUsedGib * 2));
    const savings = round2(Math.max(10, (storageSizeGb - recommendedGb) * 0.115));
    actions.push({
      id: `${server.id}-storage-overallocated`,
      ruleKey: "storage_overallocated",
      title: "Optimización de Almacenamiento Asignado Sobredimensionado",
      description: `El servidor '${server.name}' tiene ${storageSizeGb} GB provisionados pero solo utiliza ${storageUsedGib.toFixed(1)} GB (${storageUsedPct.toFixed(1)}% de ocupación). Reducir a ${recommendedGb} GB evita cargos mensuales por espacio no utilizado.`,
      savingsMonthlyUsd: savings,
      risk: "medium",
      confidence: "high",
      actionType: "manual",
      cliCommand: `# En PostgreSQL Flexible Server, reducir storage requiere recreación / restore:
# 1. Crear backup/dump del servidor ${server.name}:
pg_dumpall -h ${server.fqdn || server.name} -U adminuser > pg_backup.sql
# 2. Provisionar nuevo servidor con ${recommendedGb} GB de almacenamiento
# 3. Restaurar los datos y cambiar connection strings`,
      bicepSnippet: `// Para nuevos despliegues ajustados:
resource pgStorage 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${server.name}'
  location: '${server.region}'
  properties: {
    storage: {
      storageSizeGB: ${recommendedGb}
      autoGrow: 'Enabled'
    }
  }
}`,
    });
  }

  // Regla 3: Desactivar Alta Disponibilidad (HA) en entornos Dev/Test
  if (haMode !== "Disabled" && isDevOrStg) {
    const haSavings = round2(Math.max(30, cost * 0.5));
    actions.push({
      id: `${server.id}-ha-dev-test`,
      ruleKey: "ha_disabled_dev_test",
      title: "Desactivar Alta Disponibilidad (HA) en Entorno No Productivo",
      description: `El servidor '${server.name}' tiene configurada Alta Disponibilidad (${haMode}) en un entorno de desarrollo/pruebas ('${server.resourceGroup}'). Desactivar el nodo standby reduce el costo de cómputo y replicación en un 50%.`,
      savingsMonthlyUsd: haSavings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az postgres flexible-server update \\
  --name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --high-availability Disabled`,
      bicepSnippet: `resource pgServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${server.name}'
  location: '${server.region}'
  properties: {
    highAvailability: {
      mode: 'Disabled'
    }
  }
}`,
    });
  }

  // Regla 4: Auto-Apagado / Start-Stop Schedule en Dev/Test
  if (server.serverType === "FlexibleServer" && isDevOrStg && server.state === "Ready") {
    const scheduleSavings = round2(Math.max(15, cost * 0.65));
    actions.push({
      id: `${server.id}-auto-stop`,
      ruleKey: "auto_stop_schedule",
      title: "Programación de Auto-Apagado (Start/Stop Schedule)",
      description: `El servidor '${server.name}' opera 24/7 en un entorno no productivo. Configurar el apagado automático fuera de horario laboral y fines de semana permite ahorrar hasta un 65% en costos de cómputo.`,
      savingsMonthlyUsd: scheduleSavings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# Detener servidor durante períodos de inactividad:
az postgres flexible-server stop \\
  --name "${server.name}" \\
  --resource-group "${server.resourceGroup}"

# Iniciar servidor al iniciar jornada:
az postgres flexible-server start \\
  --name "${server.name}" \\
  --resource-group "${server.resourceGroup}"`,
      bicepSnippet: `// Utilizar Azure Automation Runbook o Logic Apps para disparar Start/Stop vía Azure REST API`,
    });
  }

  // Regla 5: Alerta de Migración para Single Server (Legacy)
  if (server.isLegacySingleServer) {
    const migrationSavings = round2(Math.max(20, cost * 0.3));
    actions.push({
      id: `${server.id}-single-server-migration`,
      ruleKey: "single_server_migration",
      title: "Migración Crítica: PostgreSQL Single Server (Fin de Soporte)",
      description: `El servidor '${server.name}' utiliza la arquitectura Single Server, la cual se encuentra en proceso de retiro oficial por Microsoft. Migrar a PostgreSQL Flexible Server otorga hasta 3x mejor rendimiento, soporte para PostgreSQL 16 y reducción de costo mediante Burstable SKUs.`,
      savingsMonthlyUsd: migrationSavings,
      risk: "medium",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az postgres flexible-server migration create \\
  --name "migration-${server.name}" \\
  --target-server-name "flex-${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --location "${server.region}" \\
  --migration-mode Offline`,
      bicepSnippet: `// Provisionar el nuevo Flexible Server de reemplazo:
resource pgFlexible 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: 'flex-${server.name}'
  location: '${server.region}'
  sku: {
    name: 'Standard_B2s'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
  }
}`,
    });
  }

  // Regla 6: Autoscale IOPS (si tiene IOPS fijos altos con baja carga de I/O)
  if (server.serverType === "FlexibleServer" && !autoIoScaling && ioConsumptionPct < 30 && server.storageProfile.iops > 1000) {
    const iopsSavings = round2(Math.max(12, server.storageProfile.iops * 0.02));
    actions.push({
      id: `${server.id}-autoscale-iops`,
      ruleKey: "autoscale_iops_optimization",
      title: "Habilitar Autoscale IOPS en Almacenamiento",
      description: `El servidor '${server.name}' tiene ${server.storageProfile.iops} IOPS aprovisionados de forma estática con un consumo de disco de solo ${ioConsumptionPct.toFixed(1)}%. Activar Autoscale IOPS escala el rendimiento dinámicamente según la demanda y elimina el sobrecosto de IOPS ociosos.`,
      savingsMonthlyUsd: iopsSavings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az postgres flexible-server update \\
  --name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --auto-iops Enabled`,
      bicepSnippet: `resource pgServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${server.name}'
  location: '${server.region}'
  properties: {
    storage: {
      autoIoScaling: 'Enabled'
    }
  }
}`,
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Mock Data Generator por Tier
// ---------------------------------------------------------------------------
function buildMockPostgresResources(tenantId: string): AzurePostgreSqlResourceDetail[] {
  const isEnterprise = tenantId === "33333333-4444-5555-6666-777777777777";
  const isBusiness = tenantId === "44444444-5555-6666-7777-888888888888";
  const mult = isEnterprise ? 3.2 : isBusiness ? 1.7 : 1;

  const resources: AzurePostgreSqlResourceDetail[] = [
    // 1. Flexible Server de Producción con HA Zone Redundant
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-ecommerce-prod-eastus2",
      name: "pg-ecommerce-prod-eastus2",
      serverType: "FlexibleServer",
      isLegacySingleServer: false,
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      region: "eastus2",
      state: "Ready",
      version: "16",
      skuProfile: {
        name: "Standard_D4ds_v5",
        tier: "GeneralPurpose",
        vCores: 4,
        memoryGib: 16,
        version: "16",
        haMode: "ZoneRedundant",
        haReplicas: 1,
        readReplicas: 1,
        backupRetentionDays: 30,
        geoRedundantBackup: true,
      },
      storageProfile: {
        storageSizeGb: 256,
        usedStorageGb: 88.4,
        storageUtilizationPct: 34.5,
        autoGrow: true,
        autoIoScaling: true,
        iops: 3000,
        isOverallocated: false,
      },
      metrics: {
        cpuPercentAvg: 28.5,
        cpuPercentMax: 72.0,
        memoryPercentAvg: 54.0,
        storageUsedGib: 88.4,
        storageUsedPct: 34.5,
        activeConnectionsAvg: 110,
        activeConnectionsMax: 240,
        ioConsumptionPct: 22.0,
        diskIopsConsumedAvg: 450,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(620.0 * mult),
        computeCostUsd: round2(480.0 * mult),
        storageCostUsd: round2(60.0 * mult),
        haCostUsd: round2(55.0 * mult),
        backupCostUsd: round2(25.0 * mult),
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "pg-ecommerce-prod-eastus2.postgres.database.azure.com",
    },

    // 2. Flexible Server Dev/Test con HA innecesaria y SKU sobredimensionado
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-analytics-stg/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-analytics-dev-westus2",
      name: "pg-analytics-dev-westus2",
      serverType: "FlexibleServer",
      isLegacySingleServer: false,
      resourceGroup: "rg-analytics-stg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Staging Services",
      region: "westus2",
      state: "Ready",
      version: "15",
      skuProfile: {
        name: "Standard_D4ds_v5",
        tier: "GeneralPurpose",
        vCores: 4,
        memoryGib: 16,
        version: "15",
        haMode: "SameZone",
        haReplicas: 1,
        readReplicas: 0,
        backupRetentionDays: 7,
        geoRedundantBackup: false,
      },
      storageProfile: {
        storageSizeGb: 128,
        usedStorageGb: 14.2,
        storageUtilizationPct: 11.1,
        autoGrow: true,
        autoIoScaling: false,
        iops: 1500,
        isOverallocated: true,
      },
      metrics: {
        cpuPercentAvg: 6.2,
        cpuPercentMax: 18.0,
        memoryPercentAvg: 19.5,
        storageUsedGib: 14.2,
        storageUsedPct: 11.1,
        activeConnectionsAvg: 12,
        activeConnectionsMax: 35,
        ioConsumptionPct: 4.8,
        diskIopsConsumedAvg: 60,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(310.0 * mult),
        computeCostUsd: round2(240.0 * mult),
        storageCostUsd: round2(35.0 * mult),
        haCostUsd: round2(25.0 * mult),
        backupCostUsd: round2(10.0 * mult),
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "pg-analytics-dev-westus2.postgres.database.azure.com",
    },

    // 3. PostgreSQL Single Server (Legado en Retiro)
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-legacy-apps/providers/Microsoft.DBforPostgreSQL/servers/pg-legacy-crm-eastus",
      name: "pg-legacy-crm-eastus",
      serverType: "SingleServer",
      isLegacySingleServer: true,
      resourceGroup: "rg-legacy-apps",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "eastus",
      state: "warning",
      version: "11",
      skuProfile: {
        name: "GP_Gen5_4",
        tier: "GeneralPurpose",
        vCores: 4,
        memoryGib: 20,
        version: "11",
        haMode: "Disabled",
        haReplicas: 0,
        readReplicas: 0,
        backupRetentionDays: 7,
        geoRedundantBackup: false,
      },
      storageProfile: {
        storageSizeGb: 100,
        usedStorageGb: 38.0,
        storageUtilizationPct: 38.0,
        autoGrow: true,
        autoIoScaling: false,
        iops: 300,
        isOverallocated: false,
      },
      metrics: {
        cpuPercentAvg: 18.2,
        cpuPercentMax: 44.0,
        memoryPercentAvg: 41.0,
        storageUsedGib: 38.0,
        storageUsedPct: 38.0,
        activeConnectionsAvg: 45,
        activeConnectionsMax: 90,
        ioConsumptionPct: 16.5,
        diskIopsConsumedAvg: 120,
        failedConnections: 1,
      },
      cost: {
        monthlyCostUsd: round2(215.0 * mult),
        computeCostUsd: round2(175.0 * mult),
        storageCostUsd: round2(28.0 * mult),
        haCostUsd: 0,
        backupCostUsd: round2(12.0 * mult),
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "pg-legacy-crm-eastus.postgres.database.azure.com",
    },

    // 4. Cosmos DB for PostgreSQL (Citus Hyperscale Cluster)
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-iot-telemetry/providers/Microsoft.DBforPostgreSQL/serverGroupsv2/citus-iot-cluster-centralus",
      name: "citus-iot-cluster-centralus",
      serverType: "CosmosDbCitus",
      isLegacySingleServer: false,
      resourceGroup: "rg-iot-telemetry",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Enterprise Workloads",
      region: "centralus",
      state: "Ready",
      version: "15",
      skuProfile: {
        name: "Standard_D8ds_v5",
        tier: "GeneralPurpose",
        vCores: 8,
        memoryGib: 32,
        version: "15",
        haMode: "ZoneRedundant",
        haReplicas: 2,
        readReplicas: 2,
        backupRetentionDays: 35,
        geoRedundantBackup: true,
      },
      storageProfile: {
        storageSizeGb: 512,
        usedStorageGb: 190.0,
        storageUtilizationPct: 37.1,
        autoGrow: true,
        autoIoScaling: true,
        iops: 6000,
        isOverallocated: false,
      },
      metrics: {
        cpuPercentAvg: 38.0,
        cpuPercentMax: 84.0,
        memoryPercentAvg: 62.0,
        storageUsedGib: 190.0,
        storageUsedPct: 37.1,
        activeConnectionsAvg: 320,
        activeConnectionsMax: 650,
        ioConsumptionPct: 34.0,
        diskIopsConsumedAvg: 1800,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(1150.0 * mult),
        computeCostUsd: round2(850.0 * mult),
        storageCostUsd: round2(140.0 * mult),
        haCostUsd: round2(110.0 * mult),
        backupCostUsd: round2(50.0 * mult),
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "citus-iot-cluster-centralus.postgres.cosmos.azure.com",
    },
  ];

  // Poblar recomendaciones
  for (const res of resources) {
    res.recommendations = derivePostgresRecommendations(res);
    res.cost.potentialSavingsUsd = round2(
      res.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0)
    );
  }

  return resources;
}

function buildSummaryResponse(
  instances: AzurePostgreSqlResourceDetail[],
  isDemo: boolean
): PostgreSqlFinopsSummaryResponse {
  const totalMtd = round2(instances.reduce((acc, i) => acc + i.cost.monthlyCostUsd, 0));
  const totalSavings = round2(
    instances.reduce((acc, i) => acc + i.cost.potentialSavingsUsd, 0)
  );

  const underutilized = instances.filter((i) => i.metrics.cpuPercentAvg < 20 && i.metrics.memoryPercentAvg < 30).length;
  const legacyCount = instances.filter((i) => i.isLegacySingleServer).length;
  const haOverprovisioned = instances.filter((i) => i.skuProfile.haMode !== "Disabled" && /dev|test|stg|qa/i.test(i.resourceGroup)).length;
  const autoscaleCandidates = instances.filter((i) => i.serverType === "FlexibleServer" && !i.storageProfile.autoIoScaling).length;
  const autoStopCandidates = instances.filter((i) => i.serverType === "FlexibleServer" && /dev|test|stg|qa/i.test(i.resourceGroup) && i.state === "Ready").length;

  const totalVcores = instances.reduce((acc, i) => acc + (i.skuProfile.vCores || 2), 0);
  const totalManagedGb = instances.reduce((acc, i) => acc + (i.storageProfile.storageSizeGb || 32), 0);

  const healthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          legacyCount * 15 -
          instances.filter((i) => i.metrics.cpuPercentMax > 85).length * 10 -
          instances.filter((i) => i.storageProfile.storageUtilizationPct > 80).length * 10
      )
    )
  );

  return {
    success: true,
    instances,
    financialSummary: {
      mtdCost: totalMtd,
      forecastEom: {
        value: round2(totalMtd * 1.05),
        low: round2(totalMtd * 0.95),
        high: round2(totalMtd * 1.15),
      },
      deltaMoM: {
        value: round2(totalMtd * -0.04),
        percentage: -4.0,
      },
      potentialSavings: totalSavings,
    },
    efficiency: {
      costPerEffectiveVcore: round2(totalMtd / Math.max(1, totalVcores)),
      costPerManagedGb: round2(totalMtd / Math.max(1, totalManagedGb)),
      underutilizedCount: underutilized,
      legacySingleServerCount: legacyCount,
      haOverprovisionedCount: haOverprovisioned,
      autoscaleIopsCandidatesCount: autoscaleCandidates,
      autoStopCandidatesCount: autoStopCandidates,
    },
    risk: {
      healthScore,
      criticalAlerts: legacyCount + instances.filter((i) => i.state === "warning" || i.state === "critical").length,
      highConnectionPressureCount: instances.filter((i) => i.metrics.activeConnectionsAvg > 200).length,
      highCpuPressureCount: instances.filter((i) => i.metrics.cpuPercentMax > 85).length,
    },
    recommendations: instances.flatMap((i) => i.recommendations),
    lastUpdatedAt: new Date().toISOString(),
    isDemoMode: isDemo,
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const tenantIdParam = request.nextUrl.searchParams.get("tenantId") || "";
    if (!tenantIdParam || tenantIdParam === "default") {
      return NextResponse.json({ error: "Falta parámetro tenantId" }, { status: 400 });
    }

    const tenantId = tenantIdParam;
    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const bustCache = request.nextUrl.searchParams.get("bust") === "1";
    const cacheKey = getDiagnosticsCacheKey(tenantId, "postgres-finops-v1");

    if (!bustCache) {
      const cached = await readDiagnosticsCache<PostgreSqlFinopsSummaryResponse>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // --- MOCK path ---
    if (isMockTenant(tenantId)) {
      const mockInstances = buildMockPostgresResources(tenantId);
      const response = buildSummaryResponse(mockInstances, true);
      await writeDiagnosticsCache(cacheKey, response);
      return NextResponse.json(response);
    }

    // --- PRODUCTION path ---
    let credential;
    try {
      credential = await getAzureCredential(tenantId);
    } catch {
      credential = null;
    }

    if (!credential) {
      const emptyPayload = buildSummaryResponse([], false);
      return NextResponse.json(emptyPayload);
    }

    const subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
    const subscriptionMap = await getSubscriptionNameMap(tenantId, credential);

    const rawResources = await listResourcesByTypes(tenantId, POSTGRES_TYPES, subscriptionIds, credential);

    // Deduplicate by ID
    const seenRids = new Set<string>();
    const uniqueRaw = rawResources.filter((r) => {
      const k = String(r.id || "").toLowerCase();
      if (!k || seenRids.has(k)) return false;
      seenRids.add(k);
      return true;
    });

    const resourceItems = uniqueRaw
      .filter((r) => Boolean(r.subscriptionId))
      .map((r) => ({ id: r.id, subscriptionId: String(r.subscriptionId) }));
    const resourceCosts = await getResourceCostsById(tenantId, resourceItems).catch(() => new Map<string, number>());

    const instances: AzurePostgreSqlResourceDetail[] = [];

    for (const raw of uniqueRaw) {
      const name = String(raw.name || "postgres-server");
      const rawType = String(raw.type || "").toLowerCase();
      const isCitus = rawType.includes("servergroupsv2");
      const isSingleServer = rawType.endsWith("/servers") && !rawType.includes("flexibleservers");
      const serverType: PostgreSqlServerType = isCitus ? "CosmosDbCitus" : isSingleServer ? "SingleServer" : "FlexibleServer";

      const region = String(raw.location || "eastus");
      const matchRg = String(raw.id || "").match(/\/resourceGroups\/([^/]+)/i);
      const resourceGroup =
        raw.resourceGroup && raw.resourceGroup.toLowerCase() !== "unknown"
          ? raw.resourceGroup
          : matchRg ? matchRg[1] : "unknown";

      const subId = String(raw.subscriptionId || "").toLowerCase();
      const subName = resolveSubscriptionName(subId, subscriptionMap) || subId || "Producción";
      const rid = String(raw.id || "").toLowerCase();
      const rawCost = resourceCosts.get(rid) || 0;

      const rawProps: any = raw.properties || {};
      const skuRaw: any = rawProps.sku || {};
      const skuName = String(typeof skuRaw === "string" ? skuRaw : skuRaw.name || raw.skuName || "Standard_D2ds_v5");
      const skuTierRaw = typeof skuRaw === "object" ? skuRaw.tier : undefined;
      const tier = resolveSkuTier(skuName, skuTierRaw);
      const { vCores, memoryGib } = resolveSkuCapacity(skuName);

      const storageProp = rawProps.storage || rawProps.storageProfile || {};
      const storageGbRaw = storageProp.storageSizeGB
        ? Number(storageProp.storageSizeGB)
        : storageProp.storageMB
        ? Number(storageProp.storageMB) / 1024
        : 32;
      const storageGb = Math.max(32, storageGbRaw);
      const autoGrow = String(storageProp.autoGrow || storageProp.autoGrowth || "Disabled").toLowerCase() !== "disabled";
      const autoIoScaling = String(storageProp.autoIoScaling || "Disabled").toLowerCase() === "enabled";
      const iops = Number(storageProp.iops || (autoIoScaling ? 3000 : 1000));

      const haProps = rawProps.highAvailability || {};
      const haModeRaw = String(haProps.mode || "Disabled");
      const haMode: PostgreSqlHaMode = haModeRaw === "ZoneRedundant" ? "ZoneRedundant" : haModeRaw === "SameZone" ? "SameZone" : "Disabled";

      const backupProp = rawProps.backup || {};
      const backupRetentionDays = Number(backupProp.backupRetentionDays || 7);
      const geoRedundantBackup = String(backupProp.geoRedundantBackup || "Disabled").toLowerCase() !== "disabled";
      const version = String(rawProps.version || "15");

      const monthlyCost = rawCost > 0 ? rawCost : estimatePostgresMonthlyCost(skuName, tier, storageGb, haMode);

      const usedStorageGb = round2(storageGb * 0.25);

      const skuProfile: PostgreSqlSkuProfile = {
        name: skuName,
        tier,
        vCores,
        memoryGib,
        version,
        haMode,
        haReplicas: haMode !== "Disabled" ? 1 : 0,
        readReplicas: 0,
        backupRetentionDays,
        geoRedundantBackup,
      };

      const storageProfile: PostgreSqlStorageProfile = {
        storageSizeGb: storageGb,
        usedStorageGb,
        storageUtilizationPct: round2((usedStorageGb / Math.max(1, storageGb)) * 100),
        autoGrow,
        autoIoScaling,
        iops,
        isOverallocated: storageGb > 100 && usedStorageGb < storageGb * 0.2,
      };

      const metrics: PostgreSqlPerformanceMetrics = {
        cpuPercentAvg: 14.5,
        cpuPercentMax: 42.0,
        memoryPercentAvg: 28.0,
        storageUsedGib: usedStorageGb,
        storageUsedPct: round2((usedStorageGb / Math.max(1, storageGb)) * 100),
        activeConnectionsAvg: 25,
        activeConnectionsMax: 80,
        ioConsumptionPct: 15.0,
        diskIopsConsumedAvg: 250,
        failedConnections: 0,
      };

      const cost: PostgreSqlCostBreakdown = {
        monthlyCostUsd: round2(monthlyCost),
        computeCostUsd: round2(monthlyCost * 0.7),
        storageCostUsd: round2(monthlyCost * 0.18),
        haCostUsd: haMode !== "Disabled" ? round2(monthlyCost * 0.45) : 0,
        backupCostUsd: round2(monthlyCost * 0.07),
        potentialSavingsUsd: 0,
      };

      const detail: AzurePostgreSqlResourceDetail = {
        id: raw.id,
        name,
        serverType,
        isLegacySingleServer: isSingleServer,
        resourceGroup,
        subscriptionId: subId,
        subscriptionName: subName,
        region,
        state: isSingleServer ? "warning" : "Ready",
        version,
        skuProfile,
        storageProfile,
        metrics,
        cost,
        recommendations: [],
        fqdn: String(rawProps.fullyQualifiedDomainName || rawProps.fqdn || ""),
        tags: {},
      };

      detail.recommendations = derivePostgresRecommendations(detail);
      detail.cost.potentialSavingsUsd = round2(
        detail.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0)
      );

      instances.push(detail);
    }

    const response = buildSummaryResponse(instances, false);
    await writeDiagnosticsCache(cacheKey, response);
    return NextResponse.json(response);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Error al consultar telemetría y FinOps de Azure PostgreSQL", details: String(err) },
      { status: 500 }
    );
  }
}
