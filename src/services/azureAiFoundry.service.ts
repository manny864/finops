/**
 * Azure AI Foundry Service
 *
 * Dedicated backend for the "Azure Foundry" sub-tab.
 * Wraps the existing /api/intelligence/ai-analytics data pipeline and enriches
 * it with Foundry-specific metrics: prompt caching, PTU arbitrage detection,
 * idle deployment identification, and showback governance.
 *
 * Data flow:
 *   - Mock tenant → synthetic demo data.
 *   - Real tenant → queries AICostSnapshots + Cost Management (same pipeline
 *     as ai-analytics), then enriches with Foundry-specific logic.
 *
 * Regla Cero: All monetary values use decimal strings — no floats.
 */

import { Decimal } from "decimal.js";
import { isMockTenant } from "@/lib/mockData";
import pool, { insertAICostSnapshotRow } from "@/modules/storage/db";
import { getHistoricalAIUsage } from "@/modules/collectors/azure/aiUsageCollector";
import { getAzureFoundryDeployments } from "@/modules/collectors/azure/foundryCollector";
import { selectLatestAzureAiSnapshots } from "@/lib/azureAiCost";
import type {
  FoundryDetailPayload,
  FoundrySummaryMetrics,
  FoundryModelUsageItem,
  FoundryApplicationConsumer,
  FoundryTimeSeriesPoint,
  FoundryRemediationAction,
} from "@/types/azureAiFoundry.types";

// ── Constants ───────────────────────────────────────────────────────────────

/** Approximate per-1K-token prices for common models (USD). Used as fallback. */
const MODEL_PRICE_PER_1K: Record<string, { input: number; output: number }> = {
  // Modelos Azure AI Foundry (generación 5.x)
  "gpt-5.6-sol": { input: 0.002, output: 0.0075 },
  "gpt-5.6-terra": { input: 0.001, output: 0.0036 },
  "gpt-5.3-codex": { input: 0.0015, output: 0.0055 },
  "gpt-5.1": { input: 0.0025, output: 0.008 },
  "gpt-5": { input: 0.003, output: 0.01 },
  // Modelos Azure OpenAI clásicos
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4": { input: 0.03, output: 0.06 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-35-turbo": { input: 0.0005, output: 0.0015 },
  "gpt-4-32k": { input: 0.06, output: 0.12 },
  "text-embedding-3-large": { input: 0.00013, output: 0 },
  "text-embedding-3-small": { input: 0.00002, output: 0 },
  "text-embedding-ada-002": { input: 0.0001, output: 0 },
  "dall-e-3": { input: 0, output: 0.04 },
};

// ── Mock Data ───────────────────────────────────────────────────────────────

