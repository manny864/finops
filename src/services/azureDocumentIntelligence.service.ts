import { CostManagementClient } from "@azure/arm-costmanagement";
import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { Decimal } from "decimal.js";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import {
  buildDocIntelligenceRemediations,
  calculateDocIntelligencePotentialSavings,
} from "@/lib/azureDocumentIntelligence";
import { getDocIntelligenceMockPayload, isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import type {
  DocIntelligenceDailyPoint,
  DocIntelligenceModelBreakdown,
  DocIntelligencePayload,
  DocIntelligenceResource,
  DocIntelligenceSku,
} from "@/types/azureDocumentIntelligence.types";

const DEV_TEST_PATTERN = /dev|test|stage|staging|qa|sandbox|uat|demo/i;
const MODEL_COLORS = ["#0078D4", "#2563EB", "#0284C7", "#38BDF8", "#94A3B8"];
const RATE_PER_1000_PAGES: Record<string, Decimal> = {
  read: new Decimal("1.50"),
  layout: new Decimal("5.00"),
  specialized: new Decimal("10.00"),
  custom: new Decimal("37.50"),
  other: new Decimal("1.50"),
};
const TRAINING_RATE_PER_HOUR = new Decimal("21.00");

interface InventoryRow {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  skuName: string;
  endpoint?: string;
  publicNetworkAccess?: string;
  privateEndpointCount?: number;
}

interface ModelInventory {
  customModelsCount: number;
  primaryModelType: string;
}

interface MetricAggregate {
  totalPages: number;
  totalCalls: number;
  successfulCalls: number;
  trainingHours: number;
  clientErrors: number;
  serverErrors: number;
  daily: DocIntelligenceDailyPoint[];
  pagesByModel: Map<string, number>;
}

interface LiveInventoryResult {
  rows: InventoryRow[];
  failed: boolean;
}

function normalizeSku(value: unknown): DocIntelligenceSku {
  return String(value || "S0").toUpperCase() === "F0" ? "F0" : "S0";
}

function modelCategory(modelName: string): "read" | "layout" | "specialized" | "custom" | "other" {
  const normalized = modelName.toLowerCase();
  if (normalized.includes("custom")) return "custom";
  if (/invoice|receipt|identity|id document|tax|health insurance/.test(normalized)) return "specialized";
  if (normalized.includes("layout")) return "layout";
  if (normalized.includes("read") || normalized.includes("ocr")) return "read";
  return "other";
}

async function resolveSubscriptionNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const [rows]: any = await pool.query("SELECT subscription_id, subscription_name FROM Subscriptions");
    for (const row of rows || []) names.set(String(row.subscription_id).toLowerCase(), row.subscription_name || row.subscription_id);
  } catch { /* optional table */ }
  try {
    const [rows]: any = await pool.query("SELECT subscription_id, display_name FROM TenantSubscriptions");
    for (const row of rows || []) {
      const key = String(row.subscription_id).toLowerCase();
      if (!names.has(key)) names.set(key, row.display_name || row.subscription_id);
    }
  } catch { /* optional table */ }
  return names;
}

async function fetchLiveInventory(tenantId: string): Promise<LiveInventoryResult> {
  try {
    const credential = await getAzureCredential(tenantId);
    const subscriptions = await getSubscriptionsForTenant(tenantId, credential);
    if (subscriptions.length === 0) return { rows: [], failed: false };
    const query = `
      resources
      | where type =~ "microsoft.cognitiveservices/accounts"
      | where kind =~ "FormRecognizer" or kind =~ "AIServices" or kind =~ "DocumentIntelligence"
      | extend publicNetworkAccess = coalesce(tostring(properties.publicNetworkAccess), "Enabled")
      | extend privateEndpointCount = array_length(properties.privateEndpointConnections)
      | project id, name, location, resourceGroup, subscriptionId,
                skuName=tostring(sku.name), endpoint=tostring(properties.endpoint),
                publicNetworkAccess, privateEndpointCount
    `;
    const client = new ResourceGraphClient(credential);
    const response = await client.resources({ query, subscriptions });
    return { rows: ((response.data as InventoryRow[]) || []), failed: false };
  } catch (error) {
    console.error("[azureDocumentIntelligence] ARG inventory failed:", error);
    return { rows: [], failed: true };
  }
}

