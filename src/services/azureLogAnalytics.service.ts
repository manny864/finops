/**
 * Azure Log Analytics Workspace (LAW) FinOps & Optimization Service
 *
 * Implements ARG discovery, ingestion telemetry estimation, Log Analytics pricing calculation,
 * Commitment Tier optimization, Daily Cap risk detection, and Retention policy right-sizing.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import pool from "@/modules/storage/db";
import type {
  LogAnalyticsResource,
  LogAnalyticsSummaryMetrics,
  LogAnalyticsRemediationAction,
  LogAnalyticsPayload,
  LawPricingTierBreakdown,
  LawDailyTrendPoint,
} from "@/types/azureLogAnalytics.types";

export const LAW_PAYG_RATE_PER_GB = 2.30;
export const LAW_FREE_RETENTION_DAYS = 31;
export const LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH = 0.12;

export const LAW_COMMITMENT_TIERS = [
  { dailyGb: 100, pricePerGb: 1.96, monthlyFixedCost: 100 * 1.96 * 30 }, // ~$5,880/mo
  { dailyGb: 200, pricePerGb: 1.84, monthlyFixedCost: 200 * 1.84 * 30 }, // ~$11,040/mo
  { dailyGb: 300, pricePerGb: 1.79, monthlyFixedCost: 300 * 1.79 * 30 }, // ~$16,110/mo
  { dailyGb: 400, pricePerGb: 1.76, monthlyFixedCost: 400 * 1.76 * 30 }, // ~$21,120/mo
  { dailyGb: 500, pricePerGb: 1.73, monthlyFixedCost: 500 * 1.73 * 30 }, // ~$25,950/mo
];

export const LAW_TIER_COLORS: Record<string, string> = {
  PerGB2018: "#0078D4", // Corporate Blue
  CapacityReservation100GB: "#2563EB", // Cobalt Blue
  CapacityReservation200GB: "#0284C7", // Cyan Blue
  CapacityReservationHigher: "#38BDF8", // Sky Blue
  Free: "#94A3B8", // Slate
  Standalone: "#64748B", // Dark Slate
};

/**
 * Calculates summary metrics and pricing tier breakdown
 */
export function calculateLogAnalyticsSummary(
  workspaces: LogAnalyticsResource[],
  customRecommendations?: LogAnalyticsRemediationAction[]
): LogAnalyticsSummaryMetrics {
  const workspacesCount = workspaces.length;
  const totalMonthlyCostUSD = Number(
    workspaces.reduce((sum, w) => sum + w.totalRealCostUSD, 0).toFixed(2)
  );
  const totalIngestedGB = Number(
    workspaces.reduce((sum, w) => sum + w.totalBillableGB_MTD, 0).toFixed(2)
  );
  const unlimitedCapCount = workspaces.filter((w) => w.isDailyCapUnlimited).length;
  const commitmentCandidatesCount = workspaces.filter(
    (w) => w.primaryRecommendation?.category === "COMMITMENT_TIER"
  ).length;

  // Breakdown by Pricing Tier
  const tierMap = new Map<string, { count: number; cost: number }>();
  for (const w of workspaces) {
    let tierKey = String(w.pricingTier || "PerGB2018");
    if (tierKey.startsWith("CapacityReservation") && !["CapacityReservation100GB", "CapacityReservation200GB"].includes(tierKey)) {
      tierKey = "CapacityReservationHigher";
    }
    const current = tierMap.get(tierKey) || { count: 0, cost: 0 };
    tierMap.set(tierKey, {
      count: current.count + 1,
      cost: current.cost + w.totalRealCostUSD,
    });
  }

  const breakdownByPricingTier: LawPricingTierBreakdown[] = Array.from(tierMap.entries()).map(
    ([tierName, data]) => ({
      tierName,
      workspacesCount: data.count,
      costUSD: Number(data.cost.toFixed(2)),
      percentage:
        totalMonthlyCostUSD > 0
          ? Number(((data.cost / totalMonthlyCostUSD) * 100).toFixed(1))
          : 0,
      color: LAW_TIER_COLORS[tierName] || "#0078D4",
    })
  );

  const recommendations = customRecommendations || generateLogAnalyticsRecommendations(workspaces);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, a) => sum + a.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalMonthlyCostUSD,
    totalIngestedGB,
    potentialSavingsUSD,
    commitmentCandidatesCount,
    unlimitedCapCount,
    workspacesCount,
    breakdownByPricingTier,
  };
}

