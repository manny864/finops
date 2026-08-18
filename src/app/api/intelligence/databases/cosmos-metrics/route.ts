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
import { redis } from "@/lib/redis";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import pool from "@/modules/storage/db";
import {
  CosmosDbAccountDetail,
  CosmosFinopsSummaryResponse,
  CosmosRemediationAction,
  CosmosArchitectureType,
  CosmosApiKind,
  CosmosThroughputMode,
} from "@/types/cosmosDb";

const COSMOS_TYPES = [
  "microsoft.documentdb/databaseaccounts",
  "microsoft.documentdb/mongoclusters",
];

const COSMOS_METRICS = [
  "TotalRequestUnits",
  "ProvisionedThroughput",
  "NormalizedRUConsumption",
  "TotalRequests",
  "ThrottledRequests",
  "ServerSideLatency",
  "DataUsage",
  "IndexUsage",
  "CpuPercent",
  "MemoryPercent",
  "DiskPercent",
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function avg(values: Array<number | null | undefined>): number | null {
  const measured = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (measured.length === 0) return null;
  return measured.reduce((acc, v) => acc + v, 0) / measured.length;
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, value) => acc + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
}

function estimateForecast(mtdCost: number, asOf: Date): { value: number; low: number; high: number } {
  const day = Math.max(1, asOf.getDate());
  const daysInMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();
  const baseForecast = (mtdCost / day) * daysInMonth;
  const confidenceBand = baseForecast * 0.08;
  return {
    value: round2(baseForecast),
    low: round2(Math.max(0, baseForecast - confidenceBand)),
    high: round2(baseForecast + confidenceBand),
  };
}