function generateMockPayload(days: number | "mtd"): FoundryDetailPayload {
  const now = new Date().toISOString();
  const actualDays = days === "mtd" ? new Date().getDate() : Number(days);

  const metrics: FoundrySummaryMetrics = {
    totalRequests: 2440,
    avgRequestsPerDay: Math.round(2440 / Math.max(1, actualDays)),
    totalTokens: 578930,
    avgTokensPerRequest: 237,
    estimatedCostUSD: "2.15",
    forecastCostUSD: "2.37",
    inputTokens: 570140,
    promptCacheHitRate: 12.5,
    outputTokens: 8790,
    avgCostPer1kOutputTokensUSD: "0.245",
    cachedTokens: 71268,
    activeDeployments: 4,
    activeApplications: 7,
    billingModel: "PAYG",
    computedAt: now,
    source: "mock",
  };

  const modelUsage: FoundryModelUsageItem[] = [
    {
      deploymentName: "gpt-4o-mini-prod",
      modelName: "gpt-4o-mini",
      modelVersion: "2024-07-18",
      inputTokens: 450000,
      outputTokens: 6200,
      cachedTokens: 55000,
      costPer1kTokensUSD: "0.0006",
      totalCostUSD: "1.35",
      percentageOfSpend: 62.8,
      skuTier: "Standard",
    },
    {
      deploymentName: "gpt-4o-prod",
      modelName: "gpt-4o",
      modelVersion: "2024-08-06",
      inputTokens: 98000,
      outputTokens: 2100,
      cachedTokens: 12000,
      costPer1kTokensUSD: "0.0100",
      totalCostUSD: "0.62",
      percentageOfSpend: 28.8,
      skuTier: "Standard",
    },
    {
      deploymentName: "text-embedding-3-large",
      modelName: "text-embedding-3-large",
      modelVersion: "1",
      inputTokens: 22140,
      outputTokens: 0,
      cachedTokens: 4268,
      costPer1kTokensUSD: "0.00013",
      totalCostUSD: "0.12",
      percentageOfSpend: 5.6,
      skuTier: "Standard",
    },
    {
      deploymentName: "gpt-35-turbo-legacy",
      modelName: "gpt-35-turbo",
      modelVersion: "0301",
      inputTokens: 0,
      outputTokens: 490,
      cachedTokens: 0,
      costPer1kTokensUSD: "0.0015",
      totalCostUSD: "0.06",
      percentageOfSpend: 2.8,
      skuTier: "Standard",
    },
  ];

  const applicationConsumers: FoundryApplicationConsumer[] = [
    {
      appId: "app-customer-support",
      appDisplayName: "mchavez-8282-resource",
      modelUsed: "gpt-4o-mini",
      totalCostUSD: "0.85",
      percentageOfSpend: 39.5,
      requestsCount: 980,
      hasCostCenter: true,
      costCenter: "CustomerSuccess",
    },
    {
      appId: "app-rag-core",
      appDisplayName: "Servicio-RAG-Core",
      modelUsed: "gpt-4o-mini",
      totalCostUSD: "0.50",
      percentageOfSpend: 23.3,
      requestsCount: 650,
      hasCostCenter: true,
      costCenter: "Engineering",
    },
    {
      appId: "app-sales-copilot",
      appDisplayName: "sales-copilot-prod",
      modelUsed: "gpt-4o",
      totalCostUSD: "0.35",
      percentageOfSpend: 16.3,
      requestsCount: 320,
      hasCostCenter: true,
      costCenter: "Sales",
    },
    {
      appId: "app-embeddings",
      appDisplayName: "embeddings-pipeline",
      modelUsed: "text-embedding-3-large",
      totalCostUSD: "0.12",
      percentageOfSpend: 5.6,
      requestsCount: 180,
      hasCostCenter: false,
    },
    {
      appId: "app-qa-eval",
      appDisplayName: "qa-evaluation-runner",
      modelUsed: "gpt-4o",
      totalCostUSD: "0.27",
      percentageOfSpend: 12.6,
      requestsCount: 210,
      hasCostCenter: false,
    },
    {
      appId: "app-code-helper",
      appDisplayName: "code-helper-internal",
      modelUsed: "gpt-35-turbo",
      totalCostUSD: "0.06",
      percentageOfSpend: 2.8,
      requestsCount: 100,
      hasCostCenter: true,
      costCenter: "Engineering",
    },
  ];

  // Generate time series
  const timeSeries: FoundryTimeSeriesPoint[] = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - actualDays + 1);
  let cumulative = 0;
  for (let i = 0; i < actualDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().substring(0, 10);
    const dailyCost = 0.05 + Math.random() * 0.15;
    cumulative += dailyCost;
    const inputT = Math.round(15000 + Math.random() * 10000);
    const outputT = Math.round(200 + Math.random() * 300);
    timeSeries.push({
      date: dateStr,
      costUSD: Math.round(dailyCost * 100) / 100,
      cumulativeCostUSD: Math.round(cumulative * 100) / 100,
      inputTokens: inputT,
      outputTokens: outputT,
      totalTokens: inputT + outputT,
      cachedTokens: Math.round(inputT * 0.12),
    });
  }

  const remediationActions: FoundryRemediationAction[] = [
    {
      id: "rem-ptu-arbitrage",
      title: "Evaluar Provisioned Throughput (PTU) para gpt-4o-mini",
      description:
        "El consumo sostenido de gpt-4o-mini supera el umbral de $1,500/mes. PTU ofrece 50-70% de descuento sobre PAYG con capacidad reservada.",
      category: "PTU_ARBITRAGE",
      estimatedSavingsUSD: "0.85",
      confidence: "HIGH",
      actionType: "ptu_simulate",
    },
    {
      id: "rem-prompt-caching",
      title: "Activar Prompt Caching en llamadas repetitivas",
      description:
        "El 12.5% de cache hit rate indica oportunidad de optimización. Incrementar caching al 30%+ ahorraría ~$0.15/mes.",
      category: "PROMPT_CACHING",
      estimatedSavingsUSD: "0.15",
      confidence: "MEDIUM",
      actionType: "enable_caching",
    },
    {
      id: "rem-idle-deployment",
      title: "Eliminar despliegue inactivo gpt-35-turbo-legacy",
      description:
        "El deployment gpt-35-turbo-legacy tiene 0 tokens de entrada en el período. Considerar eliminar o migrar a gpt-4o-mini.",
      category: "IDLE_DEPLOYMENT",
      estimatedSavingsUSD: "0.06",
      confidence: "HIGH",
      actionType: "delete_deployment",
    },
    {
      id: "rem-tag-showback",
      title: "Etiquetar consumidores sin CostCenter",
      description:
        "2 aplicaciones (embeddings-pipeline, qa-evaluation-runner) no tienen tag CostCenter. Sin atribución, el 18.2% del gasto no se puede showback.",
      category: "TAG_SHOWBACK",
      estimatedSavingsUSD: "0.00",
      confidence: "HIGH",
      actionType: "apply_tags",
    },
  ];

  return {
    metrics,
    modelUsage,
    applicationConsumers,
    timeSeries,
    remediationActions,
    mock: true,
  };
}

