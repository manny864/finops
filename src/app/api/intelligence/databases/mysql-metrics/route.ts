import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  listResourcesByTypes,
  getDiagnosticsCacheKey,
  readDiagnosticsCache,
  writeDiagnosticsCache,
  getMtdCostByResourceId,
} from "../diagnosticsShared";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import {
  MySqlServerDetail,
  MySqlFinopsSummaryResponse,
  MySqlRemediationAction,
  MySqlSkuProfile,
  MySqlPerformanceMetrics,
  MySqlCostBreakdown,
  MySqlSkuTier,
  MySqlHaMode,
  MySqlServerType,
} from "@/types/azureMySQL";
import { extractResourceCreatedAt, forecastMonthEnd, forecastRange, prorateMonthlyRateToMtd } from "@/lib/costAccrual";

// ---------------------------------------------------------------------------
// ARM resource types for Azure Database for MySQL
// ---------------------------------------------------------------------------
const MYSQL_TYPES = [
  "microsoft.dbformysql/flexibleservers",
  "microsoft.dbformysql/servers",
  "Microsoft.DBforMySQL/flexibleServers",
  "Microsoft.DBforMySQL/servers",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Proyección a fin de mes, delegada al módulo compartido.
 *
 * La versión local contaba el día en curso como completo (`asOf.getDate()`), así
 * que el día 1 dividía por un día entero teniendo horas de datos, y usaba una
 * banda fija del 8% sin importar cuánta historia hubiera.
 */
function estimateForecast(mtdCost: number, asOf: Date): { value: number; low: number; high: number } {
  return { value: forecastMonthEnd(mtdCost, asOf), ...forecastRange(mtdCost, asOf) };
}

/** Map SKU name → vCores & memory for common MySQL SKUs */
function resolveSkuCapacity(skuName: string): { vCores: number; memoryGib: number; iops: number } {
  const n = skuName.toLowerCase();
  // Burstable
  if (n.includes("b1ms")) return { vCores: 1, memoryGib: 2, iops: 640 };
  if (n.includes("b2ms")) return { vCores: 2, memoryGib: 4, iops: 1280 };
  if (n.includes("b2s")) return { vCores: 2, memoryGib: 2, iops: 1280 };
  if (n.includes("b4ms")) return { vCores: 4, memoryGib: 8, iops: 2400 };
  if (n.includes("b8ms")) return { vCores: 8, memoryGib: 16, iops: 3200 };
  if (n.includes("b12ms")) return { vCores: 12, memoryGib: 24, iops: 4000 };
  if (n.includes("b16ms")) return { vCores: 16, memoryGib: 32, iops: 4800 };
  if (n.includes("b20ms")) return { vCores: 20, memoryGib: 40, iops: 5000 };
  // General Purpose
  if (n.includes("d2ds") || n.includes("d2s")) return { vCores: 2, memoryGib: 8, iops: 3200 };
  if (n.includes("d4ds") || n.includes("d4s")) return { vCores: 4, memoryGib: 16, iops: 6400 };
  if (n.includes("d8ds") || n.includes("d8s")) return { vCores: 8, memoryGib: 32, iops: 12800 };
  if (n.includes("d16ds") || n.includes("d16s")) return { vCores: 16, memoryGib: 64, iops: 20000 };
  if (n.includes("d32ds") || n.includes("d32s")) return { vCores: 32, memoryGib: 128, iops: 20000 };
  if (n.includes("d48ds") || n.includes("d48s")) return { vCores: 48, memoryGib: 192, iops: 20000 };
  if (n.includes("d64ds") || n.includes("d64s")) return { vCores: 64, memoryGib: 256, iops: 20000 };
  // Memory Optimized
  if (n.includes("e2ds") || n.includes("e2s")) return { vCores: 2, memoryGib: 16, iops: 3200 };
  if (n.includes("e4ds") || n.includes("e4s")) return { vCores: 4, memoryGib: 32, iops: 6400 };
  if (n.includes("e8ds") || n.includes("e8s")) return { vCores: 8, memoryGib: 64, iops: 12800 };
  if (n.includes("e16ds") || n.includes("e16s")) return { vCores: 16, memoryGib: 128, iops: 20000 };
  if (n.includes("e32ds") || n.includes("e32s")) return { vCores: 32, memoryGib: 256, iops: 20000 };
  if (n.includes("e48ds") || n.includes("e48s")) return { vCores: 48, memoryGib: 384, iops: 20000 };
  if (n.includes("e64ds") || n.includes("e64s")) return { vCores: 64, memoryGib: 512, iops: 20000 };
  // Default fallback
  return { vCores: 2, memoryGib: 4, iops: 1280 };
}

function resolveSkuTier(skuName: string, skuTierRaw?: string): MySqlSkuTier {
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

function estimateSkuMonthlyCost(skuName: string, tier: MySqlSkuTier, storageGib: number, haMode: MySqlHaMode): number {
  const n = skuName.toLowerCase();
  let compute = 29.20; // default Standard_B2s
  if (n.includes("b1ms")) compute = 14.60;
  else if (n.includes("b2ms") || n.includes("b2s")) compute = 29.20;
  else if (n.includes("b4ms")) compute = 68.00;
  else if (n.includes("b8ms")) compute = 136.00;
  else if (n.includes("d2ds") || n.includes("d2s")) compute = 142.00;
  else if (n.includes("d4ds") || n.includes("d4s")) compute = 284.00;
  else if (n.includes("d8ds") || n.includes("d8s")) compute = 568.00;
  else if (n.includes("e2ds") || n.includes("e2s")) compute = 175.00;
  else if (n.includes("e4ds") || n.includes("e4s")) compute = 350.00;
  else if (n.includes("e8ds") || n.includes("e8s")) compute = 700.00;

  if (haMode !== "Disabled") {
    compute *= 2; // HA standby replica
  }
  const storage = storageGib * 0.115;
  const backup = Math.max(2.5, storageGib * 0.05);
  return round2(compute + storage + backup);
}

// ---------------------------------------------------------------------------
// Remediation Engine — 5 FinOps Rules
// ---------------------------------------------------------------------------
function deriveMySqlRecommendations(server: MySqlServerDetail): MySqlRemediationAction[] {
  const actions: MySqlRemediationAction[] = [];
  const cost = server.cost.monthlyCostUsd > 0 ? server.cost.monthlyCostUsd : estimateSkuMonthlyCost(server.skuProfile.name, server.skuProfile.tier, server.skuProfile.storageGib, server.skuProfile.haMode);
  const nameLower = server.name.toLowerCase();
  const rgLower = server.resourceGroup.toLowerCase();
  const isDevOrStg =
    nameLower.includes("dev") || nameLower.includes("test") || nameLower.includes("stg") ||
    nameLower.includes("stage") || nameLower.includes("qa") || nameLower.includes("sandbox") ||
    rgLower.includes("dev") || rgLower.includes("test") || rgLower.includes("stg");

  const { cpuPercentAvg, memoryPercentAvg, storageUsedPct, storageUsedGib, activeConnectionsAvg } = server.metrics;
  const { tier, vCores, storageGib, haMode } = server.skuProfile;

  // Rule 1: Downsize overprovisioned Burstable SKU (B4ms+ with low usage or B2s in non-prod with low load)
  if (tier === "Burstable" && vCores >= 4 && cpuPercentAvg < 20 && memoryPercentAvg < 25) {
    const savings = round2(Math.max(8, cost * 0.45));
    actions.push({
      id: `${server.id}-downsize-burstable`,
      ruleKey: "downsize_burstable_sku",
      params: {
        name: server.name,
        sku: server.skuProfile.name,
        vCores,
        cpu: cpuPercentAvg.toFixed(1),
        mem: memoryPercentAvg.toFixed(1),
      },
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az mysql flexible-server update \\
  --name ${server.name} \\
  --resource-group ${server.resourceGroup} \\
  --sku-name Standard_B2ms \\
  --tier Burstable`,
      bicepSnippet: `resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: '${server.name}'
  location: '${server.region}'
  sku: {
    name: 'Standard_B2ms'
    tier: 'Burstable'
  }
  properties: {
    storage: {
      storageSizeGB: ${storageGib}
      autoGrow: 'Enabled'
    }
    version: '${server.skuProfile.version}'
  }
}`,
    });
  }

  // Rule 1.b: General Purpose or Memory Optimized with low load -> Migrate to Burstable
  if ((tier === "GeneralPurpose" || tier === "MemoryOptimized") && cpuPercentAvg < 20 && activeConnectionsAvg < 50) {
    const savings = round2(Math.max(35, cost * 0.55));
    actions.push({
      id: `${server.id}-migrate-to-burstable`,
      ruleKey: "migrate_to_burstable",
      params: { name: server.name, sku: server.skuProfile.name, cpu: cpuPercentAvg.toFixed(1) },
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az mysql flexible-server update \\
  --name ${server.name} \\
  --resource-group ${server.resourceGroup} \\
  --sku-name Standard_B2ms \\
  --tier Burstable`,
      bicepSnippet: `resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: '${server.name}'
  location: '${server.region}'
  sku: {
    name: 'Standard_B2ms'
    tier: 'Burstable'
  }
}`,
    });
  }

  // Rule 2: Storage overprovisioned (< 40% used and > 128 GiB)
  if (storageGib > 128 && storageUsedPct < 40) {
    const targetGib = Math.max(32, Math.ceil(storageUsedGib * 1.5));
    const savings = round2(Math.max(3, (storageGib - targetGib) * 0.115));
    actions.push({
      id: `${server.id}-storage-overprovisioned`,
      ruleKey: "storage_overprovisioned",
      params: {
        name: server.name,
        provisioned: storageGib,
        used: storageUsedGib.toFixed(1),
        pct: storageUsedPct.toFixed(1),
        target: targetGib,
        savings,
      },
      savingsMonthlyUsd: savings,
      risk: "medium",
      confidence: "medium",
      actionType: "manual",
      cliCommand: `# {{cmt.mysqlNoInPlaceShrink}}
# {{cmt.recommendedProcedure}}
# 1. {{cmt.stepSnapshotBackup}} ${server.name}
# 2. {{cmt.stepProvisionNewServer}} ${targetGib} GiB
# 3. {{cmt.stepMigrateData}}
# 4. {{cmt.stepSwapAndDelete}}`,
    });
  }

  // Rule 3: HA enabled in Dev/Test environments
  if (haMode !== "Disabled" && isDevOrStg) {
    const haSavings = round2(Math.max(10, cost * 0.4));
    actions.push({
      id: `${server.id}-ha-dev-test`,
      ruleKey: "ha_dev_test",
      params: { name: server.name, haMode },
      savingsMonthlyUsd: haSavings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az mysql flexible-server update \\
  --name ${server.name} \\
  --resource-group ${server.resourceGroup} \\
  --high-availability Disabled`,
      bicepSnippet: `resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
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

  // Rule 4: Single Server → migration required (retirement)
  if (server.serverType === "SingleServer" && server.isLegacy) {
    actions.push({
      id: `${server.id}-single-server-migration`,
      ruleKey: "single_server_migration",
      params: { name: server.name },
      savingsMonthlyUsd: 0,
      risk: "high",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# {{cmt.useDmsOrInPortal}}
az mysql flexible-server import create \\
  --data-source-type "mysql_single" \\
  --data-source "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --location "${server.region}" \\
  --name "${server.name}-flex" \\
  --admin-user "adminuser" \\
  --admin-password "<YOUR_SECURE_PASSWORD>"`,
    });
  }

  // Rule 5: Idle server (< 3 QPS and < 5 active connections avg)
  if (server.metrics.queriesPerSecond < 3 && activeConnectionsAvg < 5 && cost > 20) {
    const savings = round2(cost * 0.85);
    actions.push({
      id: `${server.id}-idle-server`,
      ruleKey: "idle_server",
      params: {
        name: server.name,
        qps: server.metrics.queriesPerSecond.toFixed(1),
        connections: activeConnectionsAvg.toFixed(0),
        savings,
      },
      savingsMonthlyUsd: savings,
      risk: "high",
      confidence: "medium",
      actionType: "manual",
      cliCommand: `# {{cmt.checkNoPendingWorkloads}}
# {{cmt.createFinalBackup}}
az mysql flexible-server backup create \\
  --name ${server.name} \\
  --resource-group ${server.resourceGroup}

# {{cmt.deleteServer}}
az mysql flexible-server delete \\
  --name ${server.name} \\
  --resource-group ${server.resourceGroup} \\
  --yes`,
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Mock data builders
// ---------------------------------------------------------------------------
function buildMockMySqlServers(tenantId: string): MySqlServerDetail[] {
  const isEnterprise = tenantId === "33333333-4444-5555-6666-777777777777";
  const isBusiness = tenantId === "44444444-5555-6666-7777-888888888888";
  const mult = isEnterprise ? 3.0 : isBusiness ? 1.5 : 1.0;

  const servers: MySqlServerDetail[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-mysql-prod-rg/providers/Microsoft.DBforMySQL/flexibleServers/cscs-mysql-prod-westus2",
      name: "cscs-mysql-prod-westus2",
      serverType: "FlexibleServer",
      resourceGroup: "cscs-mysql-prod-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "westus2",
      state: "healthy",
      isLegacy: false,
      provisioningState: "Succeeded",
      sslEnforcement: true,
      fqdn: "cscs-mysql-prod-westus2.mysql.database.azure.com",
      skuProfile: {
        name: "Standard_D4ds_v4",
        tier: "GeneralPurpose",
        vCores: 4,
        memoryGib: 16,
        iops: 6400,
        storageGib: 256,
        storageAutoGrow: true,
        version: "8.0.21",
        haMode: "ZoneRedundant",
        haReplicas: 1,
        readReplicas: 1,
        backupRetentionDays: 35,
        geoRedundantBackup: true,
      },
      metrics: {
        cpuPercentAvg: 28.4,
        cpuPercentMax: 72.1,
        memoryPercentAvg: 42.5,
        storageUsedGib: 98.3,
        storageUsedPct: round2((98.3 / 256) * 100),
        activeConnectionsAvg: 45,
        activeConnectionsMax: 130,
        ioConsumptionPct: 31.2,
        queriesPerSecond: 285,
        slowQueries: 12,
        networkIngressBps: 480000,
        networkEgressBps: 1250000,
        failedConnections: 3,
      },
      cost: {
        monthlyCostUsd: round2(245.8 * mult),
        computeCostUsd: round2(180.0 * mult),
        storageCostUsd: round2(51.2 * mult),
        backupCostUsd: round2(14.6 * mult),
        savingsMonthlyUsd: 0,
      },
      recommendations: [],
      tags: { Environment: "Production", Team: "Platform", Tier: "Business" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-mysql-stg-rg/providers/Microsoft.DBforMySQL/flexibleServers/cscs-mysql-stg-westus2",
      name: "cscs-mysql-stg-westus2",
      serverType: "FlexibleServer",
      resourceGroup: "cscs-mysql-stg-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "westus2",
      state: "warning",
      isLegacy: false,
      provisioningState: "Succeeded",
      sslEnforcement: true,
      fqdn: "cscs-mysql-stg-westus2.mysql.database.azure.com",
      skuProfile: {
        name: "Standard_B4ms",
        tier: "Burstable",
        vCores: 4,
        memoryGib: 8,
        iops: 2400,
        storageGib: 256,
        storageAutoGrow: false,
        version: "8.0.21",
        haMode: "SameZone",
        haReplicas: 1,
        readReplicas: 0,
        backupRetentionDays: 7,
        geoRedundantBackup: false,
      },
      metrics: {
        cpuPercentAvg: 8.3,
        cpuPercentMax: 22.5,
        memoryPercentAvg: 15.4,
        storageUsedGib: 24.1,
        storageUsedPct: round2((24.1 / 256) * 100),
        activeConnectionsAvg: 6,
        activeConnectionsMax: 22,
        ioConsumptionPct: 9.1,
        queriesPerSecond: 28.5,
        slowQueries: 2,
        networkIngressBps: 35000,
        networkEgressBps: 62000,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(92.4 * mult),
        computeCostUsd: round2(60.0 * mult),
        storageCostUsd: round2(25.6 * mult),
        backupCostUsd: round2(6.8 * mult),
        savingsMonthlyUsd: 0,
      },
      recommendations: [],
      tags: { Environment: "Staging", Team: "QA" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-legacy-rg/providers/Microsoft.DBforMySQL/servers/cscs-mysql-legacy-eastus",
      name: "cscs-mysql-legacy-eastus",
      serverType: "SingleServer",
      resourceGroup: "cscs-legacy-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "eastus",
      state: "critical",
      isLegacy: true,
      provisioningState: "Succeeded",
      sslEnforcement: true,
      fqdn: "cscs-mysql-legacy-eastus.mysql.database.azure.com",
      skuProfile: {
        name: "GP_Gen5_4",
        tier: "GeneralPurpose",
        vCores: 4,
        memoryGib: 20,
        iops: 0,
        storageGib: 128,
        storageAutoGrow: true,
        version: "5.7",
        haMode: "Disabled",
        haReplicas: 0,
        readReplicas: 0,
        backupRetentionDays: 7,
        geoRedundantBackup: false,
      },
      metrics: {
        cpuPercentAvg: 9.1,
        cpuPercentMax: 35.0,
        memoryPercentAvg: 22.0,
        storageUsedGib: 41.8,
        storageUsedPct: round2((41.8 / 128) * 100),
        activeConnectionsAvg: 12,
        activeConnectionsMax: 38,
        ioConsumptionPct: 14.5,
        queriesPerSecond: 55,
        slowQueries: 8,
        networkIngressBps: 28000,
        networkEgressBps: 85000,
        failedConnections: 15,
      },
      cost: {
        monthlyCostUsd: round2(118.5 * mult),
        computeCostUsd: round2(88.0 * mult),
        storageCostUsd: round2(22.0 * mult),
        backupCostUsd: round2(8.5 * mult),
        savingsMonthlyUsd: 0,
      },
      recommendations: [],
      tags: { Environment: "Production", Team: "Legacy" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-mysql-dev-rg/providers/Microsoft.DBforMySQL/flexibleServers/cscs-mysql-dev-westus2",
      name: "cscs-mysql-dev-westus2",
      serverType: "FlexibleServer",
      resourceGroup: "cscs-mysql-dev-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "westus2",
      state: "warning",
      isLegacy: false,
      provisioningState: "Succeeded",
      sslEnforcement: false,
      fqdn: "cscs-mysql-dev-westus2.mysql.database.azure.com",
      skuProfile: {
        name: "Standard_B4ms",
        tier: "Burstable",
        vCores: 4,
        memoryGib: 8,
        iops: 2400,
        storageGib: 128,
        storageAutoGrow: false,
        version: "8.0.21",
        haMode: "Disabled",
        haReplicas: 0,
        readReplicas: 0,
        backupRetentionDays: 7,
        geoRedundantBackup: false,
      },
      metrics: {
        cpuPercentAvg: 1.8,
        cpuPercentMax: 7.2,
        memoryPercentAvg: 8.5,
        storageUsedGib: 6.2,
        storageUsedPct: round2((6.2 / 128) * 100),
        activeConnectionsAvg: 2,
        activeConnectionsMax: 8,
        ioConsumptionPct: 2.1,
        queriesPerSecond: 1.2,
        slowQueries: 0,
        networkIngressBps: 3200,
        networkEgressBps: 5100,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(52.3 * mult),
        computeCostUsd: round2(38.0 * mult),
        storageCostUsd: round2(12.8 * mult),
        backupCostUsd: round2(1.5 * mult),
        savingsMonthlyUsd: 0,
      },
      recommendations: [],
      tags: { Environment: "Dev", Team: "Backend" },
    },
  ];

  if (isEnterprise || isBusiness) {
    const highPerfServer: MySqlServerDetail = {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/cscs-mysql-ha-rg/providers/Microsoft.DBforMySQL/flexibleServers/cscs-mysql-ha-eastus2",
      name: "cscs-mysql-ha-eastus2",
      serverType: "FlexibleServer",
      resourceGroup: "cscs-mysql-ha-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "CSCS-Production",
      region: "eastus2",
      state: "healthy",
      isLegacy: false,
      provisioningState: "Succeeded",
      sslEnforcement: true,
      fqdn: "cscs-mysql-ha-eastus2.mysql.database.azure.com",
      skuProfile: {
        name: "Standard_E8ds_v5",
        tier: "MemoryOptimized",
        vCores: 8,
        memoryGib: 64,
        iops: 12800,
        storageGib: 1024,
        storageAutoGrow: true,
        version: "8.0.32",
        haMode: "ZoneRedundant",
        haReplicas: 1,
        readReplicas: 2,
        backupRetentionDays: 35,
        geoRedundantBackup: true,
      },
      metrics: {
        cpuPercentAvg: 45.8,
        cpuPercentMax: 88.4,
        memoryPercentAvg: 62.3,
        storageUsedGib: 412.6,
        storageUsedPct: round2((412.6 / 1024) * 100),
        activeConnectionsAvg: 180,
        activeConnectionsMax: 450,
        ioConsumptionPct: 58.7,
        queriesPerSecond: 1240,
        slowQueries: 28,
        networkIngressBps: 2450000,
        networkEgressBps: 6100000,
        failedConnections: 2,
      },
      cost: {
        monthlyCostUsd: round2(625.4 * mult),
        computeCostUsd: round2(480.0 * mult),
        storageCostUsd: round2(102.4 * mult),
        backupCostUsd: round2(43.0 * mult),
        savingsMonthlyUsd: 0,
      },
      recommendations: [],
      tags: { Environment: "Production", Team: "Data", Tier: "Enterprise" },
    };
    highPerfServer.recommendations = deriveMySqlRecommendations(highPerfServer);
    highPerfServer.cost.savingsMonthlyUsd = round2(highPerfServer.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0));
    servers.push(highPerfServer);
  }

  for (const s of servers) {
    if (s.recommendations.length === 0) {
      s.recommendations = deriveMySqlRecommendations(s);
      s.cost.savingsMonthlyUsd = round2(s.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0));
    }
  }

  return servers;
}

// ---------------------------------------------------------------------------
// Summary builder (shared between mock and production paths)
// ---------------------------------------------------------------------------
function buildSummaryResponse(
  servers: MySqlServerDetail[],
  asOf: Date,
  isMock: boolean
): MySqlFinopsSummaryResponse {
  const allRecs = servers.flatMap((s) => s.recommendations);
  const totalCost = servers.reduce((acc, s) => acc + s.cost.monthlyCostUsd, 0);
  const potentialSavings = allRecs.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0);
  const totalVCores = servers.reduce((acc, s) => acc + s.skuProfile.vCores, 0);
  const totalStorageGib = servers.reduce((acc, s) => acc + s.skuProfile.storageGib, 0);
  const underutilized = servers.filter((s) => s.metrics.cpuPercentAvg < 15).length;
  const legacySingleServerCount = servers.filter((s) => s.isLegacy).length;

  const healthAvg =
    servers.length > 0
      ? servers.reduce((acc, s) => {
          let score = 100;
          if (s.isLegacy) score -= 40;
          if (s.metrics.cpuPercentAvg < 5) score -= 15;
          if (s.state === "critical") score -= 25;
          if (s.state === "warning") score -= 10;
          if (s.metrics.failedConnections > 10) score -= 10;
          return acc + Math.max(20, score);
        }, 0) / servers.length
      : 100;

  return {
    servers,
    financialSummary: {
      mtdCost: round2(totalCost),
      forecastEom: isMock
        ? { value: forecastMonthEnd(totalCost, asOf), ...forecastRange(totalCost, asOf) }
        : estimateForecast(totalCost, asOf),
      deltaMoM: { value: round2(totalCost * 0.04), percentage: 4.0 },
      potentialSavings: round2(potentialSavings),
    },
    efficiency: {
      costPerVCore: totalVCores > 0 ? round2(totalCost / totalVCores) : 0,
      costPerGibStorage: totalStorageGib > 0 ? round2(totalCost / totalStorageGib) : 0,
      underutilizedCount: underutilized,
      legacySingleServerCount,
    },
    risk: {
      healthScore: round2(healthAvg),
      criticalAlerts: servers.filter((s) => s.state === "critical").length,
      idleServersCount: servers.filter((s) => s.metrics.queriesPerSecond < 3 && s.metrics.activeConnectionsAvg < 5).length,
      haOverprovisionedCount: servers.filter((s) => s.skuProfile.haMode !== "Disabled" && s.metrics.cpuPercentAvg < 10).length,
    },
    recommendations: allRecs,
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
    // v2: cambio la forma del payload (title/description -> ruleKey + params).
    // Sin subir la version, las entradas viejas no traen `params` y la UI tira
    // FORMATTING_ERROR, que en un render tumba el board entero.
    const cacheKey = getDiagnosticsCacheKey(tenantId, "mysql-finops-v2");

    if (!bustCache) {
      const cached = await readDiagnosticsCache<MySqlFinopsSummaryResponse>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // --- MOCK path ---
    if (isMockTenant(tenantId)) {
      const mockServers = buildMockMySqlServers(tenantId);
      const response = buildSummaryResponse(mockServers, new Date(), true);
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
      const emptyPayload = buildSummaryResponse([], new Date(), false);
      return NextResponse.json(emptyPayload);
    }

    const subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
    const subscriptionMap = await getSubscriptionNameMap(tenantId, credential);

    const rawResources = await listResourcesByTypes(tenantId, MYSQL_TYPES, subscriptionIds, credential);

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
    const resourceCosts = await getMtdCostByResourceId(tenantId, credential, resourceItems).catch(
      () => new Map<string, number>(),
    );

    const servers: MySqlServerDetail[] = [];

    for (const raw of uniqueRaw) {
      const name = String(raw.name || "mysql-server");
      const rawType = String(raw.type || "").toLowerCase();
      const serverType: MySqlServerType = rawType.includes("flexibleserver") ? "FlexibleServer" : "SingleServer";
      const isLegacy = serverType === "SingleServer";

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
      const skuName = String(typeof skuRaw === "string" ? skuRaw : skuRaw.name || raw.skuName || "Standard_B2s");
      const skuTierRaw = typeof skuRaw === "object" ? skuRaw.tier : undefined;
      const tier = resolveSkuTier(skuName, skuTierRaw);
      const { vCores, memoryGib, iops } = resolveSkuCapacity(skuName);

      const storageProp = rawProps.storage || rawProps.storageProfile || {};
      const storageGibRaw = storageProp.storageSizeGB
        ? Number(storageProp.storageSizeGB)
        : storageProp.storageMB
        ? Number(storageProp.storageMB) / 1024
        : 32;
      const storageGib = Math.max(32, storageGibRaw);
      const storageAutoGrow = String(storageProp.autoGrow || storageProp.autoGrowth || "Disabled").toLowerCase() !== "disabled";

      const haProps = rawProps.highAvailability || {};
      const haModeRaw = String(haProps.mode || "Disabled");
      const haMode: MySqlHaMode = haModeRaw === "ZoneRedundant" ? "ZoneRedundant" : haModeRaw === "SameZone" ? "SameZone" : "Disabled";

      const backupProp = rawProps.backup || {};
      const backupRetentionDays = Number(backupProp.backupRetentionDays || 7);
      const geoRedundantBackup = String(backupProp.geoRedundantBackup || "Disabled").toLowerCase() !== "disabled";
      const version = String(rawProps.version || "8.0");

      const monthlyCost = rawCost > 0
        ? rawCost
        // El estimado es tarifa MENSUAL: se prorratea a lo transcurrido.
        : prorateMonthlyRateToMtd(
            estimateSkuMonthlyCost(skuName, tier, storageGib, haMode),
            new Date(),
            extractResourceCreatedAt(rawProps, (raw as any).systemData),
          );

      const skuProfile: MySqlSkuProfile = {
        name: skuName, tier, vCores, memoryGib, iops,
        storageGib, storageAutoGrow, version,
        haMode, haReplicas: haMode !== "Disabled" ? 1 : 0,
        readReplicas: 0,
        backupRetentionDays, geoRedundantBackup,
      };

      const metrics: MySqlPerformanceMetrics = {
        cpuPercentAvg: 15.0, cpuPercentMax: 45.0,
        memoryPercentAvg: 30.0,
        storageUsedGib: round2(storageGib * 0.3),
        storageUsedPct: 30.0,
        activeConnectionsAvg: 20, activeConnectionsMax: 60,
        ioConsumptionPct: 18.0,
        queriesPerSecond: 80, slowQueries: 5,
        networkIngressBps: 100000, networkEgressBps: 250000,
        failedConnections: 1,
      };

      const cost: MySqlCostBreakdown = {
        monthlyCostUsd: round2(monthlyCost),
        computeCostUsd: round2(monthlyCost * 0.72),
        storageCostUsd: round2(monthlyCost * 0.22),
        backupCostUsd: round2(monthlyCost * 0.06),
        savingsMonthlyUsd: 0,
      };

      const detail: MySqlServerDetail = {
        id: raw.id, name, serverType,
        resourceGroup, subscriptionId: subId, subscriptionName: subName,
        region, state: isLegacy ? "critical" : "healthy",
        skuProfile, metrics, cost,
        recommendations: [],
        fqdn: String(rawProps.fullyQualifiedDomainName || rawProps.fqdn || ""),
        isLegacy,
        provisioningState: String(rawProps.state || rawProps.userVisibleState || "Succeeded"),
        sslEnforcement: rawProps.sslEnforcement !== "Disabled",
        tags: {},
      };

      detail.recommendations = deriveMySqlRecommendations(detail);
      detail.cost.savingsMonthlyUsd = round2(detail.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0));
      servers.push(detail);
    }

    const response = buildSummaryResponse(servers, new Date(), false);
    await writeDiagnosticsCache(cacheKey, response);
    return NextResponse.json(response);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[MySQL API] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
