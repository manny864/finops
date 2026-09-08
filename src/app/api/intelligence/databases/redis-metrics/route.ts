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
import { cappedMonthlySavings, extractResourceCreatedAt, forecastMonthEnd, forecastRange, monthlyRunRate } from "@/lib/costAccrual";
import {
  RedisCacheDetail,
  RedisFinopsSummaryResponse,
  RedisRemediationAction,
  RedisSkuProfile,
} from "@/types/redisCache";
import { getAzureResourceMetricsSummary } from "@/lib/computeMetricsShared";

const REDIS_TYPES = [
  "microsoft.cache/redis",
  "microsoft.cache/redisenterprise",
  "Microsoft.Cache/Redis",
  "Microsoft.Cache/redisEnterprise",
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Proyección a fin de mes por run-rate sobre el acumulado real.
 *
 * Antes hacía `(mtdCost / diaDelMes) * diasDelMes` con banda fija del 8%. Con
 * el estimado de SKU cayendo como respaldo, ese `mtdCost` era la tarifa
 * MENSUAL completa, así que el día 1 la proyección salía ~30x el gasto real.
 * `createdAt` acota el run-rate a la vida del recurso.
 */
function estimateForecast(
  mtdCost: number,
  asOf: Date,
  createdAt?: Date | null,
): { value: number; low: number; high: number } {
  const value = forecastMonthEnd(mtdCost, asOf, createdAt);
  const { low, high } = forecastRange(mtdCost, asOf, createdAt);
  return { value, low, high };
}

function getNominalMemoryMb(skuName: string, capacity: number): number {
  const name = skuName.toLowerCase();
  if (name.includes("c0")) return 250;
  if (name.includes("c1")) return 1024;
  if (name.includes("c2")) return 2560;
  if (name.includes("c3")) return 6144;
  if (name.includes("c4")) return 13312;
  if (name.includes("c5")) return 26624;
  if (name.includes("c6")) return 54272;
  if (name.includes("p1")) return 6144;
  if (name.includes("p2")) return 13312;
  if (name.includes("p3")) return 26624;
  if (name.includes("p4")) return 54272;
  if (name.includes("p5")) return 122880;
  if (name.includes("b3") || name.includes("balanced_b3")) return 1024;
  if (name.includes("b5") || name.includes("balanced_b5")) return 2048;
  if (name.includes("b10") || name.includes("balanced_b10")) return 4096;
  return Math.max(1024, capacity * 1024);
}

export function estimateRedisMonthlyCost(
  skuName: string,
  skuFamily: string,
  capacity: number,
  isEnterprise: boolean
): number {
  const name = skuName.toLowerCase();
  const cap = Math.max(1, capacity || 1);

  // Enterprise Tiers
  if (isEnterprise || name.includes("enterprise") || name.includes("balanced")) {
    if (name.includes("b3") || name.includes("balanced_b3")) return round2(292.00 * cap);
    if (name.includes("b5") || name.includes("balanced_b5")) return round2(460.00 * cap);
    if (name.includes("b10") || name.includes("balanced_b10")) return round2(720.00 * cap);
    if (name.includes("b20") || name.includes("balanced_b20")) return round2(1440.00 * cap);
    if (name.includes("b50") || name.includes("balanced_b50")) return round2(2880.00 * cap);
    if (name.includes("b100") || name.includes("balanced_b100")) return round2(5760.00 * cap);
    if (name.includes("b250") || name.includes("balanced_b250")) return round2(11520.00 * cap);
    if (name.includes("b500") || name.includes("balanced_b500")) return round2(23040.00 * cap);
    if (name.includes("b1000") || name.includes("balanced_b1000")) return round2(46080.00 * cap);
    if (name.includes("m10") || name.includes("memoryoptimized_m10")) return round2(980.00 * cap);
    if (name.includes("m20") || name.includes("memoryoptimized_m20")) return round2(1960.00 * cap);
    if (name.includes("m50") || name.includes("memoryoptimized_m50")) return round2(3920.00 * cap);
    if (name.includes("c5") || name.includes("computeoptimized_c5")) return round2(490.00 * cap);
    if (name.includes("c10") || name.includes("computeoptimized_c10")) return round2(980.00 * cap);
    if (name.includes("c20") || name.includes("computeoptimized_c20")) return round2(1960.00 * cap);
    return round2(292.00 * cap);
  }

  const fam = skuFamily.toUpperCase();
  // Premium Tier
  if (fam === "PREMIUM" || name.includes("premium") || name.includes("p")) {
    if (name.includes("p1")) return round2(438.00 * cap);
    if (name.includes("p2")) return round2(876.00 * cap);
    if (name.includes("p3")) return round2(1752.00 * cap);
    if (name.includes("p4")) return round2(3504.00 * cap);
    if (name.includes("p5")) return round2(7008.00 * cap);
    return round2(438.00 * cap);
  }

  // Standard Tier
  if (fam === "STANDARD" || name.includes("standard")) {
    if (name.includes("c0")) return round2(32.12 * cap);
    if (name.includes("c1")) return round2(80.30 * cap);
    if (name.includes("c2")) return round2(160.60 * cap);
    if (name.includes("c3")) return round2(321.20 * cap);
    if (name.includes("c4")) return round2(642.40 * cap);
    if (name.includes("c5")) return round2(1284.80 * cap);
    if (name.includes("c6")) return round2(2569.60 * cap);
    return round2(80.30 * cap);
  }

  // Basic Tier
  if (name.includes("c0")) return round2(16.06 * cap);
  if (name.includes("c1")) return round2(40.15 * cap);
  if (name.includes("c2")) return round2(80.30 * cap);
  if (name.includes("c3")) return round2(160.60 * cap);
  if (name.includes("c4")) return round2(321.20 * cap);
  if (name.includes("c5")) return round2(642.40 * cap);
  if (name.includes("c6")) return round2(1284.80 * cap);
  return round2(40.15 * cap);
}

function deriveRedisRecommendations(instance: RedisCacheDetail): RedisRemediationAction[] {
  const actions: RedisRemediationAction[] = [];
  // Tarifa MENSUAL, no el acumulado: "downgrade ahorra X" es una cifra por mes,
  // y los umbrales (`cost > 3`) no se disparan con el acumulado de día 2.
  const cost = instance.cost.monthlyRateUsd ?? instance.cost.monthlyCostUsd;
  const nameLower = instance.name.toLowerCase();
  const rgLower = instance.resourceGroup.toLowerCase();
  const isDevOrStg =
    nameLower.includes("stg") ||
    nameLower.includes("stage") ||
    nameLower.includes("dev") ||
    nameLower.includes("test") ||
    rgLower.includes("stg") ||
    rgLower.includes("dev");

  // Regla 1: Staging Overkill (Rightsizing de Tier en Staging/Dev)
  if (
    cost > 5 &&
    isDevOrStg &&
    (instance.skuProfile.family.includes("Enterprise") ||
      instance.skuProfile.family.includes("Premium") ||
      instance.skuProfile.name.includes("Balanced_B3") ||
      instance.skuProfile.name.includes("P1")) &&
    instance.metrics.usedMemoryMb < 250
  ) {
    const savings = round2(cost * 0.58);
    actions.push({
      id: `${instance.id}-staging-overkill`,
      ruleKey: "staging_overkill_rightsizing",
      params: {
        name: instance.name,
        sku: instance.skuProfile.name,
        usedMb: instance.metrics.usedMemoryMb.toFixed(2),
        ratioPct: instance.metrics.usedMemoryRatioPct.toFixed(1),
      },
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `az redis update \\
  --name ${instance.name} \\
  --resource-group ${instance.resourceGroup} \\
  --sku Basic \\
  --vm-size C1`,
      bicepSnippet: `resource redisCache 'Microsoft.Cache/redis@2024-03-01' = {
  name: '${instance.name}'
  location: '${instance.region}'
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 1
    }
    enableNonSslPort: false
  }
}`,
    });
  }

  // Regla 2: Instancia Ociosa / Zombie (< 5 ops/s y 0-1 clientes)
  if (
    instance.metrics.operationsPerSecond < 5 &&
    instance.metrics.connectedClients <= 1 &&
    cost > 3
  ) {
    actions.push({
      id: `${instance.id}-zombie-cache`,
      ruleKey: "idle_zombie_instance",
      params: { clients: instance.metrics.connectedClients },
      savingsMonthlyUsd: round2(cost),
      risk: "medium",
      confidence: "high",
      actionType: "manual",
      cliCommand: `# {{cmt.deleteIdleInstance}}
az redis delete \\
  --name ${instance.name} \\
  --resource-group ${instance.resourceGroup} \\
  --yes`,
    });
  }

  // Regla 3: Optimización de Cache Hit Rate Ineficiente (<30% de Hit Rate)
  if (
    typeof instance.metrics.hitRatePercentage === "number" &&
    instance.metrics.hitRatePercentage < 30 &&
    instance.metrics.cacheHits + instance.metrics.cacheMisses > 500
  ) {
    actions.push({
      id: `${instance.id}-hit-rate-inefficient`,
      ruleKey: "inefficient_hit_rate",
      params: {
        hitRate: (instance.metrics.hitRatePercentage ?? 0).toFixed(2),
        missRate: (instance.metrics.missRatePercentage ?? 0).toFixed(2),
      },
      savingsMonthlyUsd: round2(cost * 0.2),
      risk: "low",
      confidence: "medium",
      actionType: "guided",
      cliCommand: `# {{cmt.reviewMaxmemoryPolicy}}
az redis update \\
  --name ${instance.name} \\
  --resource-group ${instance.resourceGroup} \\
  --set redisConfiguration.maxmemory-policy=allkeys-lru`,
      bicepSnippet: `resource redisCache 'Microsoft.Cache/redis@2024-03-01' = {
  name: '${instance.name}'
  properties: {
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
    }
  }
}`,
    });
  }

  // Regla 4: Cobertura con Redis Reserved Capacity (1 o 3 años)
  if (
    !isDevOrStg &&
    (instance.skuProfile.family === "Standard" ||
      instance.skuProfile.family === "Premium" ||
      instance.skuProfile.family.includes("Enterprise")) &&
    cost >= 8
  ) {
    const savings = round2(cost * 0.38);
    actions.push({
      id: `${instance.id}-reserved-capacity`,
      ruleKey: "reserved_capacity_coverage",
      params: {},
      savingsMonthlyUsd: savings,
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# {{cmt.quoteRedisReservation}}
az reservations reservation-order calculate \\
  --sku-name "Redis_Cache_Reservation" \\
  --billing-scope "/subscriptions/${instance.subscriptionId}"`,
    });
  }

  return actions;
}

// Los comentarios de los scripts viajan como marcadores (ver el formato en
// src/lib/scriptComments.ts) y los resuelve el cliente. Igual que el titulo y la
// descripcion: el payload lleva la clave, no la frase, asi el cache
// (`getDiagnosticsCacheKey`, que no incluye el locale) sigue siendo valido.
function buildMockRedisInstances(tenantId: string): RedisCacheDetail[] {
  const isEnterprise = tenantId === "33333333-4444-5555-6666-777777777777";
  const mult = isEnterprise ? 2.5 : 1.0;

  const instances: RedisCacheDetail[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-finops-prod-westus2-rg/providers/Microsoft.Cache/redisEnterprise/cscs-finops-prod-westus2-redis",
      name: "cscs-finops-prod-westus2-redis",
      type: "Microsoft.Cache/redisEnterprise",
      resourceGroup: "cscs-finops-prod-westus2-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "westus2",
      state: "healthy",
      skuProfile: {
        name: "Enterprise Balanced_B3",
        family: "Enterprise",
        capacity: 1,
        nominalMemoryMb: 1024,
        nominalMemoryGb: 1.0,
        isEnterprise: true,
        version: "7.2 (Enterprise)",
        enableNonSslPort: false,
        maxMemoryPolicy: "volatile-lru",
        modules: ["RediSearch", "RedisJSON"],
      },
      metrics: {
        serverLoadAvgPct: 2.4,
        serverLoadMaxPct: 8.1,
        cpuPercentAvg: 2.4,
        usedMemoryBytes: 64826880,
        usedMemoryMb: 61.82,
        usedMemoryGb: 0.06,
        usedMemoryRatioPct: 6.04,
        cacheHits: 450,
        cacheMisses: 1650,
        hitRatePercentage: 21.43,
        missRatePercentage: 78.57,
        connectedClients: 8,
        operationsPerSecond: 45,
        evictedKeys: 0,
        expiredKeys: 120,
        memoryFragmentationRatio: 1.12,
        persistenceMode: "Disabled",
      },
      cost: {
        monthlyCostUsd: round2(8.58 * mult),
        nominalMemoryCostPerGb: round2(8.58 * mult),
        effectiveMemoryCostPerGb: round2((8.58 / 0.06) * mult),
        savingsMonthlyUsd: round2(1.54 * mult),
      },
      recommendations: [],
      hostName: "cscs-finops-prod-westus2-redis.westus2.redisenterprise.cache.azure.net",
      sslPort: 10000,
      tags: { Environment: "Production", Workload: "AppCache", Tier: "Enterprise" },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-finops-stg-westus2-rg/providers/Microsoft.Cache/redisEnterprise/cscs-finops-stg-westus2-redis",
      name: "cscs-finops-stg-westus2-redis",
      type: "Microsoft.Cache/redisEnterprise",
      resourceGroup: "cscs-finops-stg-westus2-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "westus2",
      state: "warning",
      skuProfile: {
        name: "Enterprise Balanced_B3",
        family: "Enterprise",
        capacity: 1,
        nominalMemoryMb: 1024,
        nominalMemoryGb: 1.0,
        isEnterprise: true,
        version: "7.2 (Enterprise)",
        enableNonSslPort: false,
        maxMemoryPolicy: "volatile-lru",
        modules: ["RediSearch"],
      },
      metrics: {
        serverLoadAvgPct: 0.8,
        serverLoadMaxPct: 2.1,
        cpuPercentAvg: 0.8,
        usedMemoryBytes: 25165824,
        usedMemoryMb: 24.0,
        usedMemoryGb: 0.024,
        usedMemoryRatioPct: 2.34,
        cacheHits: 12,
        cacheMisses: 48,
        hitRatePercentage: 20.0,
        missRatePercentage: 80.0,
        connectedClients: 1,
        operationsPerSecond: 1,
        evictedKeys: 0,
        expiredKeys: 15,
        memoryFragmentationRatio: 1.05,
        persistenceMode: "Disabled",
      },
      cost: {
        monthlyCostUsd: round2(8.58 * mult),
        nominalMemoryCostPerGb: round2(8.58 * mult),
        effectiveMemoryCostPerGb: round2((8.58 / 0.024) * mult),
        savingsMonthlyUsd: round2(5.0 * mult),
      },
      recommendations: [],
      hostName: "cscs-finops-stg-westus2-redis.westus2.redisenterprise.cache.azure.net",
      sslPort: 10000,
      tags: { Environment: "Staging", Workload: "StagingCache", Tier: "Enterprise" },
    },
  ];

  for (const inst of instances) {
    inst.recommendations = deriveRedisRecommendations(inst);
  }

  return instances;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta parámetro tenantId" }, { status: 400 });
    }

    // El guard NO corre para tenants demo, igual que en mysql-metrics,
    // postgres-metrics y mongo-metrics. Corria siempre, asi que un tenant demo
    // recibia 401 y la pantalla mostraba "No autorizado." en vez de los datos
    // simulados que el propio branch de `isMockTenant` de mas abajo ya tenia
    // armados. Los datos mock son sinteticos: no hay nada de un cliente real
    // detras de este camino.
    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const bustCache = request.nextUrl.searchParams.get("bust") === "1";
    // v3 y no v2: el payload cambio de forma. Las entradas guardadas antes de
    // este cambio traen `title`/`description` armados y NO traen
    // `params`, asi que la UI --que ahora interpola-- tiraba
    // FORMATTING_ERROR y se llevaba puesto el board entero. Subir la version
    // invalida esas entradas de una.
    //
    // REGLA para las cinco rutas que faltan convertir: al cambiar la forma del
    // payload, subir la version de la clave. No es opcional.
    const cacheKey = getDiagnosticsCacheKey(tenantId, "redis-finops-v3");

    if (!bustCache) {
      const cached = await readDiagnosticsCache<RedisFinopsSummaryResponse>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    if (isMockTenant(tenantId)) {
      const mockInstances = buildMockRedisInstances(tenantId);
      const totalCost = mockInstances.reduce((acc, i) => acc + i.cost.monthlyCostUsd, 0);
      const allRecs = mockInstances.flatMap((i) => i.recommendations);
      // Acotado al gasto: las recomendaciones son excluyentes entre sí.
      const potentialSavings = cappedMonthlySavings(
        allRecs.map((r) => r.savingsMonthlyUsd),
        totalCost,
      );

      const totalNominalGb = mockInstances.reduce((acc, i) => acc + i.skuProfile.nominalMemoryGb, 0);
      const totalUsedGb = mockInstances.reduce((acc, i) => acc + i.metrics.usedMemoryGb, 0);
      const totalOps = mockInstances.reduce((acc, i) => acc + i.metrics.operationsPerSecond, 0);
      const underutilized = mockInstances.filter((i) => {
        const isMinTier = i.skuProfile.name.toLowerCase().includes("b3") || i.skuProfile.name.toLowerCase().includes("c0");
        return i.metrics.usedMemoryRatioPct < 10 && !isMinTier;
      }).length;

      const healthAvg =
        mockInstances.reduce((acc, i) => {
          let score = 100;
          if (typeof i.metrics.hitRatePercentage === "number" && i.metrics.hitRatePercentage < 30) score -= 15;
          if (i.metrics.usedMemoryRatioPct < 10) score -= 15;
          if (i.metrics.evictedKeys > 0) score -= 20;
          return acc + Math.max(30, score);
        }, 0) / mockInstances.length;

      const response: RedisFinopsSummaryResponse = {
        instances: mockInstances,
        financialSummary: {
          mtdCost: round2(totalCost),
          forecastEom: { value: 29.55, low: 26.5, high: 32.6 },
          deltaMoM: { value: 1.37, percentage: 8.7 },
          potentialSavings: round2(potentialSavings),
        },
        efficiency: {
          nominalCostPerGb: totalNominalGb > 0 ? round2(totalCost / totalNominalGb) : 0,
          effectiveCostPerGb: totalUsedGb > 0 ? round2(totalCost / totalUsedGb) : 0,
          costPerKOps: totalOps > 0 ? round2((totalCost / (totalOps * 3600 * 24 * 30)) * 1000) : 0,
          underutilizedCount: underutilized,
        },
        risk: {
          healthScore: round2(healthAvg),
          criticalAlerts: mockInstances.filter((i) => i.state === "critical").length,
          idleInstancesCount: mockInstances.filter((i) => i.metrics.operationsPerSecond < 5).length,
          lowHitRateCount: mockInstances.filter((i) => typeof i.metrics.hitRatePercentage === "number" && i.metrics.hitRatePercentage < 30).length,
        },
        recommendations: allRecs,
      };

      await writeDiagnosticsCache(cacheKey, response);
      return NextResponse.json(response);
    }

    // --- Entorno Real (Producción Azure ARM + Monitor + Cost Management) ---
    let credential;
    try {
      credential = await getAzureCredential(tenantId);
    } catch {
      credential = null;
    }

    if (!credential) {
      const emptyResponse: RedisFinopsSummaryResponse = {
        instances: [],
        financialSummary: {
          mtdCost: 0,
          forecastEom: { value: 0, low: 0, high: 0 },
          deltaMoM: { value: 0, percentage: 0 },
          potentialSavings: 0,
        },
        efficiency: {
          nominalCostPerGb: 0,
          effectiveCostPerGb: 0,
          costPerKOps: 0,
          underutilizedCount: 0,
        },
        risk: {
          healthScore: 100,
          criticalAlerts: 0,
          idleInstancesCount: 0,
          lowHitRateCount: 0,
        },
        recommendations: [],
      };
      return NextResponse.json(emptyResponse);
    }

    const subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
    const subscriptionMap = await getSubscriptionNameMap(tenantId, credential);

    const rawResources = await listResourcesByTypes(tenantId, REDIS_TYPES, subscriptionIds, credential);
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
    const resourceCosts = await getMtdCostByResourceId(tenantId, credential, resourceItems).catch(
      () => new Map<string, number>(),
    );

    const instances: RedisCacheDetail[] = [];

    for (const raw of uniqueRawResources) {
      const rid = String(raw.id || "").toLowerCase();
      const name = String(raw.name || "redis-cache");
      const type: any = raw.type.toLowerCase().includes("enterprise")
        ? "Microsoft.Cache/redisEnterprise"
        : "Microsoft.Cache/Redis";
      const region = String(raw.location || "eastus");
      const matchRg = String(raw.id || "").match(/\/resourceGroups\/([^/]+)/i);
      const resourceGroup = raw.resourceGroup && raw.resourceGroup.toLowerCase() !== "unknown"
        ? raw.resourceGroup
        : matchRg
        ? matchRg[1]
        : "unknown";
      const subId = String(raw.subscriptionId || "").toLowerCase();
      const subName = resolveSubscriptionName(subId, subscriptionMap) || subId || "Producción";
      const rawProps: any = raw.properties || {};
      const skuRaw: any = (rawProps.sku as any) || {};
      const skuName = String(skuRaw.name || raw.skuName || "Standard_C1");
      const skuFamily = String(skuRaw.family || "C");
      const capacity = Number(skuRaw.capacity || 1);
      const isEnterprise = type === "Microsoft.Cache/redisEnterprise";
      const nominalMemoryMb = getNominalMemoryMb(skuName, capacity);
      const nominalMemoryGb = round2(nominalMemoryMb / 1024);

      const rawCost = resourceCosts.get(rid) || 0;
      // Sin dato de Cost Management no se inventa importe: el estimado por SKU
      // se mostraba como si fuera facturación.
      const redisCreatedAt = extractResourceCreatedAt(rawProps, (raw as any).systemData);
      const costDataAvailable = rawCost > 0;
      const monthlyCost = rawCost;
      // Tarifa MENSUAL equivalente: es lo que corresponde a los ahorros y a los
      // ratios $/GB. Usar el acumulado ahí daba cifras absurdas — a principio de
      // mes, un costo por GB casi nulo y ahorros de centavos.
      const monthlyRateUsd = rawCost > 0 ? monthlyRunRate(rawCost, new Date(), redisCreatedAt) : 0;

      const skuProfile: RedisSkuProfile = {
        name: skuName,
        family: skuFamily,
        capacity,
        nominalMemoryMb,
        nominalMemoryGb,
        isEnterprise,
        version: String(rawProps.redisVersion || (isEnterprise ? "7.2 Enterprise" : "6.0")),
        enableNonSslPort: Boolean(rawProps.enableNonSslPort),
        maxMemoryPolicy: rawProps.redisConfiguration?.["maxmemory-policy"] || "volatile-lru",
        modules: Array.isArray(rawProps.modules) ? rawProps.modules.map((m: any) => m.name || String(m)) : undefined,
      };

      // Telemetría REAL de Azure Monitor. Antes este bloque devolvía valores
      // fijos (4.5% de carga, 150 MB, 8500 hits, 12 clientes) idénticos para
      // toda instancia y todo tenant, presentados como métricas medidas: dos
      // caches distintas mostraban exactamente los mismos números.
      const rawMetrics = await getAzureResourceMetricsSummary(credential, raw.id, [
        "serverLoad",
        "usedmemory",
        "cachehits",
        "cachemisses",
        "connectedclients",
        "operationsPerSecond",
        "evictedkeys",
        "expiredkeys",
      ]);

      const num = (key: string): number | null =>
        typeof rawMetrics[key] === "number" ? (rawMetrics[key] as number) : null;

      const usedMemoryBytes = num("usedmemory") ?? 0;
      const usedMemoryMb = round2(usedMemoryBytes / (1024 * 1024));
      const cacheHits = num("cachehits") ?? 0;
      const cacheMisses = num("cachemisses") ?? 0;
      const totalOps = cacheHits + cacheMisses;
      const serverLoad = num("serverLoad");
      // null (y no un 0 inventado) cuando Azure Monitor no devuelve la serie:
      // la UI puede distinguir "sin telemetría" de "carga cero".
      const metrics: any = {
        serverLoadAvgPct: serverLoad,
        serverLoadMaxPct: serverLoad,
        cpuPercentAvg: serverLoad,
        usedMemoryBytes,
        usedMemoryMb,
        usedMemoryGb: round2(usedMemoryBytes / (1024 * 1024 * 1024)),
        usedMemoryRatioPct: nominalMemoryMb > 0 ? round2((usedMemoryMb / nominalMemoryMb) * 100) : 0,
        cacheHits,
        cacheMisses,
        hitRatePercentage: totalOps > 0 ? round2((cacheHits / totalOps) * 100) : null,
        missRatePercentage: totalOps > 0 ? round2((cacheMisses / totalOps) * 100) : null,
        connectedClients: num("connectedclients") ?? 0,
        operationsPerSecond: num("operationsPerSecond") ?? 0,
        evictedKeys: num("evictedkeys") ?? 0,
        expiredKeys: num("expiredkeys") ?? 0,
        memoryFragmentationRatio: null,
        persistenceMode: String(rawProps.redisConfiguration?.["rdb-backup-enabled"] === "true" ? "RDB" : "Disabled"),
        metricsAvailable: serverLoad !== null || usedMemoryBytes > 0,
      };

      const cost = {
        monthlyCostUsd: round2(monthlyCost),
        monthlyRateUsd,
        costDataAvailable,
        // Los ratios $/GB son mensuales: se calculan sobre la tarifa, no sobre
        // el acumulado del mes en curso.
        nominalMemoryCostPerGb: nominalMemoryGb > 0 ? round2(monthlyRateUsd / nominalMemoryGb) : 0,
        effectiveMemoryCostPerGb: metrics.usedMemoryGb > 0 ? round2(monthlyRateUsd / metrics.usedMemoryGb) : 0,
        savingsMonthlyUsd: 0,
      };

      const detail: RedisCacheDetail = {
        id: raw.id,
        name,
        type,
        resourceGroup,
        subscriptionId: subId,
        subscriptionName: subName,
        region,
        state: "healthy",
        skuProfile,
        metrics,
        cost,
        recommendations: [],
        hostName: rawProps.hostName,
        sslPort: rawProps.sslPort || (isEnterprise ? 10000 : 6380),
        tags: {},
      };

      detail.recommendations = deriveRedisRecommendations(detail);
      detail.cost.savingsMonthlyUsd = detail.recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0);
      instances.push(detail);
    }

    const totalCost = instances.reduce((acc, i) => acc + i.cost.monthlyCostUsd, 0);
    const allRecs = instances.flatMap((i) => i.recommendations);
    // Acotado a lo que los recursos cuestan: las recomendaciones son
    // excluyentes entre sí y sumarlas daba ahorros por encima del gasto.
    const potentialSavings = cappedMonthlySavings(
      allRecs.map((r) => r.savingsMonthlyUsd),
      instances.reduce((acc, i) => acc + (i.cost.monthlyRateUsd ?? 0), 0),
    );
    const totalNominalGb = instances.reduce((acc, i) => acc + i.skuProfile.nominalMemoryGb, 0);
    const totalUsedGb = instances.reduce((acc, i) => acc + i.metrics.usedMemoryGb, 0);
    const totalOps = instances.reduce((acc, i) => acc + i.metrics.operationsPerSecond, 0);
    const underutilized = instances.filter((i) => {
      const isMinTier = i.skuProfile.name.toLowerCase().includes("b3") || i.skuProfile.name.toLowerCase().includes("c0");
      return i.metrics.usedMemoryRatioPct < 10 && !isMinTier;
    }).length;

    const healthAvg = instances.length > 0
      ? instances.reduce((acc, i) => {
          let score = 100;
          if (typeof i.metrics.hitRatePercentage === "number" && i.metrics.hitRatePercentage < 30) score -= 15;
          if (i.metrics.usedMemoryRatioPct < 10) score -= 15;
          if (i.metrics.evictedKeys > 0) score -= 20;
          return acc + Math.max(30, score);
        }, 0) / instances.length
      : 100;

    const response: RedisFinopsSummaryResponse = {
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
        nominalCostPerGb: totalNominalGb > 0 ? round2(totalCost / totalNominalGb) : 0,
        effectiveCostPerGb: totalUsedGb > 0 ? round2(totalCost / totalUsedGb) : 0,
        costPerKOps: totalOps > 0 ? round2((totalCost / (totalOps * 3600 * 24 * 30)) * 1000) : 0,
        underutilizedCount: underutilized,
      },
      risk: {
        healthScore: round2(healthAvg),
        criticalAlerts: instances.filter((i) => i.state === "critical").length,
        idleInstancesCount: instances.filter((i) => i.metrics.operationsPerSecond < 5).length,
        lowHitRateCount: instances.filter((i) => typeof i.metrics.hitRatePercentage === "number" && i.metrics.hitRatePercentage < 30).length,
      },
      recommendations: allRecs,
    };

    await writeDiagnosticsCache(cacheKey, response);
    return NextResponse.json(response);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[Redis API] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