async function fetchModelInventory(
  credential: Awaited<ReturnType<typeof getAzureCredential>>,
  resource: InventoryRow
): Promise<ModelInventory> {
  const endpoint = String(resource.endpoint || "").replace(/\/$/, "");
  if (!endpoint) return { customModelsCount: 0, primaryModelType: "Sin modelos custom" };
  try {
    const token = await credential.getToken("https://cognitiveservices.azure.com/.default");
    if (!token?.token) return { customModelsCount: 0, primaryModelType: "Sin modelos custom" };
    const urls = [
      `${endpoint}/documentintelligence/models?api-version=2024-02-29-preview`,
      `${endpoint}/formrecognizer/documentModels?api-version=2023-07-31`,
    ];
    for (const url of urls) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
      if (!response.ok) continue;
      const body = await response.json();
      const models = Array.isArray(body?.value) ? body.value : [];
      const custom = models
        .filter((model: any) => !String(model.modelId || "").toLowerCase().startsWith("prebuilt-"))
        .sort((a: any, b: any) => String(b.createdDateTime || "").localeCompare(String(a.createdDateTime || "")));
      return {
        customModelsCount: custom.length,
        primaryModelType: custom.length > 0 ? `Custom Neural ${custom[0].modelId || "Model"}` : "Prebuilt / API usage",
      };
    }
  } catch (error) {
    console.warn(`[azureDocumentIntelligence] model inventory unavailable for ${resource.name}:`, error);
  }
  return { customModelsCount: 0, primaryModelType: "Prebuilt / API usage" };
}

function metricModelName(series: any): string {
  const metadata = series?.metadatavalues || series?.metadataValues || [];
  const model = metadata.find((item: any) => /model/i.test(String(item?.name?.value || item?.name || "")));
  return String(model?.value || model?.name?.value || "No atribuido");
}

async function fetchMetrics(
  credential: Awaited<ReturnType<typeof getAzureCredential>>,
  resource: InventoryRow,
  days: number | "mtd"
): Promise<MetricAggregate> {
  const actualDays = days === "mtd" ? new Date().getUTCDate() : days;
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, actualDays) * 86400000);
  const timespan = `${start.toISOString()}/${end.toISOString()}`;
  const daily = new Map<string, DocIntelligenceDailyPoint>();
  const pagesByModel = new Map<string, number>();
  const totals: Record<string, number> = {};
  const subscriptionId = resource.subscriptionId || resource.id.split("/")[2] || "";
  if (!subscriptionId) return { totalPages: 0, totalCalls: 0, successfulCalls: 0, trainingHours: 0, clientErrors: 0, serverErrors: 0, daily: [], pagesByModel };
  const monitor = new MonitorClient(credential, subscriptionId);
  const metricNames = ["ProcessedPages", "TotalCalls", "SuccessfulCalls", "TrainingHours", "ClientErrors", "ServerErrors"];

  for (const metricName of metricNames) {
    try {
      const result = await monitor.metrics.list(resource.id, {
        timespan,
        interval: "P1D",
        metricnames: metricName,
        aggregation: "Total",
      });
      let metricTotal = 0;
      for (const metric of result.value || []) {
        for (const series of metric.timeseries || []) {
          let seriesTotal = 0;
          for (const point of series.data || []) {
            const value = Number(point.total || 0);
            seriesTotal += value;
            metricTotal += value;
            const date = point.timeStamp ? new Date(point.timeStamp).toISOString().slice(0, 10) : "";
            if (!date) continue;
            const current = daily.get(date) || { date, pages: 0, calls: 0, errors: 0 };
            if (metricName === "ProcessedPages") current.pages += value;
            if (metricName === "TotalCalls" || (metricName === "SuccessfulCalls" && !totals.TotalCalls)) current.calls += value;
            if (metricName === "ClientErrors" || metricName === "ServerErrors") current.errors += value;
            daily.set(date, current);
          }
          if (metricName === "ProcessedPages" && seriesTotal > 0) {
            const modelName = metricModelName(series);
            pagesByModel.set(modelName, (pagesByModel.get(modelName) || 0) + seriesTotal);
          }
        }
      }
      totals[metricName] = metricTotal;
    } catch {
      totals[metricName] = 0;
    }
  }

  return {
    totalPages: totals.ProcessedPages || 0,
    totalCalls: totals.TotalCalls || totals.SuccessfulCalls || 0,
    successfulCalls: totals.SuccessfulCalls || 0,
    trainingHours: totals.TrainingHours || 0,
    clientErrors: totals.ClientErrors || 0,
    serverErrors: totals.ServerErrors || 0,
    daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
    pagesByModel,
  };
}

