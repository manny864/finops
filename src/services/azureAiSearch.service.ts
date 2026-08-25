/**
 * Azure AI Search Service
 *
 * Dedicated backend for the "AI Search" sub-tab within the Azure AI module.
 *
 * Data flow:
 *   - Mock tenant → synthetic demo data (via mockData.ts).
 *   - Real tenant → queries Azure Resource Graph + Azure Monitor Metrics +
 *     Cost Management API for live data. Falls back to DB snapshots
 *     (AzureSearchSnapshots table) when live APIs are unavailable.
 *
 * Regla Cero: All monetary values use decimal strings — no floats.
 * Zero tolerance for mock fallbacks on real tenants.
 */

import { Decimal } from "decimal.js";
import { isMockTenant, getAiSearchMockPayload } from "@/lib/mockData";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { MonitorClient } from "@azure/arm-monitor";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureSearchRealCost } from "@/modules/collectors/azure/azureSearchCollector";
import pool from "@/modules/storage/db";
import type {
  AiSearchPayload,
  AiSearchSummary,
  AiSearchServiceItem,
  AiSearchSkuBreakdown,
  AiSearchRemediationAction,
  AiSearchSkuName,
  SemanticSearchTier,
} from "@/types/azureAiSearch.types";

// ── Constants ───────────────────────────────────────────────────────────────

/** Monthly cost per Search Unit by SKU (USD). */
const SKU_MONTHLY_COST_PER_SU: Record<string, number> = {
  free: 0,
  basic: 73.0,
  standard: 245.0,
  standard2: 980.0,
  standard3: 3920.0,
  storageoptimizedl1: 980.0,
  storageoptimizedl2: 3920.0,
};

/** Dev/test environment name patterns. */
const DEV_TEST_PATTERNS = /test|dev|stage|qa|sandbox|uat|demo|playground/i;

/** Blue-scale palette for SKU breakdown charts. */
const SKU_COLORS: Record<string, string> = {
  free: "#94A3B8",
  basic: "#38BDF8",
  standard: "#0078D4",
  standard2: "#2563EB",
  standard3: "#1E40AF",
  storageoptimizedl1: "#0284C7",
  storageoptimizedl2: "#0C4A6E",
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Main entry point: returns the full AI Search payload (summary + services + actions).
 */
export async function getAiSearchPayload(tenantId: string): Promise<AiSearchPayload> {
  // Mock-first
  if (isMockTenant(tenantId)) {
    return getAiSearchMockPayload(tenantId);
  }

  // Real tenant: fetch live data
  const services = await fetchLiveSearchServices(tenantId);
  const summary = computeSummary(services);
  const remediationActions = computeRemediationActions(services);

  return {
    summary,
    services,
    remediationActions,
  };
}

// ── Live Data Fetching ──────────────────────────────────────────────────────

async function fetchLiveSearchServices(tenantId: string): Promise<AiSearchServiceItem[]> {
  const services: AiSearchServiceItem[] = [];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential).catch(() => []);

    // Build subscription name lookup
    const subNameMap = new Map<string, string>();
    if (subs.length > 0) {
      // We'll resolve names from the subscriptions list
      for (const subId of subs) {
        subNameMap.set(subId.toLowerCase(), subId); // fallback to ID
      }
    }

    // Query Azure Resource Graph for search services
    const argClient = new ResourceGraphClient(credential);
    const query = `
      resources
      | where type =~ "microsoft.search/searchservices"
      | extend skuName = tolower(coalesce(tostring(sku.name), tostring(properties.sku.name), 'standard'))
      | extend replicaCount = coalesce(toint(properties.replicaCount), 1)
      | extend partitionCount = coalesce(toint(properties.partitionCount), 1)
      | extend semanticSearch = coalesce(tostring(properties.semanticSearch), 'disabled')
      | extend publicNetworkAccess = coalesce(tostring(properties.publicNetworkAccess), 'enabled')
      | extend indexCount = coalesce(toint(properties.indexCount), 0)
      | project
          id,
          name,
          location,
          resourceGroup,
          subscriptionId,
          skuName,
          replicaCount,
          partitionCount,
          semanticSearch,
          publicNetworkAccess,
          indexCount
    `;

    const requestOptions = subs.length > 0 ? { query, subscriptions: subs } : { query };
    const response = await argClient.resources(requestOptions);
    const rows = (response.data as any[]) || [];

    if (rows.length === 0) {
      // Live Azure query confirmed 0 search services -> purge stale snapshots
      pool.query(`DELETE FROM AzureSearchSnapshots WHERE tenantId = ?`, [tenantId]).catch(() => {});
      return [];
    }

    // Resolve subscription names
    await resolveSubscriptionNames(subNameMap);

    // Fetch metrics and cost for each service
    for (const row of rows) {
      const resourceId: string = row.id;
      const subId: string = row.subscriptionId || resourceId.split("/")[2] || "unknown";

      // Fetch metrics
      const metrics = await fetchSearchMetrics(tenantId, resourceId, subId, credential);

      // Fetch cost
      const cost = await fetchSearchCost(tenantId, resourceId, subId, credential);

      // Compute derived fields
      const skuName = normalizeSkuName(row.skuName || "standard");
      const replicaCount = row.replicaCount || 1;
      const partitionCount = row.partitionCount || 1;
      const searchUnits = replicaCount * partitionCount;
      const isDevOrTest = DEV_TEST_PATTERNS.test(row.name || "");
      const isOrphan = (row.indexCount || 0) === 0 && metrics.qpsAvg < 0.01;

      services.push({
        id: resourceId,
        name: row.name || "Unknown",
        location: row.location || "Unknown",
        resourceGroup: row.resourceGroup || "Unknown",
        subscriptionId: subId,
        subscriptionName: subNameMap.get(subId.toLowerCase()) || subId,
        skuName,
        replicaCount,
        partitionCount,
        searchUnits,
        semanticSearchTier: normalizeSemanticTier(row.semanticSearch || "disabled"),
        qpsAvg: metrics.qpsAvg,
        latencyMsAvg: metrics.latencyMsAvg,
        storageUsedGB: metrics.storageUsedGB,
        documentsCount: metrics.documentsCount,
        monthlyCostUSD: new Decimal(cost).toFixed(2),
        currentCostMtdUSD: new Decimal(cost).toFixed(2),
        isDevOrTest,
        isOrphan,
        indexCount: row.indexCount || 0,
        qpsPeak: metrics.qpsPeak,
        throttleRatePct: metrics.throttleRatePct,
        publicNetworkAccess: (row.publicNetworkAccess || "enabled") === "enabled",
      });
    }
  } catch (err) {
    console.error("[azureAiSearch.service] Error fetching live services:", err);
    // Fallback to DB snapshots only on actual connection/auth error
    return fetchSearchServicesFromSnapshots(tenantId);
  }

  return services;
}

