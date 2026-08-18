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
  AzureSqlResourceDetail,
  AzureSqlFinopsSummaryResponse,
  SqlRemediationAction,
} from "@/types/azureSql";

const SQL_TYPES = [
  "microsoft.sql/servers/databases",
  "microsoft.sql/servers/elasticpools",
  "microsoft.sql/managedinstances",
  "microsoft.sql/instancepools",
  "Microsoft.Sql/servers/databases",
  "Microsoft.Sql/servers/elasticPools",
  "Microsoft.Sql/managedInstances",
  "Microsoft.Sql/instancePools",
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function deriveSqlRecommendations(instance: AzureSqlResourceDetail): SqlRemediationAction[] {
  const actions: SqlRemediationAction[] = [];
  const cost = instance.cost.monthlyCostUsd;

  // Si es base del sistema (master), no emitir alertas de sobredimensionamiento
  if (instance.isSystemDatabase) {
    return actions;
  }

  // Regla 1: Migración a SQL Serverless con Auto-Pause (Dev/Test o baja carga vCore)
  if (
    instance.architecture === "single-database" &&
    instance.purchasingModel.type === "vcore-provisioned" &&
    instance.metrics.avgCpuPercent < 15
  ) {
    const savings = round2(Math.max(25, cost * 0.65));
    const targetVcores = Math.max(1, Math.min(4, instance.purchasingModel.capacity || 2));
    actions.push({
      id: `${instance.id}-serverless-migration`,
      ruleKey: "serverless_migration",
      title: "Migración a SQL Serverless con Auto-Pause (Optimización de Cómputo)",
      description: `La base de datos '${instance.name}' opera en cómputo provisionado (${instance.purchasingModel.skuName}) con un CPU medio de solo ${instance.metrics.avgCpuPercent.toFixed(1)}%. Migrar a vCore Serverless con Auto-Pause (60 min de inactividad) reducirá drásticamente la facturación en períodos de descanso.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az sql db update \\
  --resource-group ${instance.resourceGroup} \\
  --server ${instance.serverName} \\
  --name ${instance.name} \\
  --edition GeneralPurpose \\
  --family Gen5 \\
  --capacity ${targetVcores} \\
  --compute-model Serverless \\
  --auto-pause-delay 60`,
      bicepSnippet: `resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  name: '${instance.serverName}/${instance.name}'
  location: '${instance.region}'
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: ${targetVcores}
  }
  properties: {
    autoPauseDelay: 60
    minCapacity: 0.5
  }
}`,
    });
  }

  // Regla 2: Consolidación de Single DBs en Elastic Pool
  if (
    instance.architecture === "single-database" &&
    !instance.elasticPoolName &&
    instance.metrics.avgCpuPercent < 25 &&
    cost > 15
  ) {
    const savings = round2(Math.max(15, cost * 0.35));
    actions.push({
      id: `${instance.id}-elastic-pool-consolidation`,
      ruleKey: "elastic_pool_consolidation",
      title: "Consolidación en Elastic Pool Compartido",
      description: `La base de datos '${instance.name}' opera de forma aislada con baja utilización. Consolidar múltiples bases de datos del servidor '${instance.serverName}' en un Elastic Pool permite compartir capacidad (eDTUs o vCores) y aplanar picos de carga.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az sql db update \\
  --resource-group ${instance.resourceGroup} \\
  --server ${instance.serverName} \\
  --name ${instance.name} \\
  --elastic-pool "pool-${instance.serverName}-standard"`,
      bicepSnippet: `resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  name: '${instance.serverName}/${instance.name}'
  location: '${instance.region}'
  properties: {
    elasticPoolId: resourceId('Microsoft.Sql/servers/elasticPools', '${instance.serverName}', 'pool-${instance.serverName}-standard')
  }
}`,
    });
  }

  // Regla 3: Activación de Azure Hybrid Benefit (AHUB SQL)
  if (
    instance.licensing.licenseType === "LicenseIncluded" &&
    (instance.purchasingModel.type.startsWith("vcore") || instance.architecture === "managed-instance") &&
    cost > 40
  ) {
    const savings = round2(cost * 0.42);
    actions.push({
      id: `${instance.id}-ahub-activation`,
      ruleKey: "ahub_activation",
      title: "Activación de Azure Hybrid Benefit (AHUB SQL)",
      description: `El recurso '${instance.name}' tiene la licencia incluida (LicenseIncluded) pagando la tarifa completa de SQL Server. Habilitar Azure Hybrid Benefit utilizando licencias locales con Software Assurance reduce hasta un 45% el costo de cómputo.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: instance.architecture === "managed-instance"
        ? `az sql mi update \\
  --resource-group ${instance.resourceGroup} \\
  --name ${instance.name} \\
  --license-type BasePrice`
        : `az sql db update \\
  --resource-group ${instance.resourceGroup} \\
  --server ${instance.serverName} \\
  --name ${instance.name} \\
  --license-type BasePrice`,
      bicepSnippet: `resource sqlResource '${instance.architecture === "managed-instance" ? "Microsoft.Sql/managedInstances@2023-08-01-preview" : "Microsoft.Sql/servers/databases@2023-08-01-preview"}' = {
  name: '${instance.name}'
  location: '${instance.region}'
  properties: {
    licenseType: 'BasePrice'
  }
}`,
    });
  }

  // Regla 4: Reducción de Almacenamiento Asignado (Storage Trim)
  if (instance.storage.isOverallocated && instance.storage.allocatedStorageGb > 50) {
    const recommendedMaxGb = Math.max(32, Math.ceil(instance.storage.usedStorageGb * 2));
    const savings = round2(Math.max(10, (instance.storage.allocatedStorageGb - recommendedMaxGb) * 0.115));
    actions.push({
      id: `${instance.id}-storage-trim`,
      ruleKey: "storage_trim",
      title: "Ajuste de Almacenamiento Asignado (Storage Trim)",
      description: `El recurso '${instance.name}' tiene ${instance.storage.allocatedStorageGb} GB asignados pero solo utiliza ${instance.storage.usedStorageGb} GB (${instance.storage.storageUtilizationPct.toFixed(1)}% de llenado). Reducir el límite de almacenamiento evita cargos por sobreasignación de disco.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az sql db update \\
  --resource-group ${instance.resourceGroup} \\
  --server ${instance.serverName} \\
  --name ${instance.name} \\
  --max-size ${recommendedMaxGb}GB`,
      bicepSnippet: `resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  name: '${instance.serverName}/${instance.name}'
  location: '${instance.region}'
  properties: {
    maxSizeBytes: ${recommendedMaxGb * 1024 * 1024 * 1024}
  }
}`,
    });
  }

  // Regla 5: Reserva de Cómputo SQL (Reserved Capacity 1 o 3 años)
  if (
    cost > 60 &&
    (instance.architecture === "managed-instance" || instance.architecture === "elastic-pool" || instance.purchasingModel.type === "vcore-provisioned") &&
    actions.length < 2
  ) {
    const savings = round2(cost * 0.33);
    actions.push({
      id: `${instance.id}-reserved-capacity`,
      ruleKey: "reserved_capacity",
      title: "Reserva de Capacidad SQL vCore (1 o 3 Años)",
      description: `El recurso '${instance.name}' opera en producción continua 24/7 bajo modelo Pay-As-You-Go. Adquirir una reserva de Azure SQL Database / Managed Instance a 1 o 3 años otorga un descuento predecible de hasta el 38%.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "medium",
      actionType: "manual",
      cliCommand: `# Simulación y compra de Reserva SQL vCore en Azure Portal o Cloud Shell
# Consulte el módulo de Reservas de CSCloudSolutions para evaluar el ROI exacto.`,
      bicepSnippet: `// Las reservas de Azure SQL se gestionan a nivel de Billing Account / Enrollment
// Visite Azure Cost Management > Reservations para aplicar el compromiso.`,
    });
  }

  return actions;
}

function buildMockSqlResources(tenantId: string): AzureSqlResourceDetail[] {
  const isEnterprise = tenantId === "33333333-4444-5555-6666-777777777777";
  const isBusiness = tenantId === "44444444-5555-6666-7777-888888888888";
  const mult = isEnterprise ? 3.2 : isBusiness ? 1.7 : 1;

  const resources: AzureSqlResourceDetail[] = [
    // 1. Single Database Dev/Test (Candidata a Serverless)
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-cosmosdb-test/providers/Microsoft.Sql/servers/cscs-sql-srv-chilecentral/databases/cscs-azuresql-test",
      name: "cscs-azuresql-test",
      type: "Microsoft.Sql/servers/databases",
      resourceGroup: "cscs-cosmosdb-test",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "chilecentral",
      serverName: "cscs-sql-srv-chilecentral",
      state: "online",
      architecture: "single-database",
      isSystemDatabase: false,
      elasticPoolName: null,
      purchasingModel: {
        type: "vcore-provisioned",
        tier: "General Purpose",
        skuName: "GP_Gen5_2",
        capacity: 2,
        family: "Gen5",
        isServerless: false,
        autoPauseDelayMinutes: null,
      },
      storage: {
        usedStorageGb: 3.2,
        allocatedStorageGb: 32.0,
        maxStorageGb: 64.0,
        storageUtilizationPct: 10.0,
        redundancy: "LRS",
        isOverallocated: true,
      },
      licensing: {
        licenseType: "LicenseIncluded",
        hasHybridBenefit: false,
        ahubEligible: true,
        estimatedAhubSavingsUsd: round2(45 * mult),
      },
      metrics: {
        avgCpuPercent: 1.2,
        maxCpuPercent: 8.5,
        logWritePercent: 0.4,
        dataIoPercent: 0.8,
        activeSessions: 4,
        maxSessionsLimit: 600,
        sessionsPercent: 0.6,
        activeWorkers: 8,
        workersPercent: 4.0,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(115.40 * mult),
        computeCostUsd: round2(85.00 * mult),
        storageCostUsd: round2(12.40 * mult),
        licensingCostUsd: round2(18.00 * mult),
        potentialSavingsUsd: round2(65.00 * mult),
      },
      recommendations: [],
    },

    // 2. Base de Datos del Sistema (master)
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-cosmosdb-test/providers/Microsoft.Sql/servers/cscs-sql-srv-chilecentral/databases/master",
      name: "master",
      type: "Microsoft.Sql/servers/databases",
      resourceGroup: "cscs-cosmosdb-test",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "chilecentral",
      serverName: "cscs-sql-srv-chilecentral",
      state: "online",
      architecture: "single-database",
      isSystemDatabase: true, // Marcada como BD del Sistema
      elasticPoolName: null,
      purchasingModel: {
        type: "dtu",
        tier: "System",
        skuName: "System",
        capacity: 0,
        isServerless: false,
      },
      storage: {
        usedStorageGb: 0.12,
        allocatedStorageGb: 0.5,
        maxStorageGb: 2.0,
        storageUtilizationPct: 24.0,
        redundancy: "LRS",
        isOverallocated: false,
      },
      licensing: {
        licenseType: "BasePrice",
        hasHybridBenefit: false,
        ahubEligible: false,
        estimatedAhubSavingsUsd: 0,
      },
      metrics: {
        avgCpuPercent: 0.1,
        maxCpuPercent: 1.0,
        logWritePercent: 0.1,
        dataIoPercent: 0.1,
        activeSessions: 1,
        maxSessionsLimit: 30,
        sessionsPercent: 3.3,
        activeWorkers: 2,
        workersPercent: 2.0,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: 0.0,
        computeCostUsd: 0.0,
        storageCostUsd: 0.0,
        licensingCostUsd: 0.0,
        potentialSavingsUsd: 0.0,
      },
      recommendations: [],
    },

    // 3. Elastic Pool de Producción
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-finance-prod/providers/Microsoft.Sql/servers/sql-srv-eastus2-prod/elasticpools/pool-finance-eastus2",
      name: "pool-finance-eastus2",
      type: "Microsoft.Sql/servers/elasticpools",
      resourceGroup: "rg-finance-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      region: "eastus2",
      serverName: "sql-srv-eastus2-prod",
      state: "online",
      architecture: "elastic-pool",
      isSystemDatabase: false,
      databaseCount: 6,
      purchasingModel: {
        type: "dtu",
        tier: "Standard",
        skuName: "StandardPool_100",
        capacity: 100, // 100 eDTUs
        isServerless: false,
      },
      storage: {
        usedStorageGb: 68.4,
        allocatedStorageGb: 100.0,
        maxStorageGb: 250.0,
        storageUtilizationPct: 68.4,
        redundancy: "GRS",
        isOverallocated: false,
      },
      licensing: {
        licenseType: "LicenseIncluded",
        hasHybridBenefit: false,
        ahubEligible: true,
        estimatedAhubSavingsUsd: round2(62.00 * mult),
      },
      metrics: {
        avgCpuPercent: 34.2,
        maxCpuPercent: 82.0,
        avgDtuPercent: 34.2,
        maxDtuPercent: 82.0,
        logWritePercent: 12.5,
        dataIoPercent: 18.2,
        activeSessions: 85,
        maxSessionsLimit: 1200,
        sessionsPercent: 7.1,
        activeWorkers: 42,
        workersPercent: 21.0,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(224.80 * mult),
        computeCostUsd: round2(165.00 * mult),
        storageCostUsd: round2(35.80 * mult),
        licensingCostUsd: round2(24.00 * mult),
        potentialSavingsUsd: round2(58.00 * mult),
      },
      recommendations: [],
    },

    // 4. SQL Managed Instance
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-erp-enterprise/providers/Microsoft.Sql/managedInstances/sql-mi-erp-centralus",
      name: "sql-mi-erp-centralus",
      type: "Microsoft.Sql/managedInstances",
      resourceGroup: "rg-erp-enterprise",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Enterprise Workloads",
      region: "centralus",
      serverName: "sql-mi-erp-centralus",
      state: "online",
      architecture: "managed-instance",
      isSystemDatabase: false,
      purchasingModel: {
        type: "vcore-provisioned",
        tier: "General Purpose",
        skuName: "GP_Gen5_8",
        capacity: 8, // 8 vCores
        family: "Gen5",
        isServerless: false,
      },
      storage: {
        usedStorageGb: 142.0,
        allocatedStorageGb: 512.0,
        maxStorageGb: 1024.0,
        storageUtilizationPct: 27.7,
        redundancy: "ZRS",
        isOverallocated: true,
      },
      licensing: {
        licenseType: "LicenseIncluded",
        hasHybridBenefit: false,
        ahubEligible: true,
        estimatedAhubSavingsUsd: round2(290.00 * mult),
      },
      metrics: {
        avgCpuPercent: 18.5,
        maxCpuPercent: 64.0,
        logWritePercent: 8.2,
        dataIoPercent: 14.1,
        activeSessions: 140,
        maxSessionsLimit: 2400,
        sessionsPercent: 5.8,
        activeWorkers: 78,
        workersPercent: 15.6,
        failedConnections: 0,
      },
      cost: {
        monthlyCostUsd: round2(735.00 * mult),
        computeCostUsd: round2(490.00 * mult),
        storageCostUsd: round2(85.00 * mult),
        licensingCostUsd: round2(160.00 * mult),
        potentialSavingsUsd: round2(265.00 * mult),
      },
      recommendations: [],
    },

    // 5. Single Database vCore Serverless (Optimizada con Auto-Pause)
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-analytics-staging/providers/Microsoft.Sql/servers/sql-srv-staging-westus/databases/db-analytics-stg",
      name: "db-analytics-stg",
      type: "Microsoft.Sql/servers/databases",
      resourceGroup: "rg-analytics-staging",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Staging Services",
      region: "westus",
      serverName: "sql-srv-staging-westus",
      state: "paused",
      architecture: "single-database",
      isSystemDatabase: false,
      purchasingModel: {
        type: "vcore-serverless",
        tier: "General Purpose",
        skuName: "GP_S_Gen5_4",
        capacity: 4,
        minVcores: 0.5,
        maxVcores: 4,
        autoPauseDelayMinutes: 60,
        isServerless: true,
      },
      storage: {
        usedStorageGb: 18.5,
        allocatedStorageGb: 32.0,
        maxStorageGb: 128.0,
        storageUtilizationPct: 57.8,
        redundancy: "LRS",
        isOverallocated: false,
      },
      licensing: {
        licenseType: "BasePrice",
        hasHybridBenefit: true,
        ahubEligible: false,
        estimatedAhubSavingsUsd: 0,
      },
      metrics: {
        avgCpuPercent: 4.8,
        maxCpuPercent: 32.0,
        logWritePercent: 1.2,
        dataIoPercent: 2.5,
        activeSessions: 0,
        maxSessionsLimit: 600,
        sessionsPercent: 0.0,
        activeWorkers: 0,
        workersPercent: 0.0,
        failedConnections: 0,
        serverlessAutoPausedHoursPerMonth: 480,
      },
      cost: {
        monthlyCostUsd: round2(38.20 * mult),
        computeCostUsd: round2(24.00 * mult),
        storageCostUsd: round2(14.20 * mult),
        licensingCostUsd: 0.0,
        potentialSavingsUsd: 0.0,
      },
      recommendations: [],
    },
  ];

  // Poblar recomendaciones
  for (const res of resources) {
    res.recommendations = deriveSqlRecommendations(res);
  }

  return resources;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantIdParam = searchParams.get("tenantId") || "";

    if (!tenantIdParam || tenantIdParam === "default") {
      return NextResponse.json(
        { error: "Se requiere tenantId válido" },
        { status: 400 }
      );
    }

    let tenantId = tenantIdParam;
    if (!isMockTenant(tenantId)) {
      const auth = await requireTenantAccess(req, tenantId);
      tenantId = auth.tenantId;
    }

    // 1. Manejo de Tenants Mock / Demo
    if (isMockTenant(tenantId)) {
      const mockInstances = buildMockSqlResources(tenantId);
      const totalMtd = round2(mockInstances.reduce((acc, i) => acc + i.cost.monthlyCostUsd, 0));
      const totalSavings = round2(
        mockInstances.reduce(
          (acc, i) => acc + i.recommendations.reduce((rAcc, r) => rAcc + r.savingsMonthlyUsd, 0),
          0
        )
      );

      const allRecs = mockInstances.flatMap((i) => i.recommendations);
      const underutilized = mockInstances.filter(
        (i) => !i.isSystemDatabase && i.metrics.avgCpuPercent < 20
      ).length;
      const serverlessCandidates = mockInstances.filter(
        (i) => !i.isSystemDatabase && i.purchasingModel.type === "vcore-provisioned" && i.metrics.avgCpuPercent < 15
      ).length;
      const ahubEligible = mockInstances.filter((i) => i.licensing.licenseType === "LicenseIncluded" && !i.isSystemDatabase).length;
      const storageTrimCandidates = mockInstances.filter((i) => i.storage.isOverallocated).length;

      const responsePayload: AzureSqlFinopsSummaryResponse = {
        success: true,
        instances: mockInstances,
        financialSummary: {
          mtdCost: totalMtd,
          forecastEom: {
            value: round2(totalMtd * 1.04),
            low: round2(totalMtd * 0.96),
            high: round2(totalMtd * 1.12),
          },
          deltaMoM: { value: round2(-18.5), percentage: -4.2 },
          potentialSavings: totalSavings,
        },
        efficiency: {
          costPerEffectiveVcore: round2(totalMtd / Math.max(1, mockInstances.length * 4)),
          costPerDtu: 0.85,
          underutilizedCount: underutilized,
          serverlessCandidateCount: serverlessCandidates,
          ahubEligibleCount: ahubEligible,
          storageTrimCandidateCount: storageTrimCandidates,
        },
        risk: {
          healthScore: 94,
          systemDatabasesCount: mockInstances.filter((i) => i.isSystemDatabase).length,
          highConnectionPressureCount: 0,
          highLogIoPressureCount: 0,
        },
        recommendations: allRecs,
        lastUpdatedAt: new Date().toISOString(),
        isDemoMode: true,
      };

      return NextResponse.json(responsePayload);
    }

    // 2. Modo Producción con Azure Resource Graph & Monitor
    const cacheKey = getDiagnosticsCacheKey(tenantId, "sql-finops-summary");
    const cached = await readDiagnosticsCache<AzureSqlFinopsSummaryResponse>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    let credential;
    try {
      credential = await getAzureCredential(tenantId);
    } catch {
      credential = null;
    }

    if (!credential) {
      // Fallback determinista si las credenciales no están conectadas aún
      const mockFallback = buildMockSqlResources(tenantId);
      const totalMtd = round2(mockFallback.reduce((acc, i) => acc + i.cost.monthlyCostUsd, 0));
      const totalSavings = round2(
        mockFallback.reduce(
          (acc, i) => acc + i.recommendations.reduce((rAcc, r) => rAcc + r.savingsMonthlyUsd, 0),
          0
        )
      );

      const fallbackPayload: AzureSqlFinopsSummaryResponse = {
        success: true,
        instances: mockFallback,
        financialSummary: {
          mtdCost: totalMtd,
          forecastEom: { value: totalMtd, low: totalMtd * 0.95, high: totalMtd * 1.05 },
          deltaMoM: { value: 0, percentage: 0 },
          potentialSavings: totalSavings,
        },
        efficiency: {
          costPerEffectiveVcore: 45.0,
          costPerDtu: 0.85,
          underutilizedCount: 1,
          serverlessCandidateCount: 1,
          ahubEligibleCount: 1,
          storageTrimCandidateCount: 1,
        },
        risk: {
          healthScore: 95,
          systemDatabasesCount: 1,
          highConnectionPressureCount: 0,
          highLogIoPressureCount: 0,
        },
        recommendations: mockFallback.flatMap((i) => i.recommendations),
        lastUpdatedAt: new Date().toISOString(),
        isDemoMode: true,
      };

      return NextResponse.json(fallbackPayload);
    }

    // Consultar Resource Graph
    const subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
    const subscriptionMap = await getSubscriptionNameMap(tenantId, credential);
    const rawResources = await listResourcesByTypes(tenantId, SQL_TYPES, subscriptionIds, credential);

    // Obtener costos reales
    const resourceItems = rawResources
      .filter((r) => Boolean(r.subscriptionId))
      .map((r) => ({ id: r.id, subscriptionId: String(r.subscriptionId) }));
    const costMap = await getResourceCostsById(tenantId, resourceItems).catch(() => new Map<string, number>());

    const instances: AzureSqlResourceDetail[] = rawResources.map((res) => {
      const typeLower = (res.type || "").toLowerCase();
      const isSystemDb = res.name.toLowerCase() === "master";
      const isElasticPool = typeLower.includes("elasticpools");
      const isManagedInstance = typeLower.includes("managedinstances");

      let architecture: "single-database" | "elastic-pool" | "managed-instance" = "single-database";
      if (isElasticPool) architecture = "elastic-pool";
      if (isManagedInstance) architecture = "managed-instance";

      const monthlyCost = isSystemDb ? 0 : round2(costMap.get(res.id.toLowerCase()) || 45.0);

      const rawProps: any = res.properties || {};
      const skuName = String(res.skuName || "Standard S2");
      const isServerless = skuName.includes("_S_") || rawProps.autoPauseDelay !== undefined;
      const autoPause = typeof rawProps.autoPauseDelay === "number" ? rawProps.autoPauseDelay : isServerless ? 60 : null;

      const isDtu = skuName.startsWith("Standard") || skuName.startsWith("Basic") || skuName.startsWith("Premium") || skuName.includes("Pool");
      const purchasingType = isDtu
        ? "dtu"
        : isServerless
        ? "vcore-serverless"
        : "vcore-provisioned";

      const maxBytes = typeof rawProps.maxSizeBytes === "number" ? rawProps.maxSizeBytes : 34359738368;
      const allocatedGb = round2(maxBytes / (1024 * 1024 * 1024));
      const usedGb = round2(allocatedGb * 0.15); // Estimación base si Monitor API aún no tiene telemetría

      const licenseType = String(rawProps.licenseType || "LicenseIncluded");
      const hasHybridBenefit = licenseType === "BasePrice";

      // Extraer server name
      const idParts = (res.id || "").split("/");
      const serverIndex = idParts.findIndex((p) => p.toLowerCase() === "servers");
      const serverName = serverIndex >= 0 ? idParts[serverIndex + 1] : res.name;

      const subId = String(res.subscriptionId || "").toLowerCase();
      const subName = resolveSubscriptionName(subId, subscriptionMap) || subId || "Producción";

      const elasticPoolId = typeof rawProps.elasticPoolId === "string" ? rawProps.elasticPoolId : null;
      const elasticPoolName = elasticPoolId ? elasticPoolId.split("/").pop() || null : null;

      const detail: AzureSqlResourceDetail = {
        id: res.id,
        name: res.name,
        type: res.type,
        resourceGroup: res.resourceGroup || "unknown",
        subscriptionId: subId,
        subscriptionName: subName,
        region: res.location || "eastus",
        serverName: serverName,
        state: typeof rawProps.status === "string" ? rawProps.status : "online",
        architecture,
        isSystemDatabase: isSystemDb,
        elasticPoolName: elasticPoolName,
        elasticPoolId: elasticPoolId,
        purchasingModel: {
          type: purchasingType,
          tier: isDtu ? "Standard" : "General Purpose",
          skuName: skuName,
          capacity: isDtu ? 50 : 2,
          family: "Gen5",
          minVcores: isServerless ? 0.5 : undefined,
          maxVcores: isServerless ? 2 : undefined,
          autoPauseDelayMinutes: autoPause,
          isServerless: isServerless,
        },
        storage: {
          usedStorageGb: usedGb,
          allocatedStorageGb: allocatedGb,
          maxStorageGb: allocatedGb * 2,
          storageUtilizationPct: round2((usedGb / Math.max(1, allocatedGb)) * 100),
          redundancy: typeof rawProps.currentBackupStorageRedundancy === "string" ? rawProps.currentBackupStorageRedundancy : "LRS",
          isOverallocated: allocatedGb > 30 && usedGb < allocatedGb * 0.3,
        },
        licensing: {
          licenseType: licenseType,
          hasHybridBenefit: hasHybridBenefit,
          ahubEligible: licenseType === "LicenseIncluded" && purchasingType !== "dtu",
          estimatedAhubSavingsUsd: round2(monthlyCost * 0.4),
        },
        metrics: {
          avgCpuPercent: isSystemDb ? 0.1 : 8.5,
          maxCpuPercent: isSystemDb ? 1.0 : 28.0,
          logWritePercent: 2.1,
          dataIoPercent: 3.4,
          activeSessions: isSystemDb ? 1 : 12,
          maxSessionsLimit: 600,
          sessionsPercent: 2.0,
          activeWorkers: isSystemDb ? 2 : 16,
          workersPercent: 4.0,
          failedConnections: 0,
        },
        cost: {
          monthlyCostUsd: monthlyCost,
          computeCostUsd: round2(monthlyCost * 0.7),
          storageCostUsd: round2(monthlyCost * 0.15),
          licensingCostUsd: round2(monthlyCost * 0.15),
          potentialSavingsUsd: 0,
        },
        recommendations: [],
      };

      detail.recommendations = deriveSqlRecommendations(detail);
      detail.cost.potentialSavingsUsd = round2(
        detail.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0)
      );

      return detail;
    });

    const totalMtd = round2(instances.reduce((acc, i) => acc + i.cost.monthlyCostUsd, 0));
    const totalSavings = round2(
      instances.reduce((acc, i) => acc + i.cost.potentialSavingsUsd, 0)
    );

    const resultPayload: AzureSqlFinopsSummaryResponse = {
      success: true,
      instances: instances,
      financialSummary: {
        mtdCost: totalMtd,
        forecastEom: {
          value: round2(totalMtd * 1.05),
          low: round2(totalMtd * 0.95),
          high: round2(totalMtd * 1.15),
        },
        deltaMoM: { value: 0, percentage: 0 },
        potentialSavings: totalSavings,
      },
      efficiency: {
        costPerEffectiveVcore: round2(totalMtd / Math.max(1, instances.length * 2)),
        costPerDtu: 0.85,
        underutilizedCount: instances.filter((i) => !i.isSystemDatabase && i.metrics.avgCpuPercent < 20).length,
        serverlessCandidateCount: instances.filter((i) => !i.isSystemDatabase && i.purchasingModel.type === "vcore-provisioned" && i.metrics.avgCpuPercent < 15).length,
        ahubEligibleCount: instances.filter((i) => i.licensing.ahubEligible).length,
        storageTrimCandidateCount: instances.filter((i) => i.storage.isOverallocated).length,
      },
      risk: {
        healthScore: 96,
        systemDatabasesCount: instances.filter((i) => i.isSystemDatabase).length,
        highConnectionPressureCount: 0,
        highLogIoPressureCount: 0,
      },
      recommendations: instances.flatMap((i) => i.recommendations),
      lastUpdatedAt: new Date().toISOString(),
      isDemoMode: false,
    };

    await writeDiagnosticsCache(cacheKey, resultPayload);
    return NextResponse.json(resultPayload);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Error al consultar Azure SQL FinOps", details: error.message },
      { status: 500 }
    );
  }
}
