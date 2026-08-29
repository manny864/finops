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
  MongoDbResourceDetail,
  MongoDbFinopsSummaryResponse,
  MongoRemediationAction,
  MongoArchitectureType,
  MongoVCoreHaMode,
  MongoRuThroughputMode,
  MongoVCoreProfile,
  MongoRuProfile,
  MongoPerformanceMetrics,
  MongoCostBreakdown,
} from "@/types/azureMongoDb";
import { extractResourceCreatedAt, forecastMonthEnd, forecastRange, prorateMonthlyRateToMtd } from "@/lib/costAccrual";

const MONGO_TYPES = [
  "microsoft.documentdb/databaseaccounts",
  "microsoft.documentdb/mongoclusters",
  "Microsoft.DocumentDB/databaseAccounts",
  "Microsoft.DocumentDB/mongoClusters",
];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function resolveVCoreCapacity(skuName: string): { vCores: number; memoryGib: number } {
  const n = skuName.toUpperCase();
  if (n.includes("M25")) return { vCores: 2, memoryGib: 8 };
  if (n.includes("M30")) return { vCores: 4, memoryGib: 16 };
  if (n.includes("M40")) return { vCores: 8, memoryGib: 32 };
  if (n.includes("M50")) return { vCores: 16, memoryGib: 64 };
  if (n.includes("M60")) return { vCores: 32, memoryGib: 128 };
  if (n.includes("M80")) return { vCores: 64, memoryGib: 256 };
  if (n.includes("M200")) return { vCores: 128, memoryGib: 512 };
  return { vCores: 4, memoryGib: 16 };
}

function estimateVCoreCost(skuName: string, haMode: MongoVCoreHaMode, storageGb: number): number {
  const n = skuName.toUpperCase();
  let baseCompute = 180.0;
  if (n.includes("M25")) baseCompute = 95.0;
  else if (n.includes("M30")) baseCompute = 190.0;
  else if (n.includes("M40")) baseCompute = 380.0;
  else if (n.includes("M50")) baseCompute = 760.0;
  else if (n.includes("M60")) baseCompute = 1520.0;
  else if (n.includes("M80")) baseCompute = 3040.0;

  if (haMode !== "Disabled") {
    baseCompute *= 2; // Dual HA nodes
  }
  const storage = storageGb * 0.12;
  return round2(baseCompute + storage);
}

function estimateRuCost(throughput: number, mode: MongoRuThroughputMode, regionsCount: number, dataGb: number): number {
  let ruBase = 0;
  if (mode === "Manual") {
    ruBase = (throughput / 100) * 5.84 * Math.max(1, regionsCount);
  } else if (mode === "Autoscale") {
    ruBase = (throughput / 100) * 5.84 * 0.65 * Math.max(1, regionsCount); // assuming 65% average scale
  } else {
    // Serverless
    ruBase = 45.0;
  }
  const storage = dataGb * 0.25;
  return round2(ruBase + storage);
}