async function resolveSubscriptionNames(
  subNameMap: Map<string, string>
): Promise<void> {
  // Try to resolve names from the Subscriptions table
  try {
    const [subRows]: any = await pool.query(
      `SELECT subscription_id, subscription_name FROM Subscriptions`
    );
    for (const s of subRows) {
      subNameMap.set((s.subscription_id || "").toLowerCase(), s.subscription_name || s.subscription_id);
    }
  } catch {
    // Silent — names will fall back to IDs
  }

  // Also try from TenantSubscriptions
  try {
    const [tsRows]: any = await pool.query(
      `SELECT subscription_id, display_name FROM TenantSubscriptions`
    );
    for (const s of tsRows) {
      const key = (s.subscription_id || "").toLowerCase();
      if (!subNameMap.has(key)) {
        subNameMap.set(key, s.display_name || s.subscription_id);
      }
    }
  } catch {
    // Silent
  }
}

interface SearchMetricsResult {
  qpsAvg: number;
  qpsPeak: number;
  latencyMsAvg: number;
  throttleRatePct: number;
  storageUsedGB: number;
  documentsCount: number;
}

async function fetchSearchMetrics(
  tenantId: string,
  resourceId: string,
  subscriptionId: string,
  credential: any
): Promise<SearchMetricsResult> {
  const result: SearchMetricsResult = {
    qpsAvg: 0,
    qpsPeak: 0,
    latencyMsAvg: 0,
    throttleRatePct: 0,
    storageUsedGB: 0,
    documentsCount: 0,
  };

  const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : resourceId.split("/")[2] || "";
  if (!sub) return result;

  try {
    const monitorClient = new MonitorClient(credential, sub);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 14 * 24 * 60 * 60 * 1000);
    const timespan = `${startTime.toISOString()}/${endTime.toISOString()}`;

    const metricDefs: Array<{ name: string; key: keyof SearchMetricsResult; agg: string }> = [
      { name: "SearchQueriesPerSecond", key: "qpsAvg", agg: "Average" },
      { name: "SearchLatency", key: "latencyMsAvg", agg: "Average" },
      { name: "ThrottledSearchQueriesPercentage", key: "throttleRatePct", agg: "Average" },
    ];

    for (const def of metricDefs) {
      try {
        const data = await monitorClient.metrics.list(resourceId, {
          timespan,
          interval: "P1D",
          metricnames: def.name,
          aggregation: def.agg,
        });

        if (data.value && data.value.length > 0) {
          const ts = data.value[0].timeseries;
          if (ts && ts.length > 0) {
            const points = ts[0].data || [];
            if (points.length > 0) {
              const values = points.map((p: any) => p.average || 0).filter((v: number) => v > 0);
              if (values.length > 0) {
                const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
                const peak = Math.max(...values);
                if (def.key === "qpsAvg") {
                  result.qpsAvg = Math.round(avg * 100) / 100;
                  result.qpsPeak = Math.round(peak * 100) / 100;
                } else {
                  (result as any)[def.key] = Math.round(avg * 100) / 100;
                }
              }
            }
          }
        }
      } catch {
        // Metric not available for this resource — leave at 0
      }
    }
  } catch {
    // Monitor not available
  }

  // Try to get storage/docs from DB snapshots
  try {
    const [snapRows]: any = await pool.query(
      `SELECT storageUsedGB, documentsCount FROM AzureSearchSnapshots
       WHERE tenantId = ? AND resourceId = ? ORDER BY snapshotDate DESC LIMIT 1`,
      [tenantId, resourceId]
    );
    if (snapRows.length > 0) {
      result.storageUsedGB = snapRows[0].storageUsedGB || 0;
      result.documentsCount = snapRows[0].documentsCount || 0;
    }
  } catch {
    // Silent
  }

  return result;
}

async function fetchSearchCost(
  tenantId: string,
  resourceId: string,
  subscriptionId: string,
  credential: any
): Promise<number> {
  const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : resourceId.split("/")[2] || "";

  // 1. Try real cost discovery across Cost Management, CostMeterSnapshots, and CostSnapshots
  try {
    const realCost = await getAzureSearchRealCost(tenantId, credential, resourceId, sub);
    if (realCost > 0) return realCost;
  } catch (err) {
    console.warn("[azureAiSearch.service] getAzureSearchRealCost error:", err);
  }

  // 2. Try DB snapshots as last resort
  try {
    const [snapRows]: any = await pool.query(
      `SELECT monthlyCostUSD FROM AzureSearchSnapshots
       WHERE tenantId = ? AND resourceId = ? ORDER BY snapshotDate DESC LIMIT 1`,
      [tenantId, resourceId]
    );
    if (snapRows.length > 0 && snapRows[0].monthlyCostUSD > 0) {
      return snapRows[0].monthlyCostUSD;
    }
  } catch {
    // Silent
  }

  return 0;
}

async function fetchSearchServicesFromSnapshots(tenantId: string): Promise<AiSearchServiceItem[]> {
  const services: AiSearchServiceItem[] = [];

  try {
    const [rows]: any = await pool.query(
      `SELECT * FROM AzureSearchSnapshots
       WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       ORDER BY snapshotDate DESC`,
      [tenantId]
    );

    // Deduplicate by resourceId, keeping the latest snapshot
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.resourceId)) continue;
      seen.add(row.resourceId);

      const skuName = normalizeSkuName(row.skuName || "standard");
      const replicaCount = row.replicaCount || 1;
      const partitionCount = row.partitionCount || 1;

      services.push({
        id: row.resourceId,
        name: row.resourceName || "Unknown",
        location: row.region || "Unknown",
        resourceGroup: row.resourceGroup || "Unknown",
        subscriptionId: row.subscriptionId || "unknown",
        subscriptionName: row.subscriptionName || row.subscriptionId || "Unknown",
        skuName,
        replicaCount,
        partitionCount,
        searchUnits: replicaCount * partitionCount,
        semanticSearchTier: (row.semanticSearchTier as SemanticSearchTier) || "disabled",
        qpsAvg: row.usage_qps || 0,
        latencyMsAvg: row.usage_latencyMs || 0,
        storageUsedGB: row.storageUsedGB || 0,
        documentsCount: row.documentsCount || 0,
        monthlyCostUSD: new Decimal(row.monthlyCostUSD || 0).toFixed(2),
        currentCostMtdUSD: new Decimal(row.monthlyCostUSD || 0).toFixed(2),
        isDevOrTest: DEV_TEST_PATTERNS.test(row.resourceName || ""),
        isOrphan: (row.indexCount || 0) === 0 && (row.usage_qps || 0) < 0.01,
        indexCount: row.indexCount || 0,
        qpsPeak: row.usage_qpsPeak || 0,
        throttleRatePct: row.usage_throttledPercent || 0,
        publicNetworkAccess: row.publicNetworkAccess !== false,
      });
    }
  } catch (err) {
    console.error("[azureAiSearch.service] Error reading snapshots:", err);
  }

  return services;
}

