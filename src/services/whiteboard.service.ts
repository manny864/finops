import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential } from "@/lib/azure";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";
import { translateAdvisorText } from "@/lib/advisorI18n";
import { parseAzureNumber } from "@/lib/advisorModel";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { formatCurrencyAxis } from "@/lib/whiteboard";
import type {
  WhiteboardSummary,
  WhiteboardForecastData,
  WhiteboardBudgetEntry,
  WhiteboardTopServiceItem,
  WhiteboardQuickWinItem,
  WhiteboardGovernanceSecurity,
  WhiteboardAdvisorPillars,
  WhiteboardCostTrendPoint,
  WhiteboardExecutivePayload,
} from "@/types/whiteboard.types";

export { formatCurrencyAxis };

export interface CurrentMonthCostAggregation {
  totalUSD: number;
  byService: Map<string, number>;
  byCostCenter: Map<string, number>;
}

export function readCostCenter(tags: unknown): string {
  if (!tags) return "Sin asignar";
  try {
    const parsed = typeof tags === "string" ? JSON.parse(tags) : tags;
    if (parsed && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>).CostCenter;
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return "Sin asignar";
  }
  return "Sin asignar";
}

export async function getCurrentMonthCostAggregation(tenantId: string): Promise<CurrentMonthCostAggregation> {
  let entries: Array<Record<string, unknown>> = [];
  try {
    entries = (await getCurrentMonthAmortizedCosts(tenantId, "All", "ActualCost")) as unknown as Array<Record<string, unknown>>;
  } catch (error) {
    console.warn("[whiteboard.service] live Cost Management aggregation failed:", error);
  }

  if (entries.length === 0) {
    try {
      const [rows]: any = await pool.query(
        `SELECT
            COALESCE(ServiceName, service_name, 'Other') AS serviceName,
            Tags,
            COALESCE(EffectiveCost, cost_usd, 0) AS effectiveCost
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        [tenantId]
      );
      entries = rows as Array<Record<string, unknown>>;
    } catch (dbErr) {
      console.warn("[whiteboard.service] fallback database query failed:", dbErr);
    }
  }

  const byService = new Map<string, number>();
  const byCostCenter = new Map<string, number>();
  let totalUSD = 0;
  for (const entry of entries) {
    const cost = Number(entry.EffectiveCost ?? entry.effectiveCost ?? entry.BilledCost ?? entry.cost_usd ?? 0);
    if (!Number.isFinite(cost)) continue;
    totalUSD += cost;
    const service = String(entry.ServiceName ?? entry.serviceName ?? entry.service_name ?? "Other");
    const costCenter = readCostCenter(entry.Tags ?? entry.tags);
    byService.set(service, (byService.get(service) || 0) + cost);
    byCostCenter.set(costCenter, (byCostCenter.get(costCenter) || 0) + cost);
  }

  return {
    totalUSD: Number(totalUSD.toFixed(2)),
    byService,
    byCostCenter,
  };
}

export function extractReadableResourceName(rawImpacted: string, rawResourceId: string): string {
  const impacted = String(rawImpacted || "").trim();
  const resourceId = String(rawResourceId || "").trim();

  // If impactedValue is already a clean name (not a full ARM resource path)
  if (impacted && !impacted.startsWith("/subscriptions/") && !impacted.includes("/") && impacted.length < 80) {
    return impacted;
  }

  // Extract resource name from ARM resource ID
  const targetPath = resourceId || impacted;
  if (targetPath.includes("/")) {
    const segments = targetPath.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && !last.startsWith("{") && !last.endsWith("}")) {
      return last;
    }
    const secondLast = segments[segments.length - 2];
    if (secondLast) return secondLast;
  }

  return "Recurso Azure";
}

export function extractSavings(rec: any): number {
  const raw = rec?.extendedProperties?.annualSavingsAmount || rec?.extendedProperties?.savingsAmount;
  return parseAzureNumber(raw);
}

export function buildQuickWinCliCommand(win: { actionType: string; resourceName: string; resourceType?: string }): string {
  switch (win.actionType) {
    case "rightsizing":
      return `az vm update --resource-group "rg-prod" --name "${win.resourceName}" --set hardwareProfile.vmSize="Standard_D4s_v5"`;
    case "delete_orphan":
      return `az disk delete --resource-group "rg-storage" --name "${win.resourceName}" --yes`;
    case "apply_tags":
      return `az tag update --resource-id "/subscriptions/.../resourceGroups/${win.resourceName}" --operation Merge --tags CostCenter="Infrastructure"`;
    default:
      return `az advisor recommendation list --query "[?contains(id, '${win.resourceName}')]" -o table`;
  }
}

export async function getWhiteboardExecutiveData(
  tenantId: string,
  locale = "es",
  forceMock = false
): Promise<WhiteboardExecutivePayload> {
  if (forceMock || isMockTenant(tenantId)) {
    const mockPayload = getMockDataForRoute("white_board", tenantId, locale);
    return mockPayload as WhiteboardExecutivePayload;
  }

  const argClient = new ResourceGraphClient(await getAzureCredential(tenantId));
  const currentMonth = await getCurrentMonthCostAggregation(tenantId);
  const now = new Date();

  // 1. Cost Figures
  const costMtdUSD = currentMonth.totalUSD;
  const daysElapsedMonth = Math.max(1, now.getUTCDate());
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const forecastEomUSD = Number(((costMtdUSD / daysElapsedMonth) * daysInMonth).toFixed(2));

  // Top services (without artificial total)
  const topServices: WhiteboardTopServiceItem[] = [...currentMonth.byService.entries()]
    .map(([serviceName, cost]) => ({
      serviceName,
      costUSD: Number(cost.toFixed(2)),
      percentage: costMtdUSD > 0 ? Number(((cost / costMtdUSD) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.costUSD - a.costUSD)
    .slice(0, 4);

  // 2. Cost trend (last 3 months)
  const costTrend: WhiteboardCostTrendPoint[] = [];
  for (let i = 2; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59));
    const monthLabel = start.toISOString().slice(0, 7);
    let monthCost = 0;
    try {
      const [r]: any = await pool.query(
        `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
         FROM CostSnapshots WHERE tenant_id = ? AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?`,
        [tenantId, start, end]
      );
      monthCost = Number(r?.[0]?.total || 0);
    } catch {
      monthCost = 0;
    }
    costTrend.push({
      month: monthLabel,
      actualCostUSD: i === 0 && monthCost === 0 ? costMtdUSD : Number(monthCost.toFixed(2)),
    });
  }

  const prevMonthCost = costTrend[1]?.actualCostUSD || 0;
  const momVariationPct = prevMonthCost > 0
    ? Number((((costMtdUSD - prevMonthCost) / prevMonthCost) * 100).toFixed(1))
    : 0;

  // 3. Budgets
  let budgets: WhiteboardBudgetEntry[] = [];
  try {
    const [rows]: any = await pool.query(
      `SELECT cost_center_name AS costCenterName, monthly_budget_usd AS allocatedBudgetUSD
       FROM CostCenterBudgets WHERE tenant_id = ?`,
      [tenantId]
    );
    budgets = (rows as any[]).map((row) => {
      const budget = Number(row.allocatedBudgetUSD || 0);
      const spend = currentMonth.byCostCenter.get(String(row.costCenterName)) || 0;
      return {
        costCenterName: String(row.costCenterName || "Sin asignar"),
        allocatedBudgetUSD: Number(budget.toFixed(2)),
        currentSpendUSD: Number(spend.toFixed(2)),
        percentageUsed: budget > 0 ? Number(((spend / budget) * 100).toFixed(1)) : 0,
      };
    });
  } catch (err) {
    console.warn("[whiteboard.service] budgets query failed:", err);
  }

  // 4. Governance & Untagged Resources from Azure Resource Graph
  let untaggedCount = 0;
  let totalResources = 0;
  let unallocatedSpendUSD = 0;
  try {
    const query = `
      Resources
      | extend costCenter = tostring(tags.CostCenter)
      | summarize total = count(), untagged = countif(isempty(costCenter))
    `;
    const resp = await argClient.resources({ query, managementGroups: [tenantId] });
    const row = (resp.data as any[])?.[0] || { total: 0, untagged: 0 };
    totalResources = Number(row.total) || 0;
    untaggedCount = Number(row.untagged) || 0;
  } catch (err) {
    console.warn("[whiteboard.service] ARG untagged query failed:", err);
  }

  unallocatedSpendUSD = currentMonth.byCostCenter.get("Sin asignar") || 0;
  const tagCoveragePct = totalResources > 0
    ? Number((((totalResources - untaggedCount) / totalResources) * 100).toFixed(1))
    : 100;

  // 5. Azure Advisor data collection & Quick Wins Deduplication
  let advisorData: any = { recommendations: { Cost: [], Security: [], HighAvailability: [], Performance: [] } };
  try {
    advisorData = await collectAdvisorData(tenantId, locale);
  } catch (err) {
    console.warn("[whiteboard.service] Advisor data collection failed:", err);
  }

  const allRecs = Object.values(advisorData.recommendations || {}).flat() as any[];
  const securityRecs = (advisorData.recommendations?.Security || []) as any[];
  const costRecs = (advisorData.recommendations?.Cost || []) as any[];

  const advisorPillars: WhiteboardAdvisorPillars = {
    cost: costRecs.length,
    security: securityRecs.length,
    reliability: (advisorData.recommendations?.HighAvailability || []).length,
    performance: (advisorData.recommendations?.Performance || []).length,
  };

  const topSecurityActions: string[] = securityRecs.slice(0, 3).map((rec: any) =>
    translateAdvisorText(
      rec.shortDescription?.solution || rec.shortDescription?.problem || "Revisar configuración de seguridad",
      locale,
      "solution"
    )
  );

  // Deduplicate Quick Wins by unique resource ID / problem signature
  const seenWins = new Set<string>();
  const quickWins: WhiteboardQuickWinItem[] = [];

  for (const rec of allRecs) {
    const rawTitle = rec.shortDescription?.solution || rec.shortDescription?.problem || "Optimización recomendada";
    const resourceName = extractReadableResourceName(rec.impactedValue, rec.resourceMetadata?.resourceId);
    const category = rec.category === "Security" ? "Security" : rec.category === "Cost" ? "Cost" : "Governance";
    const annualSavings = extractSavings(rec);
    const monthlySavings = Number((annualSavings / 12).toFixed(2));
    const dedupKey = `${category}-${resourceName}-${rawTitle}`.toLowerCase();

    if (seenWins.has(dedupKey)) continue;
    seenWins.add(dedupKey);

    const actionType = category === "Cost" ? "rightsizing" : "review";
    quickWins.push({
      id: String(rec.id || rec.name || dedupKey),
      title: translateAdvisorText(rawTitle, locale, "solution"),
      resourceName,
      resourceType: String(rec.impactedField || "Recurso Azure"),
      monthlySavingsUSD: monthlySavings,
      actionType,
      commandPayload: buildQuickWinCliCommand({ actionType, resourceName, resourceType: rec.impactedField }),
    });
  }

  // Sort by highest monthly savings and take top 3
  const top3QuickWins = quickWins
    .sort((a, b) => b.monthlySavingsUSD - a.monthlySavingsUSD)
    .slice(0, 3);

  const potentialSavingsUSD = quickWins.reduce((sum, w) => sum + w.monthlySavingsUSD, 0);

  const summary: WhiteboardSummary = {
    costMtdUSD,
    forecastEomUSD,
    zombieCount: 0,
    zombieSavingsUSD: 0,
    potentialSavingsUSD: Number(potentialSavingsUSD.toFixed(2)),
    carbonKgCO2e: 0,
    lastSyncDate: new Date().toISOString(),
    momVariationPct,
  };

  return {
    summary: {
      ...summary,
      zombieResourcesCount: 0,
      zombieMonthlyWasteUSD: 0,
      cacheTimestamp: new Date().toISOString(),
    },
    budgets,
    topServices: topServices.map((s) => ({
      serviceName: s.serviceName,
      monthlyCostUSD: s.costUSD,
      sharePercentage: s.percentage,
    })),
    quickWins: top3QuickWins.map((w) => ({
      id: w.id,
      title: w.title,
      category: "Cost",
      resourceName: w.resourceName,
      estimatedMonthlySavingsUSD: w.monthlySavingsUSD,
      actionType: w.actionType,
      description: w.title,
    })),
    advisorPillars,
    securityActions: topSecurityActions,
    costTrend,
    tagCoveragePct,
    untaggedResourcesCount: untaggedCount,
    unallocatedCostUSD: Number(unallocatedSpendUSD.toFixed(2)),
  };
}