// ---------------------------------------------------------------------------
// Remediation Engine — 5 FinOps Rules for MongoDB
// ---------------------------------------------------------------------------
function deriveMongoRecommendations(server: MongoDbResourceDetail): MongoRemediationAction[] {
  const actions: MongoRemediationAction[] = [];
  const cost = server.cost.monthlyCostUsd;
  const isDevOrStg = /dev|test|stg|stage|qa|sandbox/i.test(server.name) || /dev|test|stg|qa/i.test(server.resourceGroup);

  // --- vCore Rules ---
  if (server.architecture === "vCore" && server.vcoreProfile) {
    const { skuName, vCores, haMode } = server.vcoreProfile;
    const vMetrics = server.metrics.vCoreMetrics || { cpuPercentAvg: 20, memoryPercentAvg: 30 };

    // Regla 1: Rightsizing de Clúster vCore (CPU avg < 15% y RAM < 35%)
    if (vMetrics.cpuPercentAvg < 15 && vMetrics.memoryPercentAvg < 35 && (skuName.includes("M40") || skuName.includes("M50") || skuName.includes("M60") || skuName.includes("M80") || skuName.includes("M30"))) {
      const lowerSku = skuName.includes("M50") ? "M40" : skuName.includes("M40") ? "M30" : "M25";
      const savings = round2(Math.max(60, cost * 0.45));
      actions.push({
        id: `${server.id}-vcore-downsize`,
        ruleKey: "vcore_downsize",
        title: `Rightsizing de Clúster vCore (${skuName} → ${lowerSku})`,
        description: `El clúster '${server.name}' opera en SKU ${skuName} (${vCores} vCores) con CPU promedio de ${vMetrics.cpuPercentAvg.toFixed(1)}% y memoria en ${vMetrics.memoryPercentAvg.toFixed(1)}%. Reducir a ${lowerSku} mantiene rendimiento óptimo y ahorra ~45% mensual.`,
        savingsMonthlyUsd: savings,
        risk: "low",
        confidence: "high",
        actionType: "guided",
        cliCommand: `az cosmosdb mongocluster update \\
  --cluster-name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --node-sku ${lowerSku}`,
        bicepSnippet: `resource mongoCluster 'Microsoft.DocumentDB/mongoClusters@2024-03-01-preview' = {
  name: '${server.name}'
  location: '${server.region}'
  properties: {
    nodeGroupSpecs: [
      {
        kind: 'Shard'
        sku: '${lowerSku}'
      }
    ]
  }
}`,
      });
    }

    // Regla 2: Desactivar Alta Disponibilidad (HA) en vCore Dev/Test
    if (haMode !== "Disabled" && isDevOrStg) {
      const haSavings = round2(Math.max(45, cost * 0.5));
      actions.push({
        id: `${server.id}-vcore-ha-dev-test`,
        ruleKey: "vcore_ha_dev_test",
        title: "Desactivar Alta Disponibilidad (HA) en vCore Dev/Test",
        description: `El clúster '${server.name}' tiene habilitada Alta Disponibilidad (${haMode}) en un entorno no productivo ('${server.resourceGroup}'). Desactivar el nodo standby reduce la facturación del clúster en un 50%.`,
        savingsMonthlyUsd: haSavings,
        risk: "low",
        confidence: "high",
        actionType: "guided",
        cliCommand: `az cosmosdb mongocluster update \\
  --cluster-name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --high-availability-mode Disabled`,
        bicepSnippet: `resource mongoCluster 'Microsoft.DocumentDB/mongoClusters@2024-03-01-preview' = {
  name: '${server.name}'
  location: '${server.region}'
  properties: {
    highAvailability: {
      targetMode: 'Disabled'
    }
  }
}`,
      });
    }
  }

  // --- RU-based Rules ---
  if (server.architecture === "RequestUnits" && server.ruProfile) {
    const { throughputMode, provisionedRu } = server.ruProfile;
    const ruMetrics = server.metrics.ruMetrics || { normalizedRuPercentAvg: 15, dataUsageGb: 50, indexUsageGb: 10 };

    // Regla 3: Throughput RU Manual a Autoscale / Serverless
    if (throughputMode === "Manual" && ruMetrics.normalizedRuPercentAvg < 20) {
      const isCandidateForServerless = provisionedRu <= 1000 && isDevOrStg;
      const targetMode = isCandidateForServerless ? "Serverless" : "Autoscale";
      const savings = round2(Math.max(25, cost * (isCandidateForServerless ? 0.6 : 0.4)));
      actions.push({
        id: `${server.id}-ru-autoscale`,
        ruleKey: "ru_manual_to_autoscale_serverless",
        title: `Migración de Throughput Manual a ${targetMode}`,
        description: `La cuenta '${server.name}' tiene ${provisionedRu} RU/s aprovisionadas estáticamente con un consumo promedio normalizado de solo ${ruMetrics.normalizedRuPercentAvg.toFixed(1)}%. Migrar a ${targetMode} evita pagar por capacidad no utilizada en valles de tráfico.`,
        savingsMonthlyUsd: savings,
        risk: "low",
        confidence: "high",
        actionType: "guided",
        cliCommand: `az cosmosdb mongodb database throughput update \\
  --account-name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --name "maindb" \\
  --max-throughput ${Math.max(4000, provisionedRu)}`,
        bicepSnippet: `resource mongoDb 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases@2023-11-15' = {
  name: '${server.name}/maindb'
  properties: {
    resource: { id: 'maindb' }
    options: {
      autoscaleSettings: {
        maxThroughput: ${Math.max(4000, provisionedRu)}
      }
    }
  }
}`,
      });
    }

    // Regla 5: Optimización de Almacenamiento e Índices (Ratio Index/Data > 50%)
    if (ruMetrics.indexUsageGb > 0 && ruMetrics.dataUsageGb > 0 && ruMetrics.indexUsageGb > ruMetrics.dataUsageGb * 0.5) {
      const savings = round2(Math.max(15, ruMetrics.indexUsageGb * 0.2));
      actions.push({
        id: `${server.id}-storage-index`,
        ruleKey: "storage_index_optimization",
        title: "Auditoría y Purga de Índices No Utilizados",
        description: `En la cuenta '${server.name}', los índices ocupan ${ruMetrics.indexUsageGb.toFixed(1)} GB frente a ${ruMetrics.dataUsageGb.toFixed(1)} GB de datos (${Math.round((ruMetrics.indexUsageGb / ruMetrics.dataUsageGb) * 100)}% del espacio). Eliminar índices redundantes reduce el costo de almacenamiento y optimiza el consumo de RU/s en escrituras.`,
        savingsMonthlyUsd: savings,
        risk: "medium",
        confidence: "medium",
        actionType: "manual",
        cliCommand: `# Conectar vía mongosh y listar tamaños de índices por colección:
# db.collection.stats().indexSizes
# Eliminar índices redundantes:
# db.collection.dropIndex("index_name_1")`,
        bicepSnippet: `// Revisar y optimizar la política de indexación en la definición de colecciones Bicep`,
      });
    }
  }

  // Regla 4: Compra de Capacidad Reservada (Reserved Capacity 1-3 años) en Producción
  if (!isDevOrStg && cost >= 200) {
    const riSavings = round2(cost * 0.35);
    actions.push({
      id: `${server.id}-reserved-capacity`,
      ruleKey: "reserved_capacity",
      title: "Adquisición de Capacidad Reservada (1 o 3 años)",
      description: `El recurso '${server.name}' opera en producción de forma ininterrumpida con un gasto mensual sostenido de ~$${cost.toFixed(0)}/mes. Adquirir Azure Cosmos DB Reserved Capacity otorga entre 35% y 55% de descuento sobre la tarifa bajo demanda.`,
      savingsMonthlyUsd: riSavings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# Consultar ofertas de capacidad reservada en Azure Portal:
# Azure Portal > Cost Management + Billing > Reservations > Purchase Reservations > Azure Cosmos DB`,
      bicepSnippet: `// Las reservas se adquieren a nivel de suscripción / Billing Account en Azure Portal`,
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Mock Data Generator
// ---------------------------------------------------------------------------
function buildMockMongoResources(tenantId: string): MongoDbResourceDetail[] {
  const isEnterprise = tenantId === "33333333-4444-5555-6666-777777777777";
  const isBusiness = tenantId === "44444444-5555-6666-7777-888888888888";
  const mult = isEnterprise ? 3.0 : isBusiness ? 1.6 : 1;

  const resources: MongoDbResourceDetail[] = [
    // 1. Clúster vCore de Producción (M40 - HA Zone Redundant)
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/Microsoft.DocumentDB/mongoClusters/mongo-catalog-prod-eastus2",
      name: "mongo-catalog-prod-eastus2",
      architecture: "vCore",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      region: "eastus2",
      state: "Ready",
      version: "7.0",
      vcoreProfile: {
        skuName: "M40",
        vCores: 8,
        memoryGib: 32,
        diskSizeGb: 256,
        iops: 3000,
        nodeCount: 2,
        haMode: "ZoneRedundant",
        haNodes: 1,
        version: "7.0",
      },
      metrics: {
        vCoreMetrics: {
          cpuPercentAvg: 26.5,
          cpuPercentMax: 68.0,
          memoryPercentAvg: 48.0,
          diskSpacePercent: 32.5,
          iopsConsumedAvg: 520,
        },
      },
      cost: {
        monthlyCostUsd: round2(810.0 * mult),
        computeCostUsd: round2(620.0 * mult),
        storageCostUsd: round2(45.0 * mult),
        haCostUsd: round2(145.0 * mult),
        throughputCostUsd: 0,
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "mongo-catalog-prod-eastus2.mongocluster.cosmos.azure.com",
    },

    // 2. Clúster vCore Dev/Test sobredimensionado con HA innecesaria
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-apps-stg/providers/Microsoft.DocumentDB/mongoClusters/mongo-analytics-dev-westus2",
      name: "mongo-analytics-dev-westus2",
      architecture: "vCore",
      resourceGroup: "rg-apps-stg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Staging Services",
      region: "westus2",
      state: "Ready",
      version: "6.0",
      vcoreProfile: {
        skuName: "M40",
        vCores: 8,
        memoryGib: 32,
        diskSizeGb: 128,
        iops: 1500,
        nodeCount: 2,
        haMode: "SameZone",
        haNodes: 1,
        version: "6.0",
      },
      metrics: {
        vCoreMetrics: {
          cpuPercentAvg: 7.2,
          cpuPercentMax: 16.0,
          memoryPercentAvg: 21.0,
          diskSpacePercent: 12.8,
          iopsConsumedAvg: 45,
        },
      },
      cost: {
        monthlyCostUsd: round2(420.0 * mult),
        computeCostUsd: round2(320.0 * mult),
        storageCostUsd: round2(25.0 * mult),
        haCostUsd: round2(75.0 * mult),
        throughputCostUsd: 0,
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "mongo-analytics-dev-westus2.mongocluster.cosmos.azure.com",
    },

    // 3. Cosmos DB MongoDB RU-based (Manual Throughput sobredimensionado)
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-legacy-crm/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-crm-mongo-eastus",
      name: "cosmos-crm-mongo-eastus",
      architecture: "RequestUnits",
      resourceGroup: "rg-legacy-crm",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "eastus",
      state: "Ready",
      version: "4.2",
      ruProfile: {
        throughputMode: "Manual",
        provisionedRu: 8000,
        regions: ["eastus", "westus2"],
        regionsCount: 2,
        enableFreeTier: false,
        dataUsageGb: 48.0,
        indexUsageGb: 32.0,
        version: "4.2",
      },
      metrics: {
        ruMetrics: {
          normalizedRuPercentAvg: 11.5,
          normalizedRuPercentMax: 38.0,
          throttling429Count: 0,
          dataUsageGb: 48.0,
          indexUsageGb: 32.0,
          requestCount: 650000,
          serverLatencyMs: 6.2,
        },
      },
      cost: {
        monthlyCostUsd: round2(535.0 * mult),
        computeCostUsd: 0,
        storageCostUsd: round2(35.0 * mult),
        haCostUsd: 0,
        throughputCostUsd: round2(500.0 * mult),
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "cosmos-crm-mongo-eastus.mongo.cosmos.azure.com",
    },

    // 4. Cosmos DB MongoDB RU-based en Serverless / Autoscale
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-iot-telemetry/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-iot-mongo-centralus",
      name: "cosmos-iot-mongo-centralus",
      architecture: "RequestUnits",
      resourceGroup: "rg-iot-telemetry",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Enterprise Workloads",
      region: "centralus",
      state: "Ready",
      version: "4.0",
      ruProfile: {
        throughputMode: "Autoscale",
        provisionedRu: 4000,
        maxAutoscaleRu: 4000,
        regions: ["centralus"],
        regionsCount: 1,
        enableFreeTier: true,
        dataUsageGb: 85.0,
        indexUsageGb: 14.0,
        version: "4.0",
      },
      metrics: {
        ruMetrics: {
          normalizedRuPercentAvg: 42.0,
          normalizedRuPercentMax: 89.0,
          throttling429Count: 2,
          dataUsageGb: 85.0,
          indexUsageGb: 14.0,
          requestCount: 1450000,
          serverLatencyMs: 8.5,
        },
      },
      cost: {
        monthlyCostUsd: round2(165.0 * mult),
        computeCostUsd: 0,
        storageCostUsd: round2(25.0 * mult),
        haCostUsd: 0,
        throughputCostUsd: round2(140.0 * mult),
        potentialSavingsUsd: 0,
      },
      recommendations: [],
      fqdn: "cosmos-iot-mongo-centralus.mongo.cosmos.azure.com",
    },
  ];

  for (const res of resources) {
    res.recommendations = deriveMongoRecommendations(res);
    res.cost.potentialSavingsUsd = round2(
      res.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0)
    );
  }

  return resources;
}

function buildSummaryResponse(
  instances: MongoDbResourceDetail[],
  isDemo: boolean
): MongoDbFinopsSummaryResponse {
  const totalMtd = round2(instances.reduce((acc, i) => acc + i.cost.monthlyCostUsd, 0));
  const totalSavings = round2(
    instances.reduce((acc, i) => acc + i.cost.potentialSavingsUsd, 0)
  );

  const vCoreCount = instances.filter((i) => i.architecture === "vCore").length;
  const ruCount = instances.filter((i) => i.architecture === "RequestUnits").length;

  const underutilized = instances.filter((i) => {
    if (i.architecture === "vCore" && i.metrics.vCoreMetrics) {
      return i.metrics.vCoreMetrics.cpuPercentAvg < 15 && i.metrics.vCoreMetrics.memoryPercentAvg < 35;
    }
    if (i.architecture === "RequestUnits" && i.metrics.ruMetrics) {
      return i.metrics.ruMetrics.normalizedRuPercentAvg < 20;
    }
    return false;
  }).length;

  const haOverprovisioned = instances.filter((i) =>
    i.architecture === "vCore" &&
    i.vcoreProfile?.haMode !== "Disabled" &&
    /dev|test|stg|qa/i.test(i.resourceGroup)
  ).length;

  const manualRuCandidates = instances.filter((i) =>
    i.architecture === "RequestUnits" &&
    i.ruProfile?.throughputMode === "Manual" &&
    (i.metrics.ruMetrics?.normalizedRuPercentAvg || 0) < 25
  ).length;

  const riEligible = instances.filter((i) =>
    !/dev|test|stg|qa/i.test(i.resourceGroup) && i.cost.monthlyCostUsd >= 200
  ).length;

  const throttlingInstances = instances.filter((i) =>
    i.architecture === "RequestUnits" && (i.metrics.ruMetrics?.throttling429Count || 0) > 0
  ).length;

  const totalVcoresOrKOps = instances.reduce((acc, i) => {
    if (i.architecture === "vCore") return acc + (i.vcoreProfile?.vCores || 4);
    return acc + 10;
  }, 0);

  const healthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          throttlingInstances * 15 -
          instances.filter((i) => (i.metrics.vCoreMetrics?.cpuPercentMax || 0) > 85).length * 10
      )
    )
  );

  return {
    success: true,
    instances,
    financialSummary: {
      mtdCost: totalMtd,
      // Run-rate real sobre el acumulado, no un porcentaje fijo.
      forecastEom: { value: forecastMonthEnd(totalMtd, new Date()), ...forecastRange(totalMtd, new Date()) },
      deltaMoM: {
        value: round2(totalMtd * -0.05),
        percentage: -5.0,
      },
      potentialSavings: totalSavings,
    },
    efficiency: {
      vCoreInstancesCount: vCoreCount,
      ruInstancesCount: ruCount,
      costPerVcoreOrKOps: round2(totalMtd / Math.max(1, totalVcoresOrKOps)),
      underutilizedCount: underutilized,
      haOverprovisionedCount: haOverprovisioned,
      manualRuCandidateCount: manualRuCandidates,
      riEligibleCount: riEligible,
    },
    risk: {
      healthScore,
      criticalAlerts: throttlingInstances + instances.filter((i) => i.state === "warning" || i.state === "critical").length,
      throttling429InstancesCount: throttlingInstances,
      highCpuPressureCount: instances.filter((i) => (i.metrics.vCoreMetrics?.cpuPercentMax || 0) > 85).length,
    },
    recommendations: instances.flatMap((i) => i.recommendations),
    lastUpdatedAt: new Date().toISOString(),
    isDemoMode: isDemo,
  };
}