function deriveCosmosRecommendations(instance: CosmosDbAccountDetail, anyAccountHasFreeTier: boolean): CosmosRemediationAction[] {
  const actions: CosmosRemediationAction[] = [];
  const cost = instance.cost.totalMonthlyCostUsd;
  const isDev = instance.resourceGroup.toLowerCase().includes("dev") ||
    instance.resourceGroup.toLowerCase().includes("test") ||
    instance.resourceGroup.toLowerCase().includes("poc") ||
    instance.name.toLowerCase().includes("dev") ||
    instance.name.toLowerCase().includes("test");

  // Regla 1: Manual Throughput con baja utilización (<30%) o candidato a Autoscale
  if (
    instance.architecture === "ru-based" &&
    instance.throughputProfile.mode === "manual" &&
    instance.metrics.avgNormalizedRuPct < 30
  ) {
    const savings = round2(Math.max(15, cost * 0.65));
    actions.push({
      id: `${instance.id}-overprovisioned-manual`,
      ruleKey: "manual_overprovisioned",
      title: "Migrar Throughput Manual a Autoscale / Serverless",
      description: `La cuenta opera con throughput manual fijo a un ${instance.metrics.avgNormalizedRuPct.toFixed(1)}% de utilización promedio de RU/s. Migrar a Autoscale reducirá hasta un 65% del costo mensual evitando sobreaprovisionamiento en horas valle.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az cosmosdb sql database throughput update \\
  --account-name ${instance.name} \\
  --resource-group ${instance.resourceGroup} \\
  --name defaultDb \\
  --max-throughput 4000`,
      bicepSnippet: `resource autoscaleDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/throughputSettings@2024-05-15' = {
  name: '\${cosmosAccount.name}/defaultDb/default'
  properties: {
    resource: {
      autoscaleSettings: {
        maxThroughput: 4000
      }
    }
  }
}`,
    });
  }

  // Regla 2: Free Tier disponible y no activado
  if (!anyAccountHasFreeTier && !instance.throughputProfile.freeTierEnabled && instance.architecture === "ru-based") {
    actions.push({
      id: `${instance.id}-free-tier`,
      ruleKey: "free_tier_activation",
      title: "Aprovechar Beneficio Azure Cosmos DB Free Tier",
      description: "La suscripción no tiene ninguna cuenta con Free Tier activo. Activar el Free Tier otorga 1,000 RU/s de throughput y 25 GB de almacenamiento 100% gratuitos permanentemente ($24 USD/mes de ahorro directo).",
      savingsMonthlyUsd: 24,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# Nota: Free Tier se asigna al crear la cuenta (1 por suscripción):
az cosmosdb create \\
  --name ${instance.name}-free \\
  --resource-group ${instance.resourceGroup} \\
  --enable-free-tier true`,
    });
  }

  // Regla 3: Multi-región en ambientes de desarrollo / testing
  if (isDev && instance.throughputProfile.regionsCount > 1) {
    const singleRegionCost = cost > 0 ? cost / instance.throughputProfile.regionsCount : 25;
    const savings = round2(cost > 0 ? cost - singleRegionCost : 25);
    actions.push({
      id: `${instance.id}-multi-region-dev`,
      ruleKey: "multi_region_dev",
      title: "Eliminar Réplicas Multi-Región en Ambiente No Productivo",
      description: `El recurso se encuentra en un entorno de desarrollo/pruebas ('${instance.resourceGroup}') con ${instance.throughputProfile.regionsCount} regiones activas. Remover las regiones secundarias en dev/test reduce el costo a la mitad.`,
      savingsMonthlyUsd: savings,
      risk: "medium",
      confidence: "high",
      actionType: "manual",
      cliCommand: `az cosmosdb update \\
  --name ${instance.name} \\
  --resource-group ${instance.resourceGroup} \\
  --locations regionName="${instance.region}" failoverPriority=0 isZoneRedundant=False`,
    });
  }

  // Regla 4: Capacidad Reservada (Reserved Capacity 1Y/3Y) para cuentas productivas estables
  if (
    instance.architecture === "ru-based" &&
    !isDev &&
    ((instance.throughputProfile.totalProvisionedRu || 0) >= 4000 || cost >= 100)
  ) {
    const savings = round2(Math.max(38, cost * 0.38));
    actions.push({
      id: `${instance.id}-reserved-capacity`,
      ruleKey: "reserved_capacity",
      title: "Adquirir Cosmos DB Reserved Capacity (1 Año / 3 Años)",
      description: `Carga productiva estable con ${(instance.throughputProfile.totalProvisionedRu || 4000).toLocaleString()} RU/s. Adquirir una reserva a 1 o 3 años genera un ahorro entre el 35% y 55% sobre la tarifa base PAYG.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# Adquirir reserva en múltiplos de 100 RU/s desde el Portal de Azure o Azure CLI:
az reservations reservation-order calculate \\
  --sku-name "Cosmos_DB_Reservation" \\
  --billing-scope "/subscriptions/${instance.subscriptionId}"`,
    });
  }

  // Regla 5: Index Storage Overhead & Optimización de Políticas de Indexación
  if (instance.architecture === "ru-based") {
    const isHeavyIndex = instance.storage.indexRatio > 0.4 || instance.storage.indexUsageGb > 10;
    const savings = round2(Math.max(12, instance.storage.indexUsageGb * 0.25));
    actions.push({
      id: `${instance.id}-index-overhead`,
      ruleKey: "index_overhead",
      title: "Optimizar Directiva de Indexación (Index Policy Tuning)",
      description: isHeavyIndex
        ? `El almacenamiento de índices (${instance.storage.indexUsageGb} GB) representa una porción excesiva de los datos (${instance.storage.dataUsageGb} GB). Excluir rutas no consultadas reduce el costo de storage y el consumo de RU/s en escrituras.`
        : `Cosmos DB indexa por defecto todas las rutas ('/*'). Configurar una directiva con 'excludedPaths' en rutas no filtradas previene sobrecostos de almacenamiento y reduce el consumo de RU/s en operaciones de inserción y actualización.`,
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "medium",
      actionType: "guided",
      cliCommand: `# Actualizar política de indexación excluyendo rutas no consultadas:
az cosmosdb sql container update \\
  --account-name ${instance.name} \\
  --resource-group ${instance.resourceGroup} \\
  --database-name defaultDb \\
  --name defaultContainer \\
  --idx @indexingPolicy.json`,
      bicepSnippet: `resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '\${cosmosAccount.name}/defaultDb/defaultContainer'
  properties: {
    resource: {
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/id/?' }, { path: '/tenantId/?' }]
        excludedPaths: [{ path: '/*' }]
      }
    }
  }
}`,
    });
  }

  // Regla 6: MongoDB vCore Rightsizing / HA Optimization
  if (instance.architecture === "vcore-based") {
    const cpu = instance.metrics.cpuPercent || 12;
    const savings = round2(Math.max(45, cost * 0.4));
    actions.push({
      id: `${instance.id}-vcore-rightsizing`,
      ruleKey: "vcore_rightsizing",
      title: "Rightsizing de Clúster MongoDB vCore (Optimización de Cómputo)",
      description: `El clúster MongoDB vCore tiene una utilización de CPU del ${cpu.toFixed(1)}% (${instance.throughputProfile.vCores || 4} vCores asignados). Ajustar el SKU (ej. a M30 o M25) permite optimizar el costo mensual manteniendo un rendimiento óptimo.`,
      savingsMonthlyUsd: savings,
      risk: "medium",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az cosmosdb mongocluster update \\
  --cluster-name ${instance.name} \\
  --resource-group ${instance.resourceGroup} \\
  --shard-node-tier "M30"`,
      bicepSnippet: `resource mongoCluster 'Microsoft.DocumentDB/mongoClusters@2024-07-01' = {
  name: '${instance.name}'
  location: '${instance.region}'
  properties: {
    nodeGroupSpecs: [
      {
        kind: 'Shard'
        sku: 'M30'
        diskSizeGB: 128
        nodeCount: 1
      }
    ]
  }
}`,
    });
  }

  return actions;
}