function normalizeFoundryModelKey(value: string): string {
  const s = String(value || "").toLowerCase().trim();
  if (!s) return "";

  const cleaned = s
    .replace(/^(azure[- ]openai|cognitive[- ]services|azure[- ]ai[- ]services|azure[- ]ai|foundry)\s*[-:]\s*/i, "")
    .replace(/\s+(inp|out|opt|op|tokens?|1m|1k|gl|ad|std|cd)\b/gi, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  let m = cleaned.match(/^(?:gpt-)?(\d+(?:\.\d+)?(?:[a-z0-9]+)?(?:-[a-z0-9]+)?)/i);
  if (m) {
    return `gpt-${m[1].toLowerCase()}`;
  }

  m = cleaned.match(/^([a-z]+-(?:[a-z]+-)*\d+(?:-[a-z0-9]+)?)/i);
  if (m) {
    return m[1].toLowerCase();
  }

  m = cleaned.match(/^([a-z0-9]+)-(\d+(?:\.\d+)?(?:[a-z0-9]+)?)/i);
  if (m) {
    return `${m[1]}-${m[2]}`.toLowerCase();
  }

  return cleaned.toLowerCase();
}

function reconcileFoundryRows(
  aiRows: Array<Record<string, unknown>>,
  meterRows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!aiRows.length && !meterRows.length) return [];
  if (!meterRows.length) return aiRows;

  const toDateStr = (raw: unknown): string => {
    if (!raw) return "";
    if (raw instanceof Date) return raw.toISOString().substring(0, 10);
    return String(raw).substring(0, 10);
  };

  const meterByDateModel = new Map<string, Decimal>();
  const meterMetaByKey = new Map<string, { application: string; team: string; modelName: string }>();

  for (const row of meterRows) {
    const dateKey = toDateStr(row.snapshot_date);
    const modelKey = normalizeFoundryModelKey(String(row.model_name || ""));
    const cost = new Decimal(String(row.cost_usd || 0));
    if (modelKey && cost.gt(0)) {
      const key = `${dateKey}::${modelKey}`;
      meterByDateModel.set(key, (meterByDateModel.get(key) || new Decimal(0)).plus(cost));
      if (!meterMetaByKey.has(key)) {
        meterMetaByKey.set(key, {
          application: String(row.application || "unknown-subscription"),
          team: String(row.team || "Sin asignar"),
          modelName: modelKey,
        });
      }
    }
  }

  const rows: Array<Record<string, unknown>> = aiRows.map((r) => ({ ...r, cost_usd: new Decimal(0) }));
  const rowsByDate = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const dateKey = toDateStr(rows[i].snapshot_date);
    const arr = rowsByDate.get(dateKey) || [];
    arr.push(i);
    rowsByDate.set(dateKey, arr);
  }

  const matchedMeterKeys = new Set<string>();

  for (const [dateKey, idxs] of rowsByDate.entries()) {
    const modelBuckets = new Map<string, number[]>();
    for (const idx of idxs) {
      const key = normalizeFoundryModelKey(String(aiRows[idx].model_name || ""));
      const arr = modelBuckets.get(key) || [];
      arr.push(idx);
      modelBuckets.set(key, arr);
    }

    for (const [modelKey, modelIdxs] of modelBuckets.entries()) {
      const meterKey = `${dateKey}::${modelKey}`;
      const modelMeter = meterByDateModel.get(meterKey);
      if (!modelMeter || modelMeter.lte(0)) continue;

      const totalTokens = modelIdxs.reduce(
        (sum, idx) => sum + Number(aiRows[idx].input_tokens || 0) + Number(aiRows[idx].output_tokens || 0),
        0
      );
      const count = modelIdxs.length || 1;
      for (const idx of modelIdxs) {
        const rowTokens = Number(aiRows[idx].input_tokens || 0) + Number(aiRows[idx].output_tokens || 0);
        const share = totalTokens > 0 ? new Decimal(rowTokens).dividedBy(totalTokens) : new Decimal(1).dividedBy(count);
        rows[idx].cost_usd = modelMeter.times(share).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
      }
      matchedMeterKeys.add(meterKey);
    }
  }

  const syntheticRows: Array<Record<string, unknown>> = [];
  for (const [meterKey, cost] of meterByDateModel.entries()) {
    if (matchedMeterKeys.has(meterKey) || cost.lte(0)) continue;
    const sepIdx = meterKey.indexOf("::");
    const dateKey = meterKey.substring(0, sepIdx);
    const meta = meterMetaByKey.get(meterKey);
    const rawModelName = meta?.modelName || meterKey.substring(sepIdx + 2);
    const price = MODEL_PRICE_PER_1K[rawModelName] || { input: 0.005, output: 0.015 };
    const effectivePricePer1k = price.input * 0.75 + price.output * 0.25;
    const derivedTokens = Math.max(10, Math.round((cost.toNumber() / effectivePricePer1k) * 1000));
    const inputTokens = Math.round(derivedTokens * 0.75);
    const outputTokens = Math.round(derivedTokens * 0.25);
    const requestCount = Math.max(1, Math.round(derivedTokens / 1500));

    syntheticRows.push({
      model_name: rawModelName,
      deployment_name: rawModelName,
      application: meta?.application || "unknown-subscription",
      team: meta?.team || "Sin asignar",
      snapshot_date: dateKey,
      cost_usd: cost,
      request_count: requestCount,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: 0,
      sku_tier: "Standard",
    });
  }

  return [...rows, ...syntheticRows];
}

// ── Real Data Aggregator ────────────────────────────────────────────────────