async function fetchActualCost(
  tenantId: string,
  credential: Awaited<ReturnType<typeof getAzureCredential>>,
  resource: InventoryRow
): Promise<number> {
  try {
    const subscriptionId = resource.subscriptionId || resource.id.split("/")[2] || "";
    if (!subscriptionId) return 0;
    const client = new CostManagementClient(credential);
    const result = await client.query.usage(`/subscriptions/${subscriptionId}`, {
      type: "Usage",
      timeframe: "MonthToDate",
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
        filter: { dimensions: { name: "ResourceId", operator: "In", values: [resource.id, resource.id.toLowerCase()] } },
      },
    } as any);
    const value = Number(result.rows?.[0]?.[0] || 0);
    return Number.isFinite(value) ? value : 0;
  } catch (error) {
    console.warn(`[azureDocumentIntelligence] Cost Management unavailable for ${resource.name}:`, error);
    try {
      const [rows]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS totalCost FROM CostMeterSnapshots
         WHERE tenant_id = ? AND LOWER(resource_id) = LOWER(?)
           AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        [tenantId, resource.id]
      );
      return Number(rows?.[0]?.totalCost || 0);
    } catch {
      return 0;
    }
  }
}

function allocateCosts(
  actualCost: number,
  metrics: MetricAggregate
): { trainingCost: number; inferenceCost: number; breakdown: DocIntelligenceModelBreakdown[]; prebuiltPages: number; customPages: number } {
  const weightedModels = Array.from(metrics.pagesByModel.entries()).map(([modelName, pagesCount]) => {
    const category = modelCategory(modelName);
    const weight = RATE_PER_1000_PAGES[category].times(pagesCount).div(1000);
    return { modelName, pagesCount, category, weight };
  });
  if (weightedModels.length === 0 && metrics.totalPages > 0) {
    weightedModels.push({ modelName: "No atribuido", pagesCount: metrics.totalPages, category: "other", weight: RATE_PER_1000_PAGES.other.times(metrics.totalPages).div(1000) });
  }
  const trainingWeight = TRAINING_RATE_PER_HOUR.times(metrics.trainingHours);
  const inferenceWeight = weightedModels.reduce((sum, model) => sum.plus(model.weight), new Decimal(0));
  const totalWeight = inferenceWeight.plus(trainingWeight);
  const actual = new Decimal(actualCost || 0);
  const trainingCost = totalWeight.gt(0) ? actual.times(trainingWeight).div(totalWeight) : new Decimal(0);
  const allocatedInference = actual.minus(trainingCost);
  const breakdown = weightedModels.map((model, index) => ({
    modelName: model.modelName,
    pagesCount: Math.round(model.pagesCount),
    costUSD: inferenceWeight.gt(0) ? allocatedInference.times(model.weight).div(inferenceWeight).toDecimalPlaces(2).toNumber() : 0,
    percentage: metrics.totalPages > 0 ? Number(new Decimal(model.pagesCount).div(metrics.totalPages).times(100).toFixed(1)) : 0,
    color: MODEL_COLORS[index % MODEL_COLORS.length],
  }));
  const customPages = weightedModels.filter((model) => model.category === "custom").reduce((sum, model) => sum + model.pagesCount, 0);
  const prebuiltPages = weightedModels.filter((model) => model.category !== "custom").reduce((sum, model) => sum + model.pagesCount, 0);
  return {
    trainingCost: trainingCost.toDecimalPlaces(2).toNumber(),
    inferenceCost: allocatedInference.toDecimalPlaces(2).toNumber(),
    breakdown,
    prebuiltPages: Math.round(prebuiltPages),
    customPages: Math.round(customPages),
  };
}