// ── Summary Computation ─────────────────────────────────────────────────────

function computeSummary(services: AiSearchServiceItem[]): AiSearchSummary {
  const totalMonthlyCost = services.reduce(
    (sum, s) => sum.plus(new Decimal(s.monthlyCostUSD)),
    new Decimal(0)
  );
  const totalSearchUnits = services.reduce((sum, s) => sum + s.searchUnits, 0);
  const totalDocuments = services.reduce((sum, s) => sum + s.documentsCount, 0);
  const totalIndexes = services.reduce((sum, s) => sum + s.indexCount, 0);
  const avgQps = services.length > 0
    ? services.reduce((sum, s) => sum + s.qpsAvg, 0) / services.length
    : 0;
  const avgLatency = services.length > 0
    ? services.reduce((sum, s) => sum + s.latencyMsAvg, 0) / services.length
    : 0;

  // Compute potential savings
  const potentialSavings = computePotentialSavings(services);

  // SKU breakdown
  const skuMap = new Map<string, { cost: Decimal; count: number }>();
  for (const s of services) {
    const key = s.skuName;
    const existing = skuMap.get(key) || { cost: new Decimal(0), count: 0 };
    existing.cost = existing.cost.plus(new Decimal(s.monthlyCostUSD));
    existing.count++;
    skuMap.set(key, existing);
  }

  const breakdownBySku: AiSearchSkuBreakdown[] = [];
  const totalCostNum = totalMonthlyCost.toNumber();
  for (const [sku, data] of skuMap.entries()) {
    breakdownBySku.push({
      sku,
      costUSD: data.cost.toFixed(2),
      count: data.count,
      percentage: totalCostNum > 0
        ? Math.round((data.cost.toNumber() / totalCostNum) * 10000) / 100
        : 0,
      color: SKU_COLORS[sku.toLowerCase()] || "#0078D4",
    });
  }

  return {
    currentCostMtdUSD: totalMonthlyCost.toFixed(2),
    totalMonthlyCostUSD: totalMonthlyCost.toFixed(2),
    totalSearchUnits,
    totalServicesCount: services.length,
    totalDocumentsCount: totalDocuments,
    totalIndexesCount: totalIndexes,
    potentialSavingsUSD: potentialSavings.toFixed(2),
    avgQps: Math.round(avgQps * 100) / 100,
    avgLatencyMs: Math.round(avgLatency * 100) / 100,
    breakdownBySku,
    computedAt: new Date().toISOString(),
    source: "live",
  };
}

function computePotentialSavings(services: AiSearchServiceItem[]): Decimal {
  let savings = new Decimal(0);

  for (const s of services) {
    // Rule 1: Dev/Test with Standard SKU and low storage → downgrade to Basic
    if (s.isDevOrTest && (s.skuName === "Standard" || s.skuName === "Standard2" || s.skuName === "Standard3") && s.storageUsedGB < 2) {
      const currentCost = new Decimal(s.monthlyCostUSD);
      const basicCost = new Decimal(s.searchUnits).times(SKU_MONTHLY_COST_PER_SU.basic || 73);
      const diff = currentCost.minus(basicCost);
      if (diff.gt(0)) savings = savings.plus(diff);
    }

    // Rule 2: Orphan service → full elimination
    if (s.isOrphan) {
      savings = savings.plus(new Decimal(s.monthlyCostUSD));
    }

    // Rule 3: Excess replicas with low QPS
    if (s.replicaCount > 1 && s.qpsAvg < 2) {
      const excessReplicas = s.replicaCount - 1;
      const costPerReplica = new Decimal(s.monthlyCostUSD).div(s.replicaCount);
      savings = savings.plus(costPerReplica.times(excessReplicas).times(0.5)); // 50% of excess replica cost
    }
  }

  return savings;
}

// ── Remediation Actions ─────────────────────────────────────────────────────