async function fetchRealPayload(
  tenantId: string,
  days: number | "mtd"
): Promise<FoundryDetailPayload> {
  const now = new Date().toISOString();
  const actualDays = days === "mtd" ? new Date().getDate() : Number(days);

  // 1. Query AICostSnapshots for the time window
  const dateFilter =
    days === "mtd"
      ? `date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
      : `date >= DATE_SUB(CURDATE(), INTERVAL ${actualDays} DAY)`;

  const queryRows = async () => {
    const [result] = await pool.query(
      `SELECT
         COALESCE(NULLIF(model_name, ''), 'unknown') AS model_name,
         COALESCE(NULLIF(resource_name, ''), 'unknown') AS application,
         'Sin asignar' AS team,
         date AS snapshot_date,
         COALESCE(NULLIF(billed_cost, 0), effective_cost, 0) AS cost_usd,
         COALESCE(request_count, 0) AS request_count,
         COALESCE(input_tokens, 0) AS input_tokens,
         COALESCE(output_tokens, 0) AS output_tokens,
         0 AS cached_tokens,
         COALESCE(NULLIF(model_name, ''), 'unknown') AS deployment_name,
         'Standard' AS sku_tier
       FROM AICostSnapshots
       WHERE tenant_id = ? AND ${dateFilter}
       ORDER BY date DESC`,
      [tenantId]
    );
    return result as Array<Record<string, unknown>>;
  };

  let rows = await queryRows();

  if (!rows || rows.length === 0) {
    try {
      const liveUsage = await getHistoricalAIUsage(tenantId, Math.max(actualDays, 30));
      for (const usage of liveUsage) {
        await insertAICostSnapshotRow(tenantId, usage.date, usage);
      }
      if (liveUsage.length > 0) rows = await queryRows();
    } catch (error) {
      console.warn("[azureAiFoundry] live Azure Monitor sync unavailable:", error);
    }
  }

  if (!rows || rows.length === 0) {
    return fetchFoundrySnapshotPayload(tenantId, actualDays);
  }

  // 1.5. Query CostMeterSnapshots / CostSnapshots to reconcile with real billed costs
  let meterRows: Array<Record<string, unknown>> = [];
  try {
    const rawResult: any = await pool.query(
      `SELECT
         COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name) AS model_name,
         COALESCE(NULLIF(subscription_id, ''), 'unknown-subscription') AS application,
         'Sin asignar' AS team,
         date AS snapshot_date,
         SUM(cost_usd) AS cost_usd,
         0 AS request_count,
         0 AS input_tokens,
         0 AS output_tokens,
         0 AS cached_tokens,
         COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name) AS deployment_name,
         'Standard' AS sku_tier
       FROM CostMeterSnapshots
       WHERE tenant_id = ? AND ${dateFilter}
         AND (
              LOWER(service_name) LIKE '%openai%'
              OR LOWER(MeterCategory) LIKE '%openai%'
              OR LOWER(MeterName) LIKE '%openai%'
              OR LOWER(MeterSubCategory) LIKE '%openai%'
              OR LOWER(service_name) LIKE '%foundry%'
              OR LOWER(MeterCategory) LIKE '%foundry%'
              OR LOWER(MeterName) LIKE '%foundry%'
              OR LOWER(MeterSubCategory) LIKE '%foundry%'
              OR LOWER(service_name) LIKE '%cognitive%'
              OR LOWER(MeterCategory) LIKE '%cognitive%'
              OR LOWER(MeterName) LIKE '%cognitive%'
              OR LOWER(MeterSubCategory) LIKE '%cognitive%'
              OR LOWER(service_name) LIKE '%azure ai%'
              OR LOWER(MeterCategory) LIKE '%azure ai%'
              OR LOWER(MeterName) LIKE '%azure ai%'
              OR LOWER(MeterSubCategory) LIKE '%azure ai%'
         )
       GROUP BY COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name), 
                COALESCE(NULLIF(subscription_id, ''), 'unknown-subscription'),
                snapshot_date
       ORDER BY snapshot_date ASC`,
      [tenantId]
    );
    const mResult = Array.isArray(rawResult) ? rawResult[0] : rawResult;
    meterRows = Array.isArray(mResult) ? mResult : [];
  } catch (mErr) {
    console.warn("[azureAiFoundry] CostMeterSnapshots lookup skipped:", mErr);
  }

  if (meterRows.length === 0) {
    try {
      const rawCResult: any = await pool.query(
        `SELECT
           COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name) AS model_name,
           resource_group AS application,
           'Sin asignar' AS team,
           date AS snapshot_date,
           SUM(cost_usd) AS cost_usd,
           0 AS request_count,
           0 AS input_tokens,
           0 AS output_tokens,
           0 AS cached_tokens,
           COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name) AS deployment_name,
           'Standard' AS sku_tier
         FROM CostSnapshots
         WHERE tenant_id = ? AND ${dateFilter}
           AND (
                LOWER(service_name) LIKE '%openai%'
                OR LOWER(MeterCategory) LIKE '%openai%'
                OR LOWER(MeterName) LIKE '%openai%'
                OR LOWER(MeterSubCategory) LIKE '%openai%'
                OR LOWER(service_name) LIKE '%foundry%'
                OR LOWER(MeterCategory) LIKE '%foundry%'
                OR LOWER(MeterName) LIKE '%foundry%'
                OR LOWER(MeterSubCategory) LIKE '%foundry%'
                OR LOWER(service_name) LIKE '%cognitive%'
                OR LOWER(MeterCategory) LIKE '%cognitive%'
                OR LOWER(MeterName) LIKE '%cognitive%'
                OR LOWER(MeterSubCategory) LIKE '%cognitive%'
                OR LOWER(service_name) LIKE '%azure ai%'
                OR LOWER(MeterCategory) LIKE '%azure ai%'
                OR LOWER(MeterName) LIKE '%azure ai%'
                OR LOWER(MeterSubCategory) LIKE '%azure ai%'
           )
         GROUP BY COALESCE(NULLIF(MeterSubCategory, ''), NULLIF(MeterName, ''), service_name), resource_group, snapshot_date
         ORDER BY snapshot_date ASC`,
        [tenantId]
      );
      const cResult = Array.isArray(rawCResult) ? rawCResult[0] : rawCResult;
      meterRows = Array.isArray(cResult) ? cResult : [];
    } catch (cErr) {
      console.warn("[azureAiFoundry] CostSnapshots fallback lookup skipped:", cErr);
    }
  }

  // Reconcile rows with meters if meter data exists
  let effectiveRows = rows;
  if (meterRows.length > 0) {
    effectiveRows = reconcileFoundryRows(rows, meterRows);
  }

  if (!effectiveRows || effectiveRows.length === 0) {
    return fetchFoundrySnapshotPayload(tenantId, actualDays);
  }

  // 2. Aggregate metrics
  let totalRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalCost = new Decimal(0);

  const modelMap = new Map<string, {
    deploymentName: string;
    modelName: string;
    modelVersion: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cost: Decimal;
    requests: number;
    skuTier: string;
  }>();

  const appMap = new Map<string, {
    appId: string;
    appDisplayName: string;
    modelUsed: string;
    cost: Decimal;
    requests: number;
    hasCostCenter: boolean;
    costCenter?: string;
  }>();

  const dateMap = new Map<string, {
    cost: Decimal;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  }>();

  for (const row of effectiveRows) {
    const cost = new Decimal(String(row.cost_usd || 0));
    let inputT = Number(row.input_tokens || 0);
    let outputT = Number(row.output_tokens || 0);
    const cachedT = Number(row.cached_tokens || 0);
    let reqCount = Number(row.request_count || 0);
    const modelName = String(row.model_name || "unknown");
    const deploymentName = String(row.deployment_name || modelName);
    const appName = String(row.application || "unknown");
    const team = String(row.team || "");
    const dateKey = String(row.snapshot_date || "").substring(0, 10);
    const skuTier = String(row.sku_tier || "Standard");

    if (inputT === 0 && outputT === 0 && cost.gt(0)) {
      const price = MODEL_PRICE_PER_1K[modelName] || { input: 0.005, output: 0.015 };
      const effectivePricePer1k = price.input * 0.75 + price.output * 0.25;
      const derivedTokens = Math.max(10, Math.round((cost.toNumber() / effectivePricePer1k) * 1000));
      inputT = Math.round(derivedTokens * 0.75);
      outputT = Math.round(derivedTokens * 0.25);
      reqCount = Math.max(1, Math.round(derivedTokens / 1500));
    }

    totalRequests += reqCount;
    totalInputTokens += inputT;
    totalOutputTokens += outputT;
    totalCachedTokens += cachedT;
    totalCost = totalCost.plus(cost);

    // Per-model aggregation
    const modelKey = deploymentName;
    const existingModel = modelMap.get(modelKey) || {
      deploymentName,
      modelName,
      modelVersion: "",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: new Decimal(0),
      requests: 0,
      skuTier,
    };
    existingModel.inputTokens += inputT;
    existingModel.outputTokens += outputT;
    existingModel.cachedTokens += cachedT;
    existingModel.cost = existingModel.cost.plus(cost);
    existingModel.requests += reqCount;
    modelMap.set(modelKey, existingModel);

    // Per-app aggregation
    const appKey = appName;
    const existingApp = appMap.get(appKey) || {
      appId: appKey,
      appDisplayName: resolveFriendlyName(appName),
      modelUsed: modelName,
      cost: new Decimal(0),
      requests: 0,
      hasCostCenter: team.length > 0 && team !== "Sin asignar",
      costCenter: team.length > 0 && team !== "Sin asignar" ? team : undefined,
    };
    existingApp.cost = existingApp.cost.plus(cost);
    existingApp.requests += reqCount;
    // Keep the highest-cost model as primary
    if (cost.gt(new Decimal(0))) {
      existingApp.modelUsed = modelName;
    }
    appMap.set(appKey, existingApp);

    // Per-date aggregation
    const existingDate = dateMap.get(dateKey) || {
      cost: new Decimal(0),
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    };
    existingDate.cost = existingDate.cost.plus(cost);
    existingDate.inputTokens += inputT;
    existingDate.outputTokens += outputT;
    existingDate.cachedTokens += cachedT;
    dateMap.set(dateKey, existingDate);
  }

  // 2.5. Merge live Azure deployments directly from Azure ARM / Resource Graph
  try {
    const liveDeployments = await getAzureFoundryDeployments(tenantId).catch(() => []);
    for (const dep of liveDeployments) {
      const matchKey = Array.from(modelMap.keys()).find(
        (k) =>
          k.toLowerCase() === dep.name.toLowerCase() ||
          k.toLowerCase() === dep.modelName.toLowerCase() ||
          normalizeFoundryModelKey(k) === normalizeFoundryModelKey(dep.modelName)
      );

      if (matchKey) {
        const item = modelMap.get(matchKey)!;
        if (!item.modelVersion && dep.modelVersion) item.modelVersion = dep.modelVersion;
        if (dep.skuName) item.skuTier = dep.skuName;
        if (!item.deploymentName || item.deploymentName === "unknown") item.deploymentName = dep.name;
      } else {
        // Active deployment in Azure with 0 requests this period
        modelMap.set(dep.name, {
          deploymentName: dep.name,
          modelName: dep.modelName,
          modelVersion: dep.modelVersion || "latest",
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          cost: new Decimal(0),
          requests: 0,
          skuTier: dep.skuName || "Standard",
        });
      }
    }
  } catch (liveDepErr) {
    console.warn("[azureAiFoundry] live Azure deployments lookup warning:", liveDepErr);
  }

  // 3. Build model usage items
  const totalTokens = totalInputTokens + totalOutputTokens;
  const modelUsage: FoundryModelUsageItem[] = Array.from(modelMap.values())
    .map((m) => {
      const modelTokens = m.inputTokens + m.outputTokens;
      const priceInfo = MODEL_PRICE_PER_1K[m.modelName] || { input: 0.001, output: 0.004 };
      const estimatedCostPer1k =
        modelTokens > 0
          ? m.cost.div(modelTokens).times(1000).toFixed(6)
          : priceInfo.output.toFixed(6);

      return {
        deploymentName: m.deploymentName,
        modelName: m.modelName,
        modelVersion: m.modelVersion || "—",
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cachedTokens: m.cachedTokens,
        costPer1kTokensUSD: estimatedCostPer1k,
        totalCostUSD: m.cost.toFixed(2),
        percentageOfSpend: totalCost.gt(0) ? m.cost.div(totalCost).times(100).toNumber() : 0,
        skuTier: m.skuTier,
      };
    })
    .sort((a, b) => parseFloat(b.totalCostUSD) - parseFloat(a.totalCostUSD));

  // 4. Build application consumers
  const applicationConsumers: FoundryApplicationConsumer[] = Array.from(appMap.values())
    .map((a) => ({
      appId: a.appId,
      appDisplayName: a.appDisplayName,
      modelUsed: a.modelUsed,
      totalCostUSD: a.cost.toFixed(2),
      percentageOfSpend: totalCost.gt(0) ? a.cost.div(totalCost).times(100).toNumber() : 0,
      requestsCount: a.requests,
      hasCostCenter: a.hasCostCenter,
      costCenter: a.costCenter,
    }))
    .sort((a, b) => parseFloat(b.totalCostUSD) - parseFloat(a.totalCostUSD));

  // 5. Build time series
  const timeSeries: FoundryTimeSeriesPoint[] = [];
  const sortedDates = Array.from(dateMap.keys()).sort();
  let cumulative = new Decimal(0);
  for (const dateKey of sortedDates) {
    const d = dateMap.get(dateKey)!;
    cumulative = cumulative.plus(d.cost);
    timeSeries.push({
      date: dateKey,
      costUSD: d.cost.toNumber(),
      cumulativeCostUSD: cumulative.toNumber(),
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      totalTokens: d.inputTokens + d.outputTokens,
      cachedTokens: d.cachedTokens,
    });
  }

  // 6. Compute metrics
  const promptCacheHitRate =
    totalInputTokens > 0 ? (totalCachedTokens / totalInputTokens) * 100 : 0;

  const avgCostPer1kOutput =
    totalOutputTokens > 0
      ? totalCost.div(totalOutputTokens).times(1000).toFixed(3)
      : "0.000";

  // Forecast EOM
  const nowDate = new Date();
  const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const daysElapsed = Math.max(1, nowDate.getDate());
  const forecast = totalCost.times(daysInMonth).div(daysElapsed);

  // Detect billing model
  const hasPtu = modelUsage.some((m) => m.skuTier === "ProvisionedManaged");
  const billingModel: FoundrySummaryMetrics["billingModel"] = hasPtu ? "HYBRID" : "PAYG";

  const metrics: FoundrySummaryMetrics = {
    totalRequests,
    avgRequestsPerDay: Math.round(totalRequests / Math.max(1, actualDays)),
    totalTokens,
    avgTokensPerRequest: totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0,
    estimatedCostUSD: totalCost.toFixed(2),
    forecastCostUSD: forecast.toFixed(2),
    inputTokens: totalInputTokens,
    promptCacheHitRate: Math.round(promptCacheHitRate * 10) / 10,
    outputTokens: totalOutputTokens,
    avgCostPer1kOutputTokensUSD: avgCostPer1kOutput,
    cachedTokens: totalCachedTokens,
    activeDeployments: modelUsage.length,
    activeApplications: applicationConsumers.length,
    billingModel,
    computedAt: now,
    source: "snapshot",
  };

  // 7. Generate remediation actions
  const remediationActions = generateRemediations(metrics, modelUsage, applicationConsumers);

  return {
    metrics,
    modelUsage,
    applicationConsumers,
    timeSeries,
    remediationActions,
    mock: false,
  };
}

async function fetchFoundrySnapshotPayload(
  tenantId: string,
  actualDays: number
): Promise<FoundryDetailPayload> {
  const [rows] = await pool.query(
    `SELECT
       snapshotDate,
       resourceId,
       resourceName,
       deploymentName,
       modelDeploymentName,
       modelName,
       sku,
       COALESCE(monthlyCostUSD, 0) AS monthlyCostUSD,
       COALESCE(usage_promptTokens, 0) AS inputTokens,
       COALESCE(usage_completionTokens, 0) AS outputTokens,
       COALESCE(usage_modelEndpoints, 0) AS modelEndpoints
     FROM AzureFoundrySnapshots
     WHERE tenantId = ?
       AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY snapshotDate ASC`,
    [tenantId, actualDays]
  ) as [Array<Record<string, unknown>>, unknown];

  if (!rows || rows.length === 0) {
    return createZeroStatePayload();
  }

  const latestRows = selectLatestAzureAiSnapshots(rows);

  let totalCost = new Decimal(0);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const deployments = new Map<string, FoundryModelUsageItem>();
  const resources = new Map<string, FoundryApplicationConsumer>();
  const dates = new Map<string, FoundryTimeSeriesPoint>();

  for (const row of latestRows) {
    const cost = new Decimal(String(row.monthlyCostUSD || 0));
    const inputTokens = Number(row.inputTokens || 0);
    const outputTokens = Number(row.outputTokens || 0);
    const deploymentName = String(row.deploymentName || row.modelDeploymentName || "unknown");
    const modelName = String(row.modelName || deploymentName);
    const resourceId = String(row.resourceId || row.resourceName || "unknown");
    const resourceName = String(row.resourceName || resourceId);
    const date = new Date(String(row.snapshotDate)).toISOString().substring(0, 10);

    totalCost = totalCost.plus(cost);
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    const currentDeployment = deployments.get(deploymentName);
    if (currentDeployment) {
      currentDeployment.inputTokens += inputTokens;
      currentDeployment.outputTokens += outputTokens;
      currentDeployment.totalCostUSD = new Decimal(currentDeployment.totalCostUSD)
        .plus(cost)
        .toFixed(2);
    } else {
      deployments.set(deploymentName, {
        deploymentName,
        modelName,
        modelVersion: "—",
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        costPer1kTokensUSD: "0.000000",
        totalCostUSD: cost.toFixed(2),
        percentageOfSpend: 0,
        skuTier: String(row.sku || "Standard"),
      });
    }

    const currentResource = resources.get(resourceId);
    if (currentResource) {
      currentResource.totalCostUSD = new Decimal(currentResource.totalCostUSD)
        .plus(cost)
        .toFixed(2);
      currentResource.requestsCount += Number(row.modelEndpoints || 0);
    } else {
      resources.set(resourceId, {
        appId: resourceId,
        appDisplayName: resourceName,
        modelUsed: modelName,
        totalCostUSD: cost.toFixed(2),
        percentageOfSpend: 0,
        requestsCount: Number(row.modelEndpoints || 0),
        hasCostCenter: false,
      });
    }

    const currentDate = dates.get(date) || {
      date,
      costUSD: 0,
      cumulativeCostUSD: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    };
    currentDate.costUSD = new Decimal(currentDate.costUSD).plus(cost).toNumber();
    currentDate.inputTokens += inputTokens;
    currentDate.outputTokens += outputTokens;
    currentDate.totalTokens += inputTokens + outputTokens;
    dates.set(date, currentDate);
  }

  const modelUsage = Array.from(deployments.values()).map((item) => {
    const modelTokens = item.inputTokens + item.outputTokens;
    const modelCost = new Decimal(item.totalCostUSD);
    return {
      ...item,
      costPer1kTokensUSD: modelTokens > 0
        ? modelCost.div(modelTokens).times(1000).toFixed(6)
        : "0.000000",
      percentageOfSpend: totalCost.gt(0)
        ? modelCost.div(totalCost).times(100).toNumber()
        : 0,
    };
  });

  const applicationConsumers = Array.from(resources.values()).map((item) => ({
    ...item,
    percentageOfSpend: totalCost.gt(0)
      ? new Decimal(item.totalCostUSD).div(totalCost).times(100).toNumber()
      : 0,
  }));

  let cumulativeCost = new Decimal(0);
  const timeSeries = Array.from(dates.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => {
      cumulativeCost = cumulativeCost.plus(point.costUSD);
      return { ...point, cumulativeCostUSD: cumulativeCost.toNumber() };
    });

  const totalTokens = totalInputTokens + totalOutputTokens;
  const metrics: FoundrySummaryMetrics = {
    totalRequests: 0,
    avgRequestsPerDay: 0,
    totalTokens,
    avgTokensPerRequest: 0,
    estimatedCostUSD: totalCost.toFixed(2),
    forecastCostUSD: totalCost.toFixed(2),
    inputTokens: totalInputTokens,
    promptCacheHitRate: 0,
    outputTokens: totalOutputTokens,
    avgCostPer1kOutputTokensUSD: totalOutputTokens > 0
      ? totalCost.div(totalOutputTokens).times(1000).toFixed(6)
      : "0.000000",
    cachedTokens: 0,
    activeDeployments: modelUsage.length,
    activeApplications: applicationConsumers.length,
    billingModel: "UNKNOWN",
    computedAt: new Date().toISOString(),
    source: "snapshot",
  };

  return {
    metrics,
    modelUsage,
    applicationConsumers,
    timeSeries,
    remediationActions: generateRemediations(metrics, modelUsage, applicationConsumers),
    mock: false,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveFriendlyName(raw: string): string {
  // If it looks like a GUID or resource ID, extract a friendly part
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) {
    return "Resource-" + raw.substring(0, 8);
  }
  // If it's an Azure resource ID
  if (raw.includes("/subscriptions/")) {
    const parts = raw.split("/");
    const name = parts[parts.length - 1] || parts[parts.length - 2] || raw;
    return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).substring(0, 40);
  }
  // If it's "unknown" or "unknown-subscription"
  if (raw === "unknown" || raw === "unknown-subscription") {
    return "Sin atribuir (Unknown)";
  }
  return raw;
}

function generateRemediations(
  metrics: FoundrySummaryMetrics,
  modelUsage: FoundryModelUsageItem[],
  appConsumers: FoundryApplicationConsumer[]
): FoundryRemediationAction[] {
  const actions: FoundryRemediationAction[] = [];

  // PTU arbitrage: if total cost > $1500/month sustained
  const monthlyCost = parseFloat(metrics.estimatedCostUSD);
  if (monthlyCost > 1500 && metrics.billingModel === "PAYG") {
    const ptuSavings = new Decimal(monthlyCost).times(0.4);
    actions.push({
      id: "rem-ptu-arbitrage",
      title: "Evaluar Provisioned Throughput (PTU)",
      description:
        `El consumo mensual de $${monthlyCost.toFixed(2)} supera el umbral de $1,500. ` +
        "PTU ofrece 40-70% de descuento sobre PAYG con capacidad reservada.",
      category: "PTU_ARBITRAGE",
      estimatedSavingsUSD: ptuSavings.toFixed(2),
      confidence: "HIGH",
      actionType: "ptu_simulate",
    });
  }

  // Prompt caching: if cache hit rate < 20% and there's meaningful input
  if (metrics.promptCacheHitRate < 20 && metrics.inputTokens > 100000) {
    const cachingSavings = new Decimal(metrics.estimatedCostUSD).times(0.08);
    actions.push({
      id: "rem-prompt-caching",
      title: "Activar Prompt Caching en llamadas repetitivas",
      description:
        `Cache hit rate actual: ${metrics.promptCacheHitRate}%. ` +
        "Incrementar a 30%+ ahorraría ~8% del costo de entrada.",
      category: "PROMPT_CACHING",
      estimatedSavingsUSD: cachingSavings.toFixed(2),
      confidence: "MEDIUM",
      actionType: "enable_caching",
    });
  }

  // Idle deployments: models with 0 input tokens
  for (const m of modelUsage) {
    if (m.inputTokens === 0 && m.outputTokens === 0 && parseFloat(m.totalCostUSD) > 0) {
      actions.push({
        id: `rem-idle-${m.deploymentName}`,
        title: `Eliminar despliegue inactivo: ${m.deploymentName}`,
        description:
          `El deployment ${m.deploymentName} (${m.modelName}) no tiene actividad en el período. ` +
          "Considerar eliminar para liberar capacidad.",
        category: "IDLE_DEPLOYMENT",
        estimatedSavingsUSD: m.totalCostUSD,
        confidence: "HIGH",
        actionType: "delete_deployment",
      });
    }
  }

  // Model downgrade: gpt-4 → gpt-4o-mini
  const gpt4Model = modelUsage.find(
    (m) => m.modelName === "gpt-4" || m.modelName === "gpt-4-turbo"
  );
  if (gpt4Model && parseFloat(gpt4Model.totalCostUSD) > 0.5) {
    const downgradeSavings = new Decimal(gpt4Model.totalCostUSD).times(0.85);
    actions.push({
      id: "rem-model-downgrade",
      title: `Migrar ${gpt4Model.modelName} → gpt-4o-mini`,
      description:
        `${gpt4Model.modelName} es ~15x más caro que gpt-4o-mini. ` +
        "Para cargas no críticas, migrar reduce el costo en ~85%.",
      category: "MODEL_DOWNGRADE",
      estimatedSavingsUSD: downgradeSavings.toFixed(2),
      confidence: "HIGH",
      actionType: "model_downgrade",
    });
  }

  // Tag showback: apps without CostCenter
  const untaggedApps = appConsumers.filter((a) => !a.hasCostCenter);
  if (untaggedApps.length > 0) {
    const untaggedCost = untaggedApps.reduce(
      (sum, a) => sum + parseFloat(a.totalCostUSD),
      0
    );
    actions.push({
      id: "rem-tag-showback",
      title: `Etiquetar ${untaggedApps.length} consumidores sin CostCenter`,
      description:
        `${untaggedApps.map((a) => a.appDisplayName).join(", ")} no tienen tag CostCenter. ` +
        `$${untaggedCost.toFixed(2)} sin atribuir para showback.`,
      category: "TAG_SHOWBACK",
      estimatedSavingsUSD: "0.00",
      confidence: "HIGH",
      actionType: "apply_tags",
    });
  }

  return actions.sort(
    (a, b) => parseFloat(b.estimatedSavingsUSD) - parseFloat(a.estimatedSavingsUSD)
  );
}

function createZeroStatePayload(): FoundryDetailPayload {
  const now = new Date().toISOString();
  return {
    metrics: {
      totalRequests: 0,
      avgRequestsPerDay: 0,
      totalTokens: 0,
      avgTokensPerRequest: 0,
      estimatedCostUSD: "0.00",
      forecastCostUSD: "0.00",
      inputTokens: 0,
      promptCacheHitRate: 0,
      outputTokens: 0,
      avgCostPer1kOutputTokensUSD: "0.000",
      cachedTokens: 0,
      activeDeployments: 0,
      activeApplications: 0,
      billingModel: "UNKNOWN",
      computedAt: now,
      source: "live",
    },
    modelUsage: [],
    applicationConsumers: [],
    timeSeries: [],
    remediationActions: [],
    mock: false,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getFoundryDetail(
  tenantId: string,
  days: number | "mtd" = 30,
  forceMock = false
): Promise<FoundryDetailPayload> {
  if (forceMock || isMockTenant(tenantId)) {
    return generateMockPayload(days);
  }

  try {
    return await fetchRealPayload(tenantId, days);
  } catch (err) {
    console.error("[azureAiFoundry] Real fetch failed:", err);
    return createZeroStatePayload();
  }
}