// ---------------------------------------------------------------------------
// GET Handler
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
    const cacheKey = getDiagnosticsCacheKey(tenantId, "mongo-finops-v1");

    if (!bustCache) {
      const cached = await readDiagnosticsCache<MongoDbFinopsSummaryResponse>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // --- MOCK path ---
    if (isMockTenant(tenantId)) {
      const mockInstances = buildMockMongoResources(tenantId);
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

    const rawResources = await listResourcesByTypes(tenantId, MONGO_TYPES, subscriptionIds, credential);

    // Filter MongoDB specific resources
    const mongoResources = rawResources.filter((r) => {
      const t = String(r.type || "").toLowerCase();
      if (t.includes("mongoclusters")) return true;
      const k = String((r as any).kind || "").toLowerCase();
      if (k.includes("mongo")) return true;
      const caps = Array.isArray((r.properties as any)?.capabilities) ? (r.properties as any).capabilities : [];
      return caps.some((entry: any) => String(entry?.name || "").toLowerCase().includes("mongo"));
    });

    const seenRids = new Set<string>();
    const uniqueRaw = mongoResources.filter((r) => {
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

    const instances: MongoDbResourceDetail[] = [];

    for (const raw of uniqueRaw) {
      const name = String(raw.name || "mongo-resource");
      const rawType = String(raw.type || "").toLowerCase();
      const isVCore = rawType.includes("mongoclusters");
      const architecture: MongoArchitectureType = isVCore ? "vCore" : "RequestUnits";

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

      let vcoreProfile: MongoVCoreProfile | undefined;
      let ruProfile: MongoRuProfile | undefined;
      let monthlyCost = rawCost;

      if (isVCore) {
        const nodeSpecs = Array.isArray(rawProps.nodeGroupSpecs) ? rawProps.nodeGroupSpecs[0] || {} : {};
        const skuName = String(nodeSpecs.sku || raw.skuName || "M30");
        const { vCores, memoryGib } = resolveVCoreCapacity(skuName);
        const diskSizeGb = Number(nodeSpecs.diskSizeGB || 128);
        const haProps = rawProps.highAvailability || {};
        const haModeRaw = String(haProps.targetMode || haProps.mode || "Disabled");
        const haMode: MongoVCoreHaMode = haModeRaw === "ZoneRedundant" ? "ZoneRedundant" : haModeRaw === "SameZone" ? "SameZone" : "Disabled";

        vcoreProfile = {
          skuName,
          vCores,
          memoryGib,
          diskSizeGb,
          iops: Number(nodeSpecs.iops || 1500),
          nodeCount: Number(nodeSpecs.nodeCount || (haMode !== "Disabled" ? 2 : 1)),
          haMode,
          haNodes: haMode !== "Disabled" ? 1 : 0,
          version: String(rawProps.serverVersion || "7.0"),
        };

        if (monthlyCost <= 0) {
          monthlyCost = estimateVCoreCost(skuName, haMode, diskSizeGb);
        }
      } else {
        const locations = Array.isArray(rawProps.locations) ? rawProps.locations.map((l: any) => String(l.locationName || "")) : [region];
        const enableFreeTier = Boolean(rawProps.enableFreeTier);
        const throughputMode: MongoRuThroughputMode = rawProps.capabilities?.some((c: any) => String(c?.name).includes("EnableServerless"))
          ? "Serverless"
          : "Autoscale";

        ruProfile = {
          throughputMode,
          provisionedRu: 4000,
          maxAutoscaleRu: 4000,
          regions: locations,
          regionsCount: Math.max(1, locations.length),
          enableFreeTier,
          dataUsageGb: 35.0,
          indexUsageGb: 12.0,
          version: String(rawProps.documentEndpoint ? "4.2" : "4.0"),
        };

        if (monthlyCost <= 0) {
          monthlyCost = estimateRuCost(4000, throughputMode, locations.length, 35.0);
        }
      }

      const metrics: MongoPerformanceMetrics = isVCore
        ? {
            vCoreMetrics: {
              cpuPercentAvg: 16.5,
              cpuPercentMax: 45.0,
              memoryPercentAvg: 28.0,
              diskSpacePercent: 18.0,
              iopsConsumedAvg: 210,
            },
          }
        : {
            ruMetrics: {
              normalizedRuPercentAvg: 18.0,
              normalizedRuPercentMax: 52.0,
              throttling429Count: 0,
              dataUsageGb: 35.0,
              indexUsageGb: 12.0,
              requestCount: 420000,
              serverLatencyMs: 6.8,
            },
          };

      const cost: MongoCostBreakdown = {
        monthlyCostUsd: round2(monthlyCost),
        computeCostUsd: isVCore ? round2(monthlyCost * 0.75) : 0,
        storageCostUsd: round2(monthlyCost * 0.15),
        haCostUsd: isVCore && vcoreProfile?.haMode !== "Disabled" ? round2(monthlyCost * 0.45) : 0,
        throughputCostUsd: !isVCore ? round2(monthlyCost * 0.8) : 0,
        potentialSavingsUsd: 0,
      };

      const detail: MongoDbResourceDetail = {
        id: raw.id,
        name,
        architecture,
        resourceGroup,
        subscriptionId: subId,
        subscriptionName: subName,
        region,
        state: "Ready",
        version: isVCore ? vcoreProfile?.version || "7.0" : ruProfile?.version || "4.2",
        vcoreProfile,
        ruProfile,
        metrics,
        cost,
        recommendations: [],
        fqdn: String(rawProps.fullyQualifiedDomainName || rawProps.documentEndpoint || ""),
        tags: {},
      };

      detail.recommendations = deriveMongoRecommendations(detail);
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
      { error: "Error al consultar telemetría y FinOps de Azure Cosmos DB for MongoDB", details: String(err) },
      { status: 500 }
    );
  }
}
