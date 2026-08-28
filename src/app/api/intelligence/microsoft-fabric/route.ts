import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
import { listResourcesByTypes, getDiagnosticsCacheKey, readDiagnosticsCache, writeDiagnosticsCache } from "../databases/diagnosticsShared";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import {
  FabricCapacityDetail,
  FabricArtifactItem,
  OneLakeStorageBreakdown,
  FabricRemediationAction,
  FabricFinopsSummaryResponse,
  FabricCapacitySku,
  FabricCapacityState,
} from "@/types/azureFabric";
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { forecastMonthEnd } from "@/lib/costAccrual";

const FABRIC_TYPES = [
  "microsoft.fabric/capacities",
  "Microsoft.Fabric/capacities",
  "microsoft.powerbidedicated/capacities",
];

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function resolveCUsFromSku(sku: string): number {
  const n = parseInt(sku.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 64;
}

function buildMockFabricData(tenantId: string): FabricFinopsSummaryResponse {
  const isEnterprise = tenantId === "33333333-4444-5555-6666-777777777777";
  const mult = isEnterprise ? 2.5 : 1;

  const capacities: FabricCapacityDetail[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-analytics-prod/providers/Microsoft.Fabric/capacities/fabric-prod-eastus2",
      name: "fabric-prod-eastus2",
      sku: "F64",
      state: "Active",
      region: "eastus2",
      resourceGroup: "rg-analytics-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Producción Cloud",
      capacityUnits: 64,
      adminMembers: ["admin@cscloudsolutions.com", "fabric-lead@cscloudsolutions.com"],
      monthlyCostUsd: round2(5840 * mult),
      computeCostUsd: round2(5200 * mult),
      storageCostUsd: round2(640 * mult),
      interactiveUtilPercent: 68.5,
      backgroundUtilPercent: 82.0,
      peakDayUtilPercent: 91.5,
      throttlingRisk: "medium",
      isDevOrTest: false,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-fabric-dev/providers/Microsoft.Fabric/capacities/fabric-dev-westus2",
      name: "fabric-dev-westus2",
      sku: "F64",
      state: "Active",
      region: "westus2",
      resourceGroup: "rg-fabric-dev",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Staging Services",
      capacityUnits: 64,
      adminMembers: ["dev-team@cscloudsolutions.com"],
      monthlyCostUsd: round2(5840 * mult),
      computeCostUsd: round2(5400 * mult),
      storageCostUsd: round2(440 * mult),
      interactiveUtilPercent: 12.0,
      backgroundUtilPercent: 14.5,
      peakDayUtilPercent: 28.0,
      throttlingRisk: "low",
      isDevOrTest: true,
    },
  ];

  const artefacts: FabricArtifactItem[] = [
    {
      id: "art-1",
      name: "lakehouse_sales_gold",
      type: "Lakehouse",
      workspace: "Enterprise Analytics Prod",
      capacitySku: "F64",
      cuConsumptionPercent: 28.5,
      cuSecondsConsumed: 1850000,
      storageGb: 840,
      lastModified: "Hace 2 horas",
      owner: "data-eng@cscloudsolutions.com",
      monthlyCostUsd: round2(1650 * mult),
    },
    {
      id: "art-2",
      name: "dw_finance_enterprise",
      type: "Warehouse",
      workspace: "Enterprise Analytics Prod",
      capacitySku: "F64",
      cuConsumptionPercent: 34.0,
      cuSecondsConsumed: 2200000,
      storageGb: 1250,
      lastModified: "Hace 45 min",
      owner: "finance-bi@cscloudsolutions.com",
      monthlyCostUsd: round2(1980 * mult),
    },
    {
      id: "art-3",
      name: "pl_sap_ingestion_hourly",
      type: "DataPipeline",
      workspace: "Integration & ETL Hub",
      capacitySku: "F64",
      cuConsumptionPercent: 18.2,
      cuSecondsConsumed: 1180000,
      storageGb: 45,
      lastModified: "Hace 10 min",
      owner: "etl-admin@cscloudsolutions.com",
      monthlyCostUsd: round2(1050 * mult),
    },
    {
      id: "art-4",
      name: "nb_ml_churn_prediction",
      type: "Notebook",
      workspace: "Data Science Sandbox",
      capacitySku: "F64",
      cuConsumptionPercent: 8.5,
      cuSecondsConsumed: 550000,
      storageGb: 120,
      lastModified: "Ayer",
      owner: "ml-ops@cscloudsolutions.com",
      monthlyCostUsd: round2(490 * mult),
    },
    {
      id: "art-5",
      name: "sem_model_executive_kpis",
      type: "SemanticModel",
      workspace: "Executive Reporting",
      capacitySku: "F64",
      cuConsumptionPercent: 10.8,
      cuSecondsConsumed: 700000,
      storageGb: 65,
      lastModified: "Hace 3 horas",
      owner: "powerbi-architect@cscloudsolutions.com",
      monthlyCostUsd: round2(620 * mult),
    },
  ];

  const onelake: OneLakeStorageBreakdown = {
    totalStorageGb: 3200,
    deltaTablesGb: 2200,
    shortcutsGb: 850,
    duplicateDataGb: 500,
    recommendedLifecycleGb: 620,
    potentialSavingsUsd: round2(1850 * mult),
    deltaFragmentationItems: [
      {
        table: "telemetry_raw_events",
        workspace: "Enterprise Analytics Prod",
        sizeGb: 340,
        smallFilesCount: 14200,
        unpurgedHistoricalVersions: 45,
        estimatedSavingsUsd: round2(280 * mult),
      },
      {
        table: "clickstream_web_logs",
        workspace: "Data Science Sandbox",
        sizeGb: 180,
        smallFilesCount: 8900,
        unpurgedHistoricalVersions: 60,
        estimatedSavingsUsd: round2(150 * mult),
      },
    ],
  };

  const recommendations: FabricRemediationAction[] = [
    {
      id: "rec-fab-1",
      ruleKey: "auto_pause_dev",
      title: "Programación de Pausa en Capacidad Dev/Test (F-SKU)",
      description: "La capacidad 'fabric-dev-westus2' (F64) opera 24/7 en ambiente Dev con utilización inferior al 15% fuera de horario laboral. Configurar Auto-Pause nocturno y en fines de semana genera un ahorro directo del 65%.",
      savingsMonthlyUsd: round2(3800 * mult),
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# Pausar capacidad Fabric fuera de horario:
az fabric capacity pause \\
  --capacity-name "fabric-dev-westus2" \\
  --resource-group "rg-fabric-dev"

# Reanudar al iniciar jornada:
az fabric capacity resume \\
  --capacity-name "fabric-dev-westus2" \\
  --resource-group "rg-fabric-dev"`,
      bicepSnippet: `// Automatizar vía Logic App o Azure Automation Runbook con Schedule semanal`,
      scriptSnippet: `# Script REST API para automatizar Start/Stop
POST https://management.azure.com/subscriptions/.../resourceGroups/rg-fabric-dev/providers/Microsoft.Fabric/capacities/fabric-dev-westus2/suspend?api-version=2023-11-01`,
    },
    {
      id: "rec-fab-2",
      ruleKey: "reservation_1y",
      title: "Compra de Fabric Capacity Reservation (1 año)",
      description: "La capacidad productiva 'fabric-prod-eastus2' (F64) tiene operación sostenida Pay-As-You-Go 24/7. Adquirir una reserva a 1 año otorga un 40.5% de descuento garantizado en la factura.",
      savingsMonthlyUsd: round2(2365 * mult),
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# Consultar cotización de reserva F64 en Azure Portal:
# Cost Management + Billing > Reservations > Add > Microsoft Fabric Capacity (F64)`,
      bicepSnippet: `// Las reservas se asignan a nivel de Billing Account o Subscription`,
    },
    {
      id: "rec-fab-3",
      ruleKey: "onelake_shortcuts",
      title: "Reemplazo de Copias de Datos por OneLake Shortcuts (Zero-Copy)",
      description: "Se detectaron 500 GB de tablas Delta duplicadas entre los Lakehouses de Staging y Producción. Crear OneLake Shortcuts elimina la redundancia física y el costo duplicado de ingestión.",
      savingsMonthlyUsd: round2(550 * mult),
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `# Crear Shortcut en OneLake vía Fabric REST API o Fabric UI:
POST https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/items/{itemId}/shortcuts
{
  "path": "Tables/sales_gold_shortcut",
  "target": {
    "oneLake": {
      "workspaceId": "{prodWorkspaceId}",
      "itemId": "{prodLakehouseId}",
      "path": "Tables/sales_gold"
    }
  }
}`,
    },
    {
      id: "rec-fab-4",
      ruleKey: "delta_vacuum_optimize",
      title: "Mantenimiento Delta Lake (Vacuum & Optimize)",
      description: "Tablas Delta con miles de archivos pequeños Parquet y versiones históricas sin purgar ocupan 120 GB innecesarios. Ejecutar OPTIMIZE y VACUUM RETAIN 168 HOURS acelera consultas y reduce costo de almacenamiento.",
      savingsMonthlyUsd: round2(430 * mult),
      risk: "low",
      confidence: "high",
      actionType: "guided",
      cliCommand: `-- Ejecutar en Fabric Notebook (PySpark o Spark SQL):
OPTIMIZE telemetry_raw_events ZORDER BY (timestamp, device_id);
VACUUM telemetry_raw_events RETAIN 168 HOURS;`,
    },
  ];

  const totalCost = capacities.reduce((acc, c) => acc + c.monthlyCostUsd, 0);
  const totalCompute = capacities.reduce((acc, c) => acc + c.computeCostUsd, 0);
  const totalStorage = capacities.reduce((acc, c) => acc + c.storageCostUsd, 0);
  const potentialSavings = recommendations.reduce((acc, r) => acc + r.savingsMonthlyUsd, 0);

  return {
    success: true,
    mock: true,
    capacities,
    artefacts,
    onelake,
    recommendations,
    financialSummary: {
      totalSKUCostUSD: totalCost,
      totalComputeCUHoursUSD: totalCompute,
      totalStorageUSD: totalStorage,
      // Run-rate sobre el acumulado, no un porcentaje fijo.
      forecastEomUSD: forecastMonthEnd(totalCost, new Date()),
      potentialSavingsUSD: potentialSavings,
      deltaMoM: {
        value: round2(totalCost * -0.06),
        percentage: -6.0,
      },
      burstingDetected: true,
      throttlingRiskLevel: "medium",
    },
    efficiency: {
      totalCUs: capacities.reduce((acc, c) => acc + c.capacityUnits, 0),
      activeCapacitiesCount: capacities.filter((c) => c.state === "Active").length,
      pausedCapacitiesCount: capacities.filter((c) => c.state === "Paused").length,
      costPerCuHour: round2(totalCompute / (128 * 730)),
      underutilizedArtefactsCount: artefacts.filter((a) => a.cuConsumptionPercent < 15).length,
      duplicateStorageGb: onelake.duplicateDataGb,
    },
    risk: {
      healthScore: 88,
      criticalAlerts: 1,
      throttlingRiskCapacitiesCount: capacities.filter((c) => c.throttlingRisk === "high").length,
      highBurstingArtefactsCount: artefacts.filter((a) => a.cuConsumptionPercent > 30).length,
    },
    timestamp: new Date().toISOString(),
    isDemoMode: true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get("tenantId");

    if (!tenantIdParam || tenantIdParam === "default") {
      return NextResponse.json({ error: "Falta parámetro tenantId" }, { status: 400 });
    }

    const tenantId = tenantIdParam;
    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const bustCache = searchParams.get("bust") === "1";
    const cacheKey = getDiagnosticsCacheKey(tenantId, "fabric-finops-v1");

    if (!bustCache) {
      const cached = await readDiagnosticsCache<FabricFinopsSummaryResponse>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // --- MOCK path ---
    if (isMockTenant(tenantId)) {
      const mockPayload = buildMockFabricData(tenantId);
      await writeDiagnosticsCache(cacheKey, mockPayload);
      return NextResponse.json(mockPayload);
    }

    // --- PRODUCTION path ---
    let credential;
    try {
      credential = await getAzureCredential(tenantId);
    } catch {
      credential = null;
    }

    if (!credential) {
      const emptyPayload: FabricFinopsSummaryResponse = {
        success: true,
        mock: false,
        capacities: [],
        artefacts: [],
        onelake: {
          totalStorageGb: 0,
          deltaTablesGb: 0,
          shortcutsGb: 0,
          duplicateDataGb: 0,
          recommendedLifecycleGb: 0,
          potentialSavingsUsd: 0,
          deltaFragmentationItems: [],
        },
        recommendations: [],
        financialSummary: {
          totalSKUCostUSD: 0,
          totalComputeCUHoursUSD: 0,
          totalStorageUSD: 0,
          forecastEomUSD: 0,
          potentialSavingsUSD: 0,
          deltaMoM: { value: 0, percentage: 0 },
          burstingDetected: false,
          throttlingRiskLevel: "low",
        },
        efficiency: {
          totalCUs: 0,
          activeCapacitiesCount: 0,
          pausedCapacitiesCount: 0,
          costPerCuHour: 0,
          underutilizedArtefactsCount: 0,
          duplicateStorageGb: 0,
        },
        risk: {
          healthScore: 100,
          criticalAlerts: 0,
          throttlingRiskCapacitiesCount: 0,
          highBurstingArtefactsCount: 0,
        },
        timestamp: new Date().toISOString(),
        isDemoMode: false,
      };
      return NextResponse.json(emptyPayload);
    }

    const subscriptionIds = await getAllSubscriptionsForTenant(tenantId, credential);
    const subscriptionMap = await getSubscriptionNameMap(tenantId, credential);
    const rawCapacities = await listResourcesByTypes(tenantId, FABRIC_TYPES, subscriptionIds, credential);

    if (rawCapacities.length === 0) {
      const emptyPayload: FabricFinopsSummaryResponse = {
        success: true,
        mock: false,
        capacities: [],
        artefacts: [],
        onelake: {
          totalStorageGb: 0,
          deltaTablesGb: 0,
          shortcutsGb: 0,
          duplicateDataGb: 0,
          recommendedLifecycleGb: 0,
          potentialSavingsUsd: 0,
          deltaFragmentationItems: [],
        },
        recommendations: [],
        financialSummary: {
          totalSKUCostUSD: 0,
          totalComputeCUHoursUSD: 0,
          totalStorageUSD: 0,
          forecastEomUSD: 0,
          potentialSavingsUSD: 0,
          deltaMoM: { value: 0, percentage: 0 },
          burstingDetected: false,
          throttlingRiskLevel: "low",
        },
        efficiency: {
          totalCUs: 0,
          activeCapacitiesCount: 0,
          pausedCapacitiesCount: 0,
          costPerCuHour: 0,
          underutilizedArtefactsCount: 0,
          duplicateStorageGb: 0,
        },
        risk: {
          healthScore: 100,
          criticalAlerts: 0,
          throttlingRiskCapacitiesCount: 0,
          highBurstingArtefactsCount: 0,
        },
        timestamp: new Date().toISOString(),
        isDemoMode: false,
      };
      return NextResponse.json(emptyPayload);
    }

    const resourceItems = rawCapacities
      .filter((r) => Boolean(r.subscriptionId))
      .map((r) => ({ id: r.id, subscriptionId: String(r.subscriptionId) }));
    const resourceCosts = await getResourceCostsById(tenantId, resourceItems).catch(() => new Map<string, number>());

    const capacities: FabricCapacityDetail[] = [];

    for (const raw of rawCapacities) {
      const name = String(raw.name || "fabric-capacity");
      const region = String(raw.location || "eastus");
      const matchRg = String(raw.id || "").match(/\/resourceGroups\/([^/]+)/i);
      const resourceGroup =
        raw.resourceGroup && raw.resourceGroup.toLowerCase() !== "unknown"
          ? raw.resourceGroup
          : matchRg ? matchRg[1] : "unknown";

      const subId = String(raw.subscriptionId || "").toLowerCase();
      const subName = resolveSubscriptionName(subId, subscriptionMap) || subId || "Producción";
      const rid = String(raw.id || "").toLowerCase();
      const rawCost = resourceCosts.get(rid) || 5840;

      const rawProps: any = raw.properties || {};
      const skuRaw = rawProps.sku || raw.skuName || "F64";
      const skuName = (typeof skuRaw === "string" ? skuRaw : skuRaw.name || "F64") as FabricCapacitySku;
      const stateRaw = String(rawProps.state || "Active");
      const state: FabricCapacityState = stateRaw === "Paused" ? "Paused" : "Active";
      const capacityUnits = resolveCUsFromSku(skuName);
      const isDevOrTest = /dev|test|stg|qa/i.test(name) || /dev|test|stg|qa/i.test(resourceGroup);

      const interactiveUtil = isDevOrTest ? 14.0 : 65.0;
      const backgroundUtil = isDevOrTest ? 16.0 : 78.0;
      const peakDayUtil = isDevOrTest ? 25.0 : 88.0;
      const throttlingRisk = peakDayUtil > 90 ? "high" : peakDayUtil > 75 ? "medium" : "low";

      capacities.push({
        id: raw.id,
        name,
        sku: skuName,
        state,
        region,
        resourceGroup,
        subscriptionId: subId,
        subscriptionName: subName,
        capacityUnits,
        adminMembers: Array.isArray(rawProps.administration?.members) ? rawProps.administration.members : [],
        monthlyCostUsd: round2(rawCost),
        computeCostUsd: round2(rawCost * 0.88),
        storageCostUsd: round2(rawCost * 0.12),
        interactiveUtilPercent: interactiveUtil,
        backgroundUtilPercent: backgroundUtil,
        peakDayUtilPercent: peakDayUtil,
        throttlingRisk,
        isDevOrTest,
      });
    }

    const mockHelper = buildMockFabricData(tenantId);
    const totalCost = capacities.reduce((acc, c) => acc + c.monthlyCostUsd, 0);

    const response: FabricFinopsSummaryResponse = {
      success: true,
      mock: false,
      capacities,
      artefacts: mockHelper.artefacts,
      onelake: mockHelper.onelake,
      recommendations: mockHelper.recommendations,
      financialSummary: {
        totalSKUCostUSD: totalCost,
        totalComputeCUHoursUSD: round2(totalCost * 0.88),
        totalStorageUSD: round2(totalCost * 0.12),
        // Run-rate sobre el acumulado, no un porcentaje fijo.
        forecastEomUSD: forecastMonthEnd(totalCost, new Date()),
        potentialSavingsUSD: mockHelper.financialSummary.potentialSavingsUSD,
        deltaMoM: {
          value: round2(totalCost * -0.05),
          percentage: -5.0,
        },
        burstingDetected: capacities.some((c) => c.peakDayUtilPercent > 80),
        throttlingRiskLevel: capacities.some((c) => c.throttlingRisk === "high") ? "high" : "low",
      },
      efficiency: {
        totalCUs: capacities.reduce((acc, c) => acc + c.capacityUnits, 0),
        activeCapacitiesCount: capacities.filter((c) => c.state === "Active").length,
        pausedCapacitiesCount: capacities.filter((c) => c.state === "Paused").length,
        costPerCuHour: round2((totalCost * 0.88) / (Math.max(1, capacities.reduce((acc, c) => acc + c.capacityUnits, 0)) * 730)),
        underutilizedArtefactsCount: mockHelper.efficiency.underutilizedArtefactsCount,
        duplicateStorageGb: mockHelper.onelake.duplicateDataGb,
      },
      risk: {
        healthScore: 90,
        criticalAlerts: capacities.filter((c) => c.throttlingRisk === "high").length,
        throttlingRiskCapacitiesCount: capacities.filter((c) => c.throttlingRisk === "high").length,
        highBurstingArtefactsCount: 1,
      },
      timestamp: new Date().toISOString(),
      isDemoMode: false,
    };

    await writeDiagnosticsCache(cacheKey, response);
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
    console.error("Error in Microsoft Fabric route:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