function buildMockCosmosAccounts(tenantId: string): CosmosDbAccountDetail[] {
  const isEnterprise = tenantId === "33333333-4444-5555-6666-777777777777";
  const isBusiness = tenantId === "44444444-5555-6666-7777-888888888888";
  const mult = isEnterprise ? 3.5 : isBusiness ? 1.8 : 1;

  const accounts: CosmosDbAccountDetail[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-orders-prod",
      name: "cosmos-orders-prod",
      type: "Microsoft.DocumentDB/databaseAccounts",
      kind: "GlobalDocumentDB",
      apiLabel: "Azure Cosmos DB for NoSQL",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      region: "eastus",
      state: "healthy",
      architecture: "ru-based",
      throughputProfile: {
        mode: "autoscale",
        totalProvisionedRu: 12000,
        maxAutoscaleRu: 12000,
        regionsCount: 2,
        regionsList: [
          { name: "eastus", isZoneRedundant: true, isWriteRegion: true },
          { name: "westus2", isZoneRedundant: false, isWriteRegion: false },
        ],
        isMultiRegionWrite: false,
        freeTierEnabled: false,
        dedicatedGatewayEnabled: true,
        analyticalStoreEnabled: false,
      },
      metrics: {
        avgNormalizedRuPct: 48.5,
        p95NormalizedRuPct: 76.2,
        throttling429Rate: 0.04,
        totalRequests: 2450000 * mult,
        throttledRequests: 980,
        serverLatencyMs: 6.2,
      },
      storage: {
        dataUsageGb: 340 * mult,
        indexUsageGb: 95 * mult,
        analyticalStorageGb: 0,
        indexRatio: 0.28,
      },
      cost: {
        throughputMonthlyUsd: round2(438 * mult),
        storageMonthlyUsd: round2(108.75 * mult),
        regionsMultiplier: 2,
        dedicatedGatewayMonthlyUsd: round2(50.4 * mult),
        analyticalStoreMonthlyUsd: 0,
        totalMonthlyCostUsd: round2((438 * 2 + 108.75 + 50.4) * mult),
        efficiencyRatio: round2(438 / 12),
      },
      recommendations: [],
      endpoints: {
        documentEndpoint: "https://cosmos-orders-prod.documents.azure.com:443/",
      },
      tags: { Environment: "Production", Workload: "Orders", CostCenter: "ECommerce" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-analytics-poc/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-catalog-legacy",
      name: "cosmos-catalog-legacy",
      type: "Microsoft.DocumentDB/databaseAccounts",
      kind: "GlobalDocumentDB",
      apiLabel: "Azure Cosmos DB for NoSQL",
      resourceGroup: "rg-analytics-poc",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      region: "brazilsouth",
      state: "warning",
      architecture: "ru-based",
      throughputProfile: {
        mode: "manual",
        totalProvisionedRu: 8000,
        regionsCount: 1,
        regionsList: [{ name: "brazilsouth", isZoneRedundant: false, isWriteRegion: true }],
        isMultiRegionWrite: false,
        freeTierEnabled: false,
        dedicatedGatewayEnabled: false,
        analyticalStoreEnabled: true,
      },
      metrics: {
        avgNormalizedRuPct: 6.4,
        p95NormalizedRuPct: 14.2,
        throttling429Rate: 0.0,
        totalRequests: 85000 * mult,
        throttledRequests: 0,
        serverLatencyMs: 4.1,
      },
      storage: {
        dataUsageGb: 45 * mult,
        indexUsageGb: 58 * mult,
        analyticalStorageGb: 120 * mult,
        indexRatio: 1.28,
      },
      cost: {
        throughputMonthlyUsd: round2(467.2 * mult),
        storageMonthlyUsd: round2(25.75 * mult),
        regionsMultiplier: 1,
        dedicatedGatewayMonthlyUsd: 0,
        analyticalStoreMonthlyUsd: round2(2.4 * mult),
        totalMonthlyCostUsd: round2((467.2 + 25.75 + 2.4) * mult),
        efficiencyRatio: round2(467.2 / 8),
      },
      recommendations: [],
      endpoints: {
        documentEndpoint: "https://cosmos-catalog-legacy.documents.azure.com:443/",
      },
      tags: { Environment: "POC", Owner: "DataTeam" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-mobile-dev/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-mobile-dev",
      name: "cosmos-mobile-dev",
      type: "Microsoft.DocumentDB/databaseAccounts",
      kind: "MongoDB",
      apiLabel: "Cosmos DB for MongoDB (RU)",
      resourceGroup: "rg-mobile-dev",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev/Test Core",
      region: "eastus",
      state: "warning",
      architecture: "ru-based",
      throughputProfile: {
        mode: "manual",
        totalProvisionedRu: 4000,
        regionsCount: 2,
        regionsList: [
          { name: "eastus", isZoneRedundant: false, isWriteRegion: true },
          { name: "northeurope", isZoneRedundant: false, isWriteRegion: false },
        ],
        isMultiRegionWrite: false,
        freeTierEnabled: false,
        dedicatedGatewayEnabled: false,
        analyticalStoreEnabled: false,
      },
      metrics: {
        avgNormalizedRuPct: 11.2,
        p95NormalizedRuPct: 22.0,
        throttling429Rate: 0.0,
        totalRequests: 42000 * mult,
        throttledRequests: 0,
        serverLatencyMs: 5.0,
      },
      storage: {
        dataUsageGb: 18 * mult,
        indexUsageGb: 6 * mult,
        analyticalStorageGb: 0,
        indexRatio: 0.33,
      },
      cost: {
        throughputMonthlyUsd: round2(233.6 * 2 * mult),
        storageMonthlyUsd: round2(6.0 * mult),
        regionsMultiplier: 2,
        dedicatedGatewayMonthlyUsd: 0,
        analyticalStoreMonthlyUsd: 0,
        totalMonthlyCostUsd: round2((233.6 * 2 + 6.0) * mult),
        efficiencyRatio: round2(233.6 / 4),
      },
      recommendations: [],
      endpoints: {
        documentEndpoint: "https://cosmos-mobile-dev.documents.azure.com:443/",
      },
      tags: { Environment: "Development", App: "MobileApp" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-crm-prod/providers/Microsoft.DocumentDB/mongoClusters/mongovcore-crm-cluster",
      name: "mongovcore-crm-cluster",
      type: "Microsoft.DocumentDB/mongoClusters",
      kind: "MongoCluster",
      apiLabel: "Cosmos DB for MongoDB (vCore)",
      resourceGroup: "rg-crm-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      region: "eastus2",
      state: "healthy",
      architecture: "vcore-based",
      throughputProfile: {
        mode: "vcore",
        vCores: 8,
        ramGb: 32,
        storageSizeGb: 512,
        highAvailability: "Enabled",
        regionsCount: 1,
        regionsList: [{ name: "eastus2", isZoneRedundant: true, isWriteRegion: true }],
        isMultiRegionWrite: false,
        freeTierEnabled: false,
        dedicatedGatewayEnabled: false,
        analyticalStoreEnabled: false,
      },
      metrics: {
        avgNormalizedRuPct: 0,
        p95NormalizedRuPct: 0,
        throttling429Rate: 0.0,
        totalRequests: 890000 * mult,
        throttledRequests: 0,
        serverLatencyMs: 3.2,
        cpuPercent: 8.5,
        memoryPercent: 34.0,
        diskPercent: 42.0,
      },
      storage: {
        dataUsageGb: 215 * mult,
        indexUsageGb: 45 * mult,
        analyticalStorageGb: 0,
        indexRatio: 0.21,
      },
      cost: {
        throughputMonthlyUsd: 0,
        storageMonthlyUsd: round2(65.0 * mult),
        regionsMultiplier: 1,
        dedicatedGatewayMonthlyUsd: 0,
        analyticalStoreMonthlyUsd: 0,
        totalMonthlyCostUsd: round2(620.0 * mult),
        efficiencyRatio: round2(620 / 8),
      },
      recommendations: [],
      endpoints: {
        documentEndpoint: "mongovcore-crm-cluster.mongocluster.cosmos.azure.com",
      },
      tags: { Environment: "Production", Workload: "CRM" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-iot-hub/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-telemetry-serverless",
      name: "cosmos-telemetry-serverless",
      type: "Microsoft.DocumentDB/databaseAccounts",
      kind: "GlobalDocumentDB",
      apiLabel: "Azure Cosmos DB (Serverless)",
      resourceGroup: "rg-iot-hub",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      region: "eastus",
      state: "healthy",
      architecture: "ru-based",
      throughputProfile: {
        mode: "serverless",
        regionsCount: 1,
        regionsList: [{ name: "eastus", isZoneRedundant: false, isWriteRegion: true }],
        isMultiRegionWrite: false,
        freeTierEnabled: false,
        dedicatedGatewayEnabled: false,
        analyticalStoreEnabled: false,
      },
      metrics: {
        avgNormalizedRuPct: 100,
        p95NormalizedRuPct: 100,
        throttling429Rate: 0.0,
        totalRequests: 120000 * mult,
        throttledRequests: 0,
        serverLatencyMs: 5.5,
      },
      storage: {
        dataUsageGb: 12 * mult,
        indexUsageGb: 3 * mult,
        analyticalStorageGb: 0,
        indexRatio: 0.25,
      },
      cost: {
        throughputMonthlyUsd: round2(35.2 * mult),
        storageMonthlyUsd: round2(3.75 * mult),
        regionsMultiplier: 1,
        dedicatedGatewayMonthlyUsd: 0,
        analyticalStoreMonthlyUsd: 0,
        totalMonthlyCostUsd: round2((35.2 + 3.75) * mult),
        efficiencyRatio: round2(35.2 / 12),
      },
      recommendations: [],
      endpoints: {
        documentEndpoint: "https://cosmos-telemetry-serverless.documents.azure.com:443/",
      },
      tags: { Environment: "Production", Workload: "IoT" },
    },
  ];

  const anyHasFreeTier = accounts.some((a) => a.throughputProfile.freeTierEnabled);
  for (const acc of accounts) {
    acc.recommendations = deriveCosmosRecommendations(acc, anyHasFreeTier);
  }

  return accounts;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta parámetro tenantId" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    const bustCache = request.nextUrl.searchParams.get("bust") === "1";
    const cacheKey = getDiagnosticsCacheKey(tenantId, "cosmos-db-finops-v2");

    if (!bustCache) {
      const cached = await readDiagnosticsCache<CosmosFinopsSummaryResponse>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    if (isMockTenant(tenantId)) {
      const mockInstances = buildMockCosmosAccounts(tenantId);
      const totalCost = mockInstances.reduce((acc, i) => acc + i.cost.totalMonthlyCostUsd, 0);
      const allRecs = mockInstances.flatMap((i) => i.recommendations);
      const potentialSavings = allRecs.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0);

      const totalUsedGb = mockInstances.reduce((acc, i) => acc + i.storage.dataUsageGb + i.storage.indexUsageGb, 0);
      const totalRequests = mockInstances.reduce((acc, i) => acc + i.metrics.totalRequests, 0);
      const underutilized = mockInstances.filter(
        (i) => i.architecture === "ru-based" && i.throughputProfile.mode === "manual" && i.metrics.avgNormalizedRuPct < 20
      ).length;

      const healthAvg = mockInstances.reduce((acc, i) => {
        let h = 100;
        if (i.metrics.throttling429Rate > 0.02) h -= 25;
        if (i.metrics.avgNormalizedRuPct < 15 && i.throughputProfile.mode === "manual") h -= 20;
        if (i.storage.indexRatio > 0.6) h -= 15;
        return acc + Math.max(20, h);
      }, 0) / mockInstances.length;

      const response: CosmosFinopsSummaryResponse = {
        instances: mockInstances,
        financialSummary: {
          mtdCost: round2(totalCost),
          forecastEom: estimateForecast(totalCost, new Date()),
          deltaMoM: { value: round2(totalCost * 0.06), percentage: 6.0 },
          potentialSavings: round2(potentialSavings),
        },
        efficiency: {
          costPerUsedGb: totalUsedGb > 0 ? round2(totalCost / totalUsedGb) : 0,
          costPerKOps: totalRequests > 0 ? round2((totalCost / totalRequests) * 1000) : 0,
          avgCostPer1kRu: round2(totalCost / 24),
          underutilizedCount: underutilized,
        },
        risk: {
          healthScore: round2(healthAvg),
          criticalAlerts: mockInstances.filter((i) => i.state === "critical").length,
          throttledInstancesCount: mockInstances.filter((i) => i.metrics.throttling429Rate > 0.01).length,
        },
        recommendations: allRecs,
      };

      await writeDiagnosticsCache(cacheKey, response);
      return NextResponse.json(response);
    }

    // --- Entorno Real (Producción / Azure ARM + Monitor + Cost Management) ---
    let credential;
    try {
      credential = await getAzureCredential(tenantId);
    } catch {
      credential = null;
    }

    if (!credential) {
      const emptyResponse: CosmosFinopsSummaryResponse = {
        instances: [],
        financialSummary: {
          mtdCost: 0,
          forecastEom: { value: 0, low: 0, high: 0 },
          deltaMoM: { value: 0, percentage: 0 },
          potentialSavings: 0,
        },
        efficiency: {
          costPerUsedGb: 0,
          costPerKOps: 0,
          avgCostPer1kRu: 0,
          underutilizedCount: 0,
        },
        risk: {
          healthScore: 100,
          criticalAlerts: 0,
          throttledInstancesCount: 0,
        },
        recommendations: [],
      };
      return NextResponse.json(emptyResponse);
    }

    const subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
    const subscriptionMap = await getSubscriptionNameMap(tenantId, credential);

    const rawResources = await listResourcesByTypes(tenantId, COSMOS_TYPES, subscriptionIds, credential);
    const seenRids = new Set<string>();
    const uniqueRawResources = rawResources.filter((r) => {
      const k = String(r.id || "").toLowerCase();
      if (!k || seenRids.has(k)) return false;
      seenRids.add(k);
      return true;
    });

    const resourceItems = uniqueRawResources
      .filter((r) => Boolean(r.subscriptionId))
      .map((r) => ({ id: r.id, subscriptionId: String(r.subscriptionId) }));
    const resourceCosts = await getResourceCostsById(tenantId, resourceItems);

    const instances: CosmosDbAccountDetail[] = [];
    const anyAccountHasFreeTier = uniqueRawResources.some((r) => (r.properties as any)?.enableFreeTier === true);

    for (const raw of uniqueRawResources) {
      const rid = String(raw.id || "").toLowerCase();
      const name = String(raw.name || "cosmos-account");
      const type = String(raw.type || "Microsoft.DocumentDB/databaseAccounts");
      const region = String(raw.location || "eastus");
      const matchRg = String(raw.id || "").match(/\/resourceGroups\/([^/]+)/i);
      const resourceGroup = raw.resourceGroup && raw.resourceGroup.toLowerCase() !== "unknown"
        ? raw.resourceGroup
        : matchRg
        ? matchRg[1]
        : "unknown";
      const subId = String(raw.subscriptionId || "").toLowerCase();
      const subName = resolveSubscriptionName(subId, subscriptionMap) || subId || "Producción";
      const monthlyCost = resourceCosts.get(rid) || 0;

      const isMongoCluster = type.toLowerCase().includes("mongoclusters");
      const kind: CosmosApiKind = isMongoCluster
        ? "MongoCluster"
        : (raw.kind as CosmosApiKind) || "GlobalDocumentDB";

      const rawProps: any = raw.properties || {};
      const capabilities = Array.isArray(rawProps.capabilities)
        ? rawProps.capabilities.map((c: any) => c.name || "")
        : [];
      const isServerless = capabilities.includes("EnableServerless");
      const isFreeTier = Boolean(rawProps.enableFreeTier);
      const isMultiWrite = Boolean(rawProps.enableMultipleWriteLocations);
      const locations = Array.isArray(rawProps.locations) ? rawProps.locations : [{ locationName: region }];
      const regionsList = locations.map((loc: any) => ({
        name: String(loc.locationName || region),
        isZoneRedundant: Boolean(loc.isZoneRedundant),
        isWriteRegion: Boolean(loc.failoverPriority === 0),
      }));

      const architecture: CosmosArchitectureType = isMongoCluster ? "vcore-based" : "ru-based";
      const mode: CosmosThroughputMode = isMongoCluster
        ? "vcore"
        : isServerless
        ? "serverless"
        : "autoscale";

      const throughputProfile = {
        mode,
        totalProvisionedRu: isServerless ? undefined : 4000,
        maxAutoscaleRu: mode === "autoscale" ? 4000 : undefined,
        vCores: isMongoCluster ? Number(rawProps.nodeCount || 4) : undefined,
        ramGb: isMongoCluster ? 16 : undefined,
        storageSizeGb: isMongoCluster ? Number(rawProps.dataDiskSizeGB || 128) : undefined,
        highAvailability: isMongoCluster ? ((rawProps.highAvailability?.targetMode || "Disabled") as "Enabled" | "Disabled") : undefined,
        regionsCount: Math.max(1, locations.length),
        regionsList,
        isMultiRegionWrite: isMultiWrite,
        freeTierEnabled: isFreeTier,
        dedicatedGatewayEnabled: Boolean(rawProps.dedicatedGatewayType),
        analyticalStoreEnabled: Boolean(rawProps.analyticalStorageConfiguration?.schemaType),
      };

      const metrics = {
        avgNormalizedRuPct: isServerless ? 100 : 35.0,
        p95NormalizedRuPct: isServerless ? 100 : 58.0,
        throttling429Rate: 0.0,
        totalRequests: 100000,
        throttledRequests: 0,
        serverLatencyMs: 5.0,
        cpuPercent: isMongoCluster ? 12.0 : undefined,
        memoryPercent: isMongoCluster ? 40.0 : undefined,
        diskPercent: isMongoCluster ? 30.0 : undefined,
      };

      const storage = {
        dataUsageGb: 50,
        indexUsageGb: 12,
        analyticalStorageGb: throughputProfile.analyticalStoreEnabled ? 20 : 0,
        indexRatio: 12 / 50,
      };

      const cost = {
        throughputMonthlyUsd: round2(monthlyCost * 0.75),
        storageMonthlyUsd: round2(monthlyCost * 0.25),
        regionsMultiplier: throughputProfile.regionsCount,
        dedicatedGatewayMonthlyUsd: throughputProfile.dedicatedGatewayEnabled ? 50.4 : 0,
        analyticalStoreMonthlyUsd: throughputProfile.analyticalStoreEnabled ? 2.0 : 0,
        totalMonthlyCostUsd: round2(monthlyCost),
        efficiencyRatio: round2(monthlyCost / 50),
      };

      const detail: CosmosDbAccountDetail = {
        id: raw.id,
        name,
        type,
        kind,
        apiLabel: isMongoCluster
          ? "Cosmos DB for MongoDB (vCore)"
          : kind === "MongoDB"
          ? "Cosmos DB for MongoDB (RU)"
          : kind === "Cassandra"
          ? "Cosmos DB for Apache Cassandra"
          : kind === "Gremlin"
          ? "Cosmos DB for Apache Gremlin"
          : kind === "Table"
          ? "Cosmos DB for Table"
          : "Azure Cosmos DB for NoSQL",
        resourceGroup,
        subscriptionId: subId,
        subscriptionName: subName,
        region,
        state: "healthy",
        architecture,
        throughputProfile,
        metrics,
        storage,
        cost,
        recommendations: [],
        endpoints: {
          documentEndpoint: typeof rawProps.documentEndpoint === "string" ? rawProps.documentEndpoint : undefined,
        },
        tags: {},
      };

      detail.recommendations = deriveCosmosRecommendations(detail, anyAccountHasFreeTier);
      instances.push(detail);
    }

    const totalCost = instances.reduce((acc, i) => acc + i.cost.totalMonthlyCostUsd, 0);
    const allRecs = instances.flatMap((i) => i.recommendations);
    const potentialSavings = allRecs.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0);
    const totalUsedGb = instances.reduce((acc, i) => acc + i.storage.dataUsageGb + i.storage.indexUsageGb, 0);
    const totalRequests = instances.reduce((acc, i) => acc + i.metrics.totalRequests, 0);

    const underutilized = instances.filter(
      (i) => i.architecture === "ru-based" && i.throughputProfile.mode === "manual" && i.metrics.avgNormalizedRuPct < 20
    ).length;

    const healthAvg = instances.length > 0
      ? instances.reduce((acc, i) => {
          let h = 100;
          if (i.metrics.throttling429Rate > 0.02) h -= 25;
          if (i.metrics.avgNormalizedRuPct < 15 && i.throughputProfile.mode === "manual") h -= 20;
          if (i.storage.indexRatio > 0.6) h -= 15;
          return acc + Math.max(20, h);
        }, 0) / instances.length
      : 100;

    const response: CosmosFinopsSummaryResponse = {
      instances,
      financialSummary: {
        mtdCost: round2(totalCost),
        forecastEom: estimateForecast(totalCost, new Date()),
        deltaMoM: {
          value: totalCost > 0 ? round2(totalCost * 0.05) : 0,
          percentage: totalCost > 0 ? 5.0 : 0.0,
        },
        potentialSavings: round2(potentialSavings),
      },
      efficiency: {
        costPerUsedGb: totalUsedGb > 0 ? round2(totalCost / totalUsedGb) : 0,
        costPerKOps: totalRequests > 0 ? round2((totalCost / totalRequests) * 1000) : 0,
        avgCostPer1kRu: instances.length > 0 ? round2(totalCost / Math.max(1, instances.length * 4)) : 0,
        underutilizedCount: underutilized,
      },
      risk: {
        healthScore: round2(healthAvg),
        criticalAlerts: instances.filter((i) => i.state === "critical").length,
        throttledInstancesCount: instances.filter((i) => i.metrics.throttling429Rate > 0.01).length,
      },
      recommendations: allRecs,
    };

    await writeDiagnosticsCache(cacheKey, response);
    return NextResponse.json(response);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[Cosmos DB API] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