/**
 * Generates actionable FinOps remediation recommendations for Log Analytics
 */
export function generateLogAnalyticsRecommendations(
  workspaces: LogAnalyticsResource[]
): LogAnalyticsRemediationAction[] {
  const actions: LogAnalyticsRemediationAction[] = [];

  for (const w of workspaces) {
    // Regla 1: Oportunidad de Commitment Tier (Ingesta sostenida > 100 GB/día en Pay-As-You-Go)
    if (w.pricingTier === "PerGB2018" && w.avgDailyIngestionGB >= 100 && !w.isOrphan) {
      // Comparar contra el tier de 100 GB o 200 GB según volumen
      let targetTier = LAW_COMMITMENT_TIERS[0];
      for (const tier of LAW_COMMITMENT_TIERS) {
        if (w.avgDailyIngestionGB >= tier.dailyGb) {
          targetTier = tier;
        }
      }

      const paygMonthlyCost = w.avgDailyIngestionGB * 30 * LAW_PAYG_RATE_PER_GB;
      const commitmentMonthlyCost = (targetTier.dailyGb * targetTier.pricePerGb * 30) +
        Math.max(0, (w.avgDailyIngestionGB - targetTier.dailyGb) * 30 * targetTier.pricePerGb);
      const savings = Math.max(0, paygMonthlyCost - commitmentMonthlyCost);

      if (savings > 50) {
        actions.push({
          id: `rem-law-tier-${w.id}`,
          resourceId: w.id,
          resourceName: w.name,
          params: { name: w.name, tier: targetTier.dailyGb, gb: w.avgDailyIngestionGB.toFixed(1), payg: LAW_PAYG_RATE_PER_GB, rate: targetTier.pricePerGb, savings: savings.toFixed(2) },
          category: "COMMITMENT_TIER",
          estimatedSavingsUSD: Number(savings.toFixed(2)),
          confidence: "HIGH",
          actionType: "UPGRADE_COMMITMENT_TIER",
          currentTier: w.pricingTier,
          recommendedTier: `CapacityReservation${targetTier.dailyGb}GB`,
          commandPayload: `az monitor log-analytics workspace update --resource-group "${w.resourceGroup}" --workspace-name "${w.name}" --sku "CapacityReservation" --capacity-reservation-level ${targetTier.dailyGb}`,
        });
      }
    }

    // Regla 2: Falta de Daily Cap en entornos Dev/Test/Staging
    if (w.isDevOrTest && w.isDailyCapUnlimited && !w.isOrphan) {
      const estimatedCapSavings = Number((w.monthlyCostUSD * 0.30).toFixed(2));
      actions.push({
        id: `rem-law-cap-${w.id}`,
        resourceId: w.id,
        resourceName: w.name,
        params: { name: w.name, rg: w.resourceGroup },
        category: "DAILY_CAP",
        estimatedSavingsUSD: estimatedCapSavings,
        confidence: "HIGH",
        actionType: "SET_DAILY_CAP",
        recommendedDailyCapGB: 5,
        commandPayload: `az monitor log-analytics workspace update --resource-group "${w.resourceGroup}" --workspace-name "${w.name}" --daily-quota 5`,
      });
    }

    // Regla 3: Retención excesiva (> 31 días) sin justificación de auditoría activa
    if (w.retentionInDays > 90 && !w.isOrphan) {
      const billableRetentionDays = w.retentionInDays - LAW_FREE_RETENTION_DAYS;
      const extraMonths = billableRetentionDays / 30;
      const retentionSavings = Number(
        (w.totalBillableGB_MTD * extraMonths * LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH * 0.7).toFixed(2)
      );

      if (retentionSavings > 20) {
        actions.push({
          id: `rem-law-retention-${w.id}`,
          resourceId: w.id,
          resourceName: w.name,
          params: { name: w.name, days: w.retentionInDays, savings: retentionSavings.toFixed(2) },
          category: "RETENTION_ADJUST",
          estimatedSavingsUSD: retentionSavings,
          confidence: "MEDIUM",
          actionType: "REDUCE_RETENTION",
          currentRetentionDays: w.retentionInDays,
          recommendedRetentionDays: 30,
          commandPayload: `az monitor log-analytics workspace update --resource-group "${w.resourceGroup}" --workspace-name "${w.name}" --retention-time 30`,
        });
      }
    }

    // Regla 4: Workspace huérfano sin ingesta en > 60 días
    if (w.isOrphan) {
      actions.push({
        id: `rem-law-orphan-${w.id}`,
        resourceId: w.id,
        resourceName: w.name,
        params: { name: w.name },
        category: "PURGE_ORPHAN",
        estimatedSavingsUSD: w.totalRealCostUSD,
        confidence: "HIGH",
        actionType: "PURGE_ORPHAN",
        commandPayload: `az monitor log-analytics workspace delete --resource-group "${w.resourceGroup}" --workspace-name "${w.name}" --yes`,
      });
    }
  }

  return actions;
}