async function fetchSnapshotPayload(tenantId: string): Promise<DocIntelligencePayload> {
  const [rows]: any = await pool.query(
    `SELECT * FROM AzureDocumentIntelligenceSnapshots
     WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     ORDER BY snapshotDate DESC`,
    [tenantId]
  );
  const seen = new Set<string>();
  const names = await resolveSubscriptionNames();
  const resources: DocIntelligenceResource[] = [];
  for (const row of rows || []) {
    if (seen.has(row.resourceId)) continue;
    seen.add(row.resourceId);
    const subscriptionId = String(row.resourceId || "").split("/")[2] || "unknown";
    const totalPages = Number(row.usage_pagesProcessed || 0);
    const totalCost = Number(row.monthlyCostUSD || 0);
    resources.push({
      id: row.resourceId,
      name: row.resourceName,
      location: row.region || "Unknown",
      resourceGroup: row.resourceGroup || "Unknown",
      subscriptionId,
      subscriptionName: names.get(subscriptionId.toLowerCase()) || subscriptionId,
      skuName: normalizeSku(row.tier),
      totalPagesProcessed: totalPages,
      prebuiltPages: 0,
      customPages: 0,
      trainingHours: 0,
      trainingCostUSD: 0,
      inferenceCostUSD: totalCost,
      totalCostUSD: totalCost,
      primaryModelType: Number(row.customModelsCount || 0) > 0 ? "Custom (sin atribución de páginas)" : "No atribuido",
      isOrphan: totalPages === 0,
      customModelsCount: Number(row.customModelsCount || 0),
      isDevOrTest: DEV_TEST_PATTERN.test(row.resourceName || row.resourceGroup || ""),
    });
  }
  return buildPayload(resources, [], [], "snapshot");
}

function buildPayload(
  resources: DocIntelligenceResource[],
  breakdownRows: DocIntelligenceModelBreakdown[],
  daily: DocIntelligenceDailyPoint[],
  source: "live" | "snapshot" | "mock"
): DocIntelligencePayload {
  const totalCost = resources.reduce((sum, resource) => sum.plus(resource.totalCostUSD), new Decimal(0));
  const totalPages = resources.reduce((sum, resource) => sum + resource.totalPagesProcessed, 0);
  const prebuiltPages = resources.reduce((sum, resource) => sum + resource.prebuiltPages, 0);
  const customPages = resources.reduce((sum, resource) => sum + resource.customPages, 0);
  const totalTrainingHours = resources.reduce((sum, resource) => sum + resource.trainingHours, 0);
  const totalTrainingCost = resources.reduce((sum, resource) => sum.plus(resource.trainingCostUSD), new Decimal(0));
  const actions = buildDocIntelligenceRemediations(resources);
  const daysElapsed = Math.max(1, new Date().getUTCDate());
  const daysInMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate();
  return {
    summary: {
      totalCostUSD: totalCost.toDecimalPlaces(2).toNumber(),
      totalPages,
      avgCostPerPageUSD: totalPages > 0 ? totalCost.div(totalPages).toDecimalPlaces(6).toNumber() : 0,
      prebuiltSharePercentage: totalPages > 0 ? Number(new Decimal(prebuiltPages).div(totalPages).times(100).toFixed(1)) : 0,
      customSharePercentage: totalPages > 0 ? Number(new Decimal(customPages).div(totalPages).times(100).toFixed(1)) : 0,
      potentialSavingsUSD: calculateDocIntelligencePotentialSavings(actions),
      totalTrainingHours,
      totalTrainingCostUSD: totalTrainingCost.toDecimalPlaces(2).toNumber(),
      forecastEomUSD: totalCost.times(daysInMonth).div(daysElapsed).toDecimalPlaces(2).toNumber(),
      breakdownByModel: breakdownRows,
    },
    resources,
    remediationActions: actions,
    dailyProcessing: daily,
    source,
    computedAt: new Date().toISOString(),
  };
}

export async function getDocumentIntelligencePayload(
  tenantId: string,
  days: number | "mtd" = "mtd",
  forceMock = false
): Promise<DocIntelligencePayload> {
  if (forceMock || isMockTenant(tenantId)) return getDocIntelligenceMockPayload(tenantId, days);
  const inventory = await fetchLiveInventory(tenantId);
  if (inventory.failed) return fetchSnapshotPayload(tenantId);
  if (inventory.rows.length === 0) return buildPayload([], [], [], "live");

  const credential = await getAzureCredential(tenantId);
  const subscriptionNames = await resolveSubscriptionNames();
  const resources: DocIntelligenceResource[] = [];
  const breakdownMap = new Map<string, DocIntelligenceModelBreakdown>();
  const dailyMap = new Map<string, DocIntelligenceDailyPoint>();

  for (const row of inventory.rows) {
    const [metrics, models, actualCost] = await Promise.all([
      fetchMetrics(credential, row, days),
      fetchModelInventory(credential, row),
      fetchActualCost(tenantId, credential, row),
    ]);
    const allocation = allocateCosts(actualCost, metrics);
    for (const item of allocation.breakdown) {
      const current = breakdownMap.get(item.modelName);
      if (current) {
        current.pagesCount += item.pagesCount;
        current.costUSD = new Decimal(current.costUSD).plus(item.costUSD).toDecimalPlaces(2).toNumber();
      } else breakdownMap.set(item.modelName, { ...item });
    }
    for (const point of metrics.daily) {
      const current = dailyMap.get(point.date) || { date: point.date, pages: 0, calls: 0, errors: 0 };
      current.pages += point.pages;
      current.calls += point.calls;
      current.errors += point.errors;
      dailyMap.set(point.date, current);
    }
    const primaryMetricModel = allocation.breakdown.slice().sort((a, b) => b.pagesCount - a.pagesCount)[0]?.modelName;
    resources.push({
      id: row.id,
      name: row.name,
      location: row.location || "Unknown",
      resourceGroup: row.resourceGroup || "Unknown",
      subscriptionId: row.subscriptionId || row.id.split("/")[2] || "unknown",
      subscriptionName: subscriptionNames.get(String(row.subscriptionId || "").toLowerCase()) || row.subscriptionId || "Unknown",
      skuName: normalizeSku(row.skuName),
      totalPagesProcessed: Math.round(metrics.totalPages),
      prebuiltPages: allocation.prebuiltPages,
      customPages: allocation.customPages,
      trainingHours: Number(new Decimal(metrics.trainingHours).toDecimalPlaces(2)),
      trainingCostUSD: allocation.trainingCost,
      inferenceCostUSD: allocation.inferenceCost,
      totalCostUSD: Number(new Decimal(actualCost).toDecimalPlaces(2)),
      primaryModelType: primaryMetricModel && primaryMetricModel !== "No atribuido" ? primaryMetricModel : models.primaryModelType,
      isOrphan: metrics.totalPages === 0 && metrics.totalCalls === 0,
      customModelsCount: models.customModelsCount,
      totalCalls: Math.round(metrics.totalCalls),
      successfulCalls: Math.round(metrics.successfulCalls),
      clientErrors: Math.round(metrics.clientErrors),
      serverErrors: Math.round(metrics.serverErrors),
      publicNetworkAccess: String(row.publicNetworkAccess || "Enabled").toLowerCase() === "enabled",
      privateEndpointCount: Number(row.privateEndpointCount || 0),
      isDevOrTest: DEV_TEST_PATTERN.test(`${row.name} ${row.resourceGroup}`),
    });
  }

  const breakdown = Array.from(breakdownMap.values());
  const totalPages = breakdown.reduce((sum, item) => sum + item.pagesCount, 0);
  breakdown.forEach((item, index) => {
    item.percentage = totalPages > 0 ? Number(new Decimal(item.pagesCount).div(totalPages).times(100).toFixed(1)) : 0;
    item.color = MODEL_COLORS[index % MODEL_COLORS.length];
  });
  return buildPayload(
    resources,
    breakdown.sort((a, b) => b.pagesCount - a.pagesCount),
    Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    "live"
  );
}