function computeRemediationActions(services: AiSearchServiceItem[]): AiSearchRemediationAction[] {
  const actions: AiSearchRemediationAction[] = [];
  let actionId = 1;

  for (const s of services) {
    // Rule 1: Dev/Test downgrade — any Standard-family SKU
    if (s.isDevOrTest && (s.skuName === "Standard" || s.skuName === "Standard2" || s.skuName === "Standard3") && s.storageUsedGB < 2) {
      const currentCost = new Decimal(s.monthlyCostUSD);
      const basicCost = new Decimal(s.searchUnits).times(SKU_MONTHLY_COST_PER_SU.basic || 73);
      const diff = currentCost.minus(basicCost);
      if (diff.gt(0)) {
        actions.push({
          id: `search-action-${actionId++}`,
          serviceId: s.id,
          serviceName: s.name,
          title: `Downgrade ${s.name} de Standard a Basic`,
          description: `El servicio "${s.name}" es un entorno de desarrollo/pruebas con SKU Standard S1 y solo ${s.storageUsedGB.toFixed(1)} GB de almacenamiento. Downgradear a Basic ahorraría aproximadamente $${diff.toFixed(2)} USD/mes sin impacto en el desarrollo.`,
          category: "DOWNGRADE_TIER",
          estimatedSavingsUSD: diff.toFixed(2),
          confidence: "HIGH",
          actionType: "SKU_CHANGE",
          commandPayload: `az search service update --name "${s.name}" --resource-group "${s.resourceGroup}" --sku Basic`,
        });
      }
    }

    // Rule 2: Orphan service
    if (s.isOrphan) {
      actions.push({
        id: `search-action-${actionId++}`,
        serviceId: s.id,
        serviceName: s.name,
        title: `Eliminar servicio huérfano ${s.name}`,
        description: `El servicio "${s.name}" no tiene índices activos ni ha recibido consultas en los últimos 30 días. Eliminarlo ahorraría $${s.monthlyCostUSD} USD/mes.`,
        category: "ORPHAN_SERVICE",
        estimatedSavingsUSD: s.monthlyCostUSD,
        confidence: "HIGH",
        actionType: "DELETE_RESOURCE",
        commandPayload: `az search service delete --name "${s.name}" --resource-group "${s.resourceGroup}" --yes`,
      });
    }

    // Rule 3: Excess replicas
    if (s.replicaCount > 1 && s.qpsAvg < 2) {
      const excessReplicas = s.replicaCount - 1;
      const costPerReplica = new Decimal(s.monthlyCostUSD).div(s.replicaCount);
      const savings = costPerReplica.times(excessReplicas).times(0.5);
      if (savings.gt(0)) {
        actions.push({
          id: `search-action-${actionId++}`,
          serviceId: s.id,
          serviceName: s.name,
          title: `Reducir réplicas de ${s.replicaCount} a 1 en ${s.name}`,
          description: `El servicio "${s.name}" tiene ${s.replicaCount} réplicas pero solo ${s.qpsAvg} QPS promedio. Reducir a 1 réplica ahorraría ~$${savings.toFixed(2)} USD/mes.`,
          category: "REDUCE_REPLICAS",
          estimatedSavingsUSD: savings.toFixed(2),
          confidence: "MEDIUM",
          actionType: "REPLICA_SCALE",
          commandPayload: `az search service update --name "${s.name}" --resource-group "${s.resourceGroup}" --replica-count 1`,
        });
      }
    }

    // Rule 4: Semantic ranker audit for Free tier
    if (s.semanticSearchTier === "free" && s.qpsAvg > 5) {
      actions.push({
        id: `search-action-${actionId++}`,
        serviceId: s.id,
        serviceName: s.name,
        title: `Evaluar upgrade de Semantic Ranker en ${s.name}`,
        description: `"${s.name}" usa Semantic Ranker en tier Free con ${s.qpsAvg} QPS. Si supera los límites del tier gratuito, considera migrar a Standard para evitar degradación.`,
        category: "SEMANTIC_RANKER_AUDIT",
        estimatedSavingsUSD: "0.00",
        confidence: "MEDIUM",
        actionType: "SEMANTIC_TIER_REVIEW",
      });
    }
  }

  // Sort by savings descending
  actions.sort((a, b) =>
    new Decimal(b.estimatedSavingsUSD).minus(new Decimal(a.estimatedSavingsUSD)).toNumber()
  );

  return actions;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeSkuName(raw: string): AiSearchSkuName {
  const n = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.includes("free")) return "Free";
  if (n.includes("basic")) return "Basic";
  if (n.includes("storageoptimizedl2") || n.includes("l2")) return "StorageOptimizedL2";
  if (n.includes("storageoptimizedl1") || n.includes("l1")) return "StorageOptimizedL1";
  if (n.includes("standard3") || n.includes("s3")) return "Standard3";
  if (n.includes("standard2") || n.includes("s2")) return "Standard2";
  if (n.includes("standard") || n.includes("s1")) return "Standard";
  return "Standard";
}

function normalizeSemanticTier(raw: string): SemanticSearchTier {
  const n = raw.toLowerCase();
  if (n === "standard") return "standard";
  if (n === "free") return "free";
  return "disabled";
}