/**
 * Generates mock data for demo tenants and testing
 */
export function generateMockLogAnalyticsData(): LogAnalyticsPayload {
  const workspaces: LogAnalyticsResource[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-monitoring-prod/providers/microsoft.operationalinsights/workspaces/law-prod-core",
      name: "law-prod-core",
      location: "eastus2",
      resourceGroup: "rg-monitoring-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      pricingTier: "PerGB2018",
      retentionInDays: 90,
      totalBillableGB_MTD: 4200.0,
      avgDailyIngestionGB: 140.0,
      dailyCapGB: null,
      isDailyCapUnlimited: true,
      isDevOrTest: false,
      isOrphan: false,
      isWasteful: true,
      monthlyCostUSD: Number((4200.0 * LAW_PAYG_RATE_PER_GB).toFixed(2)), // $9,660.00
      specializedCostUSD: Number((4200.0 * (59 / 30) * LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH).toFixed(2)), // ~$991.20
      totalRealCostUSD: 10651.20,
      potentialSavingsUSD: 1470.00,
      primaryRecommendation: {
        category: "COMMITMENT_TIER",
        params: { name: "law-app-prod-eastus", tier: 100, gb: "140.0", payg: LAW_PAYG_RATE_PER_GB, rate: 1.96, savings: "1470.00" },
        savingsUSD: 1470.00,
      },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-security-prod/providers/microsoft.operationalinsights/workspaces/law-sentinel-prod",
      name: "law-sentinel-prod",
      location: "eastus2",
      resourceGroup: "rg-security-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      pricingTier: "CapacityReservation100GB",
      capacityReservationLevel: 100,
      retentionInDays: 180,
      totalBillableGB_MTD: 3100.0,
      avgDailyIngestionGB: 103.3,
      dailyCapGB: null,
      isDailyCapUnlimited: true,
      isDevOrTest: false,
      isOrphan: false,
      isWasteful: false,
      monthlyCostUSD: 5880.00,
      specializedCostUSD: Number((3100.0 * (149 / 30) * LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH).toFixed(2)),
      totalRealCostUSD: 7727.60,
      potentialSavingsUSD: 0,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-dev-backend/providers/microsoft.operationalinsights/workspaces/law-dev-backend",
      name: "law-dev-backend",
      location: "westeurope",
      resourceGroup: "rg-dev-backend",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev & Test Lab",
      pricingTier: "PerGB2018",
      retentionInDays: 30,
      totalBillableGB_MTD: 180.0,
      avgDailyIngestionGB: 6.0,
      dailyCapGB: null,
      isDailyCapUnlimited: true,
      isDevOrTest: true,
      isOrphan: false,
      isWasteful: true,
      monthlyCostUSD: Number((180.0 * LAW_PAYG_RATE_PER_GB).toFixed(2)), // $414.00
      specializedCostUSD: 0,
      totalRealCostUSD: 414.00,
      potentialSavingsUSD: 124.20,
      primaryRecommendation: {
        category: "DAILY_CAP",
        params: { name: "law-dev-sandbox", rg: "rg-dev-sandbox" },
        savingsUSD: 124.20,
      },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-staging-services/providers/microsoft.operationalinsights/workspaces/law-stg-services",
      name: "law-stg-services",
      location: "westeurope",
      resourceGroup: "rg-staging-services",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev & Test Lab",
      pricingTier: "PerGB2018",
      retentionInDays: 365,
      totalBillableGB_MTD: 450.0,
      avgDailyIngestionGB: 15.0,
      dailyCapGB: 20,
      isDailyCapUnlimited: false,
      isDevOrTest: true,
      isOrphan: false,
      isWasteful: true,
      monthlyCostUSD: Number((450.0 * LAW_PAYG_RATE_PER_GB).toFixed(2)), // $1,035.00
      specializedCostUSD: Number((450.0 * (334 / 30) * LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH).toFixed(2)), // ~$601.20
      totalRealCostUSD: 1636.20,
      potentialSavingsUSD: 420.80,
      primaryRecommendation: {
        category: "RETENTION_ADJUST",
        params: { name: "law-staging-apps", days: 365, savings: "310.00" },
        savingsUSD: 420.80,
      },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-legacy-migration/providers/microsoft.operationalinsights/workspaces/law-legacy-abandoned",
      name: "law-legacy-abandoned",
      location: "centralus",
      resourceGroup: "rg-legacy-migration",
      subscriptionId: "00000000-0000-0000-0000-000000000003",
      subscriptionName: "Legacy Systems",
      pricingTier: "PerGB2018",
      retentionInDays: 30,
      totalBillableGB_MTD: 0,
      avgDailyIngestionGB: 0,
      dailyCapGB: null,
      isDailyCapUnlimited: true,
      isDevOrTest: false,
      isOrphan: true,
      isWasteful: true,
      monthlyCostUSD: 0,
      specializedCostUSD: 0,
      totalRealCostUSD: 0,
      potentialSavingsUSD: 0,
      primaryRecommendation: {
        category: "PURGE_ORPHAN",
        params: { name: "law-legacy-unused" },
        savingsUSD: 0,
      },
    },
  ];

  const recommendations = generateLogAnalyticsRecommendations(workspaces);
  const summary = calculateLogAnalyticsSummary(workspaces, recommendations);

  const dailyIngestionTrend: LawDailyTrendPoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split("T")[0];
    const baseGB = 260 + Math.sin(i / 2) * 35 + (i % 7 === 0 ? 50 : 0);
    const ingestedGB = Number(baseGB.toFixed(1));
    const costUSD = Number((ingestedGB * 2.15).toFixed(2));

    dailyIngestionTrend.push({
      date: dateStr,
      ingestedGB,
      costUSD,
    });
  }

  return {
    summary,
    workspaces,
    remediationActions: recommendations,
    dailyIngestionTrend,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: [
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "00000000-0000-0000-0000-000000000003",
    ],
  };
}

/**
 * Fetches real Log Analytics Workspaces from Azure Resource Graph
 */
export async function fetchLogAnalyticsData(tenantId: string): Promise<LogAnalyticsPayload> {
  const credentials = await getAzureCredential(tenantId);
  if (!credentials) {
    return {
      summary: {
        totalMonthlyCostUSD: 0,
        totalIngestedGB: 0,
        potentialSavingsUSD: 0,
        commitmentCandidatesCount: 0,
        unlimitedCapCount: 0,
        workspacesCount: 0,
        breakdownByPricingTier: [],
      },
      workspaces: [],
      remediationActions: [],
      dailyIngestionTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: [],
    };
  }

  const client = await getResourceGraphClient(tenantId);
  const subMap = await getSubscriptionNameMap(tenantId, credentials).catch(() => new Map<string, string>());

  const query = `
    resources
    | where type =~ 'microsoft.operationalinsights/workspaces'
    | project
        id,
        name,
        location,
        resourceGroup,
        subscriptionId,
        skuName = tostring(properties.sku.name),
        capacityLevel = toint(properties.sku.capacityReservationLevel),
        retentionInDays = toint(properties.retentionInDays),
        dailyQuotaGb = toreal(properties.workspaceCapping.dailyQuotaGb),
        provisioningState = tostring(properties.provisioningState),
        tags
    | limit 1000
  `;

  const resARG: any = await withArgLimit(() =>
    client.resources({
      query,
      options: { resultFormat: "objectArray" },
    })
  );

  const rawRows: any[] = resARG.data || [];
  if (rawRows.length === 0) {
    return {
      summary: {
        totalMonthlyCostUSD: 0,
        totalIngestedGB: 0,
        potentialSavingsUSD: 0,
        commitmentCandidatesCount: 0,
        unlimitedCapCount: 0,
        workspacesCount: 0,
        breakdownByPricingTier: [],
      },
      workspaces: [],
      remediationActions: [],
      dailyIngestionTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: [],
    };
  }

  const availableSubs = Array.from(new Set(rawRows.map((r) => String(r.subscriptionId)).filter(Boolean)));

  // 1. Obtener costos reales MTD vía Azure Cost Management API
  const costByResourceId = new Map<string, number>();
  const resourceRefs = rawRows
    .map((w) => ({
      id: String(w.id || "").toLowerCase(),
      subscriptionId: String(w.subscriptionId || ""),
    }))
    .filter((r) => r.id && r.subscriptionId);

  if (resourceRefs.length > 0) {
    try {
      const byId = await getResourceCostsById(tenantId, resourceRefs);
      byId.forEach((value, key) => {
        costByResourceId.set(key.toLowerCase(), value);
      });
    } catch (e: unknown) {
      console.warn(`[Log Analytics] Error consultando Cost Management para ${tenantId}:`, e instanceof Error ? e.message : e);
    }
  }

  // 2. Complementar o fallback con CostSnapshots (almacenamiento local sincronizado)
  const dbCostMap = new Map<string, number>();
  const dbDailyTrend: LawDailyTrendPoint[] = [];
  try {
    const [costRows]: any = await pool.query(
      `SELECT resource_id, SUM(cost_usd) as totalCost
       FROM CostSnapshots
       WHERE tenant_id = ?
         AND (LOWER(service_name) LIKE '%log analytics%' OR LOWER(service_name) LIKE '%operational insights%' OR LOWER(service_name) LIKE '%azure monitor%')
         AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       GROUP BY resource_id`,
      [tenantId]
    );
    if (Array.isArray(costRows)) {
      for (const r of costRows) {
        if (r.resource_id) {
          dbCostMap.set(String(r.resource_id).toLowerCase(), Number(r.totalCost || 0));
        }
      }
    }

    const [trendRows]: any = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') as dayDate, SUM(cost_usd) as dailyCost
       FROM CostSnapshots
       WHERE tenant_id = ?
         AND (LOWER(service_name) LIKE '%log analytics%' OR LOWER(service_name) LIKE '%operational insights%' OR LOWER(service_name) LIKE '%azure monitor%')
         AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY dayDate
       ORDER BY dayDate ASC`,
      [tenantId]
    );
    if (Array.isArray(trendRows)) {
      for (const t of trendRows) {
        const cost = Number(t.dailyCost || 0);
        const gb = Number((cost / LAW_PAYG_RATE_PER_GB).toFixed(1));
        dbDailyTrend.push({
          date: String(t.dayDate),
          ingestedGB: gb,
          costUSD: Number(cost.toFixed(2)),
        });
      }
    }
  } catch (err) {
    console.warn(`[Log Analytics] CostSnapshots query failed for ${tenantId}:`, err instanceof Error ? err.message : err);
  }

  const currentDayOfMonth = Math.max(1, new Date().getDate());

  const workspaces: LogAnalyticsResource[] = rawRows.map((r) => {
    const subName = resolveSubscriptionName(r.subscriptionId, subMap);
    const pricingTier = r.skuName || "PerGB2018";
    const retentionInDays = Number(r.retentionInDays) || 30;
    const dailyQuotaGb = r.dailyQuotaGb !== null && r.dailyQuotaGb !== undefined && r.dailyQuotaGb > 0
      ? Number(r.dailyQuotaGb)
      : null;
    const isDailyCapUnlimited = dailyQuotaGb === null || dailyQuotaGb === -1;

    const rgLower = String(r.resourceGroup || "").toLowerCase();
    const nameLower = String(r.name || "").toLowerCase();
    const isDevOrTest =
      rgLower.includes("dev") ||
      rgLower.includes("test") ||
      rgLower.includes("stg") ||
      rgLower.includes("staging") ||
      rgLower.includes("lab") ||
      nameLower.includes("dev") ||
      nameLower.includes("test");

    const rId = String(r.id || "").toLowerCase();
    const costFromAzure = costByResourceId.get(rId);
    const costFromDB = dbCostMap.get(rId);
    const rawCost = costFromAzure !== undefined ? costFromAzure : (costFromDB !== undefined ? costFromDB : 0);
    const monthlyCostUSD = Number(rawCost.toFixed(2));

    // Cálculo de ingesta real / amortizada según costo real
    let totalBillableGB_MTD = 0;
    if (pricingTier.toLowerCase().includes("capacityreservation")) {
      const capLevel = r.capacityLevel || 100;
      totalBillableGB_MTD = monthlyCostUSD > 0
        ? Number((monthlyCostUSD / (capLevel === 100 ? 1.96 : 1.84)).toFixed(1))
        : capLevel * currentDayOfMonth;
    } else {
      totalBillableGB_MTD = monthlyCostUSD > 0
        ? Number((monthlyCostUSD / LAW_PAYG_RATE_PER_GB).toFixed(1))
        : 0;
    }

    const avgDailyIngestionGB = Number((totalBillableGB_MTD / currentDayOfMonth).toFixed(1));
    const extraRetentionDays = Math.max(0, retentionInDays - LAW_FREE_RETENTION_DAYS);
    const specializedCostUSD = extraRetentionDays > 0 && totalBillableGB_MTD > 0
      ? Number((totalBillableGB_MTD * (extraRetentionDays / 30) * LAW_EXTENDED_RETENTION_RATE_PER_GB_MONTH).toFixed(2))
      : 0;

    const totalRealCostUSD = Number((monthlyCostUSD + specializedCostUSD).toFixed(2));
    const isOrphan = totalRealCostUSD === 0 && totalBillableGB_MTD === 0;
    const isWasteful = (pricingTier === "PerGB2018" && avgDailyIngestionGB >= 100) || (isDevOrTest && isDailyCapUnlimited);

    return {
      id: r.id,
      name: r.name,
      location: r.location || "unknown",
      resourceGroup: r.resourceGroup || "unknown",
      subscriptionId: r.subscriptionId,
      subscriptionName: subName,
      pricingTier,
      capacityReservationLevel: r.capacityLevel || undefined,
      retentionInDays,
      totalBillableGB_MTD,
      avgDailyIngestionGB,
      dailyCapGB: dailyQuotaGb,
      isDailyCapUnlimited,
      isDevOrTest,
      isOrphan,
      isWasteful,
      monthlyCostUSD,
      specializedCostUSD,
      totalRealCostUSD,
      potentialSavingsUSD: 0,
    };
  });

  const recommendations = generateLogAnalyticsRecommendations(workspaces);
  for (const w of workspaces) {
    const rec = recommendations.find((r) => r.resourceId === w.id);
    if (rec) {
      w.potentialSavingsUSD = rec.estimatedSavingsUSD;
      w.primaryRecommendation = {
        category: rec.category,
        params: rec.params,
        savingsUSD: rec.estimatedSavingsUSD,
      };
    }
  }

  const summary = calculateLogAnalyticsSummary(workspaces, recommendations);

  // Evolución de los últimos 30 días
  let dailyIngestionTrend: LawDailyTrendPoint[] = [];
  if (dbDailyTrend.length > 0) {
    dailyIngestionTrend = dbDailyTrend;
  } else {
    const now = new Date();
    const totalDailyAvg = workspaces.reduce((sum, w) => sum + w.avgDailyIngestionGB, 0);

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split("T")[0];
      const dayFactor = totalDailyAvg > 0 ? 0.9 + (i % 5) * 0.05 : 0;
      const ingestedGB = Number((totalDailyAvg * dayFactor).toFixed(1));
      const costUSD = Number((ingestedGB * LAW_PAYG_RATE_PER_GB).toFixed(2));

      dailyIngestionTrend.push({
        date: dateStr,
        ingestedGB,
        costUSD,
      });
    }
  }

  return {
    summary,
    workspaces,
    remediationActions: recommendations,
    dailyIngestionTrend,
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: availableSubs,
  };
}
