/**
 * Azure AI Summary Service
 *
 * Consolidated backend for the "Resumen" tab of the Azure AI module.
 *
 * **Data flow for real tenants:**
 *   1. Check Redis cache (same cache layer as /api/intelligence/azure-ai)
 *   2. On cache miss: run the SAME per-capability collectors that the original
 *      endpoint uses — syncAzureSearchSnapshots, syncFoundrySnapshots, etc.
 *      These collectors query Azure Resource Graph + Cost Management API for
 *      REAL cost data, then persist to SQL snapshots.
 *   3. Aggregate snapshot data into the summary payload.
 *   4. Cache the result in Redis for 2 hours.
 *
 * **Mock tenants:** serve synthetic demo data immediately.
 *
 * Regla Cero: All monetary values use decimal strings — no floats.
 * Zero tolerance for mock fallbacks on real tenants.
 */

import { Decimal } from "decimal.js";
import { isMockTenant } from "@/lib/mockData";
import { getCachedCapabilities, cacheCapabilities } from "@/lib/aiServiceCache";
import { getAzureCredential } from "@/lib/azure";
import { selectLatestAzureAiSnapshots } from "@/lib/azureAiCost";
import { syncAzureSearchSnapshots, getAzureSearchResources, getAzureSearchRealCost } from "@/modules/collectors/azure/azureSearchCollector";
import { syncDocIntelSnapshots, getDocIntelResources, getDocIntelRealCost } from "@/modules/collectors/azure/docIntelCollector";
import {
  syncSpeechLanguageSnapshots,
  getSpeechLanguageResources,
  syncVisionVideoSnapshots,
  getVisionVideoResources,
  syncContentSafetySnapshots,
  getContentSafetyResources,
  syncAMLSnapshots,
  getAMLResources,
  syncDatabricksSnapshots,
  getDatabricksResources,
  getAiServiceRealCost,
} from "@/modules/collectors/azure/aiServiceCollectors";
import { syncFoundrySnapshots, getFoundryResourceCost } from "@/modules/collectors/azure/foundryCollector";
import pool from "@/modules/storage/db";
import type {
  AzureAiSummaryMetrics,
  AzureAiSummaryPayload,
  AiCapabilityBreakdownItem,
  AiCapabilityKey,
  AiUnitEconomics,
  AiRiskAnomalySignal,
  AiRemediationAction,
} from "@/types/azureAiSummary.types";

// ── Constants ───────────────────────────────────────────────────────────────

const CAPABILITY_META: Record<
  AiCapabilityKey,
  { displayName: string; colorHex: string; serviceName: string }
> = {
  foundry: {
    displayName: "Azure AI Foundry / OpenAI",
    colorHex: "#0078D4",
    serviceName: "Microsoft.CognitiveServices",
  },
  search: {
    displayName: "Azure AI Search",
    colorHex: "#2563EB",
    serviceName: "Microsoft.Search/searchServices",
  },
  doc_intelligence: {
    displayName: "Document Intelligence",
    colorHex: "#93C5FD",
    serviceName: "Microsoft.CognitiveServices",
  },
  speech_language: {
    displayName: "Speech & Language",
    colorHex: "#38BDF8",
    serviceName: "Microsoft.CognitiveServices",
  },
  vision_video: {
    displayName: "Vision & Video",
    colorHex: "#60A5FA",
    serviceName: "Microsoft.CognitiveServices",
  },
  content_safety: {
    displayName: "Content Safety",
    colorHex: "#94A3B8",
    serviceName: "Microsoft.CognitiveServices",
  },
  machine_learning: {
    displayName: "Azure Machine Learning",
    colorHex: "#38BDF8",
    serviceName: "Microsoft.MachineLearningServices/workspaces",
  },
  databricks: {
    displayName: "Azure Databricks",
    colorHex: "#0284C7",
    serviceName: "Microsoft.Databricks/workspaces",
  },
};

const ALL_CAPABILITY_KEYS: AiCapabilityKey[] = [
  "foundry",
  "search",
  "doc_intelligence",
  "speech_language",
  "vision_video",
  "content_safety",
  "machine_learning",
  "databricks",
];

// ── Types for cached capability data ────────────────────────────────────────

interface CachedCapability {
  capability: string;
  name: string;
  monthlyCostUSD: number;
  wasteMetrics: {
    orphanedResourceCount: number;
    underutilizedResourceCount: number;
    idleResourceCount: number;
    estimatedWasteUSD: number;
  };
  resources: Array<{
    name: string;
    region: string;
    resourceGroup: string;
    type: string;
    monthlyCost: number;
    utilizationPercent?: number;
    lastAccessedDaysAgo?: number;
  }>;
  recommendations: Array<{
    id: string;
    title: string;
    potentialSavingsUSD: number;
    effort: string;
    roiMonths: number;
    actionType: string;
    resourceAffected: string;
    confidence: number;
  }>;
  source: "live" | "snapshot" | "mock";
}

// ── Mock Data Generator ─────────────────────────────────────────────────────

function generateMockSummaryPayload(): AzureAiSummaryPayload {
  const now = new Date().toISOString();

  const breakdown: AiCapabilityBreakdownItem[] = [
    {
      capabilityKey: "foundry",
      displayName: "Azure AI Foundry / OpenAI",
      costMtdUSD: "11240.30",
      sharePercentage: "10.3",
      wasteUSD: "820.00",
      activeResourcesCount: 2,
      colorHex: "#0078D4",
      hasAnomaly: false,
    },
    {
      capabilityKey: "search",
      displayName: "Azure AI Search",
      costMtdUSD: "12450.50",
      sharePercentage: "11.4",
      wasteUSD: "1800.00",
      activeResourcesCount: 2,
      colorHex: "#2563EB",
      hasAnomaly: true,
    },
    {
      capabilityKey: "doc_intelligence",
      displayName: "Document Intelligence",
      costMtdUSD: "8920.75",
      sharePercentage: "8.2",
      wasteUSD: "0.00",
      activeResourcesCount: 1,
      colorHex: "#93C5FD",
      hasAnomaly: false,
    },
    {
      capabilityKey: "speech_language",
      displayName: "Speech & Language",
      costMtdUSD: "7200.00",
      sharePercentage: "6.6",
      wasteUSD: "1350.00",
      activeResourcesCount: 2,
      colorHex: "#38BDF8",
      hasAnomaly: true,
    },
    {
      capabilityKey: "vision_video",
      displayName: "Vision & Video",
      costMtdUSD: "9150.25",
      sharePercentage: "8.4",
      wasteUSD: "0.00",
      activeResourcesCount: 1,
      colorHex: "#60A5FA",
      hasAnomaly: false,
    },
    {
      capabilityKey: "content_safety",
      displayName: "Content Safety",
      costMtdUSD: "3240.00",
      sharePercentage: "3.0",
      wasteUSD: "0.00",
      activeResourcesCount: 1,
      colorHex: "#94A3B8",
      hasAnomaly: false,
    },
    {
      capabilityKey: "machine_learning",
      displayName: "Azure Machine Learning",
      costMtdUSD: "15800.50",
      sharePercentage: "14.5",
      wasteUSD: "2100.00",
      activeResourcesCount: 2,
      colorHex: "#38BDF8",
      hasAnomaly: true,
    },
    {
      capabilityKey: "databricks",
      displayName: "Azure Databricks",
      costMtdUSD: "42150.75",
      sharePercentage: "38.6",
      wasteUSD: "4250.00",
      activeResourcesCount: 2,
      colorHex: "#0284C7",
      hasAnomaly: true,
    },
  ];

  const totalCost = breakdown.reduce(
    (sum, c) => sum.plus(new Decimal(c.costMtdUSD)),
    new Decimal(0)
  );
  const totalWaste = breakdown.reduce(
    (sum, c) => sum.plus(new Decimal(c.wasteUSD)),
    new Decimal(0)
  );

  const metrics: AzureAiSummaryMetrics = {
    totalCostMtdUSD: totalCost.toFixed(2),
    forecastEomUSD: totalCost.times(1.1).toFixed(2),
    estimatedWasteUSD: totalWaste.toFixed(2),
    potentialSavingsUSD: "15230.00",
    totalTokensProcessed: 60_500_000,
    avgCostPerMillionTokensUSD: "4.60",
    billingModel: "PAYG",
    momVariationPct: "+3.2",
    computedAt: now,
    source: "mock",
  };

  const unitEconomics: AiUnitEconomics = {
    promptTokens: 42_000_000,
    completionTokens: 18_500_000,
    totalTokens: 60_500_000,
    avgCostPerMillionTokensUSD: "4.60",
    billingModel: "PAYG",
    activeDeployments: 9,
    topModelName: "gpt-4o-mini",
  };

  const riskSignals: AiRiskAnomalySignal[] = [
    {
      id: "risk-ml-compute-idle",
      title: "AML Compute Instance Idle > 24h",
      description:
        "One or more Azure ML compute instances have been running continuously without notebook execution for over 24 hours.",
      severity: "HIGH",
      detectedAt: now,
      serviceOrigin: "machine_learning",
      serviceOriginName: "Azure Machine Learning",
      estimatedImpactUSD: "2100.00",
    },
    {
      id: "risk-databricks-no-autoterm",
      title: "Databricks Cluster Without Auto-Termination",
      description:
        "An interactive (All-Purpose) Databricks cluster has no auto-termination configured, accruing idle DBU costs.",
      severity: "HIGH",
      detectedAt: now,
      serviceOrigin: "databricks",
      serviceOriginName: "Azure Databricks",
      estimatedImpactUSD: "2000.00",
    },
    {
      id: "risk-search-low-queries",
      title: "AI Search Index With < 10 Daily Queries",
      description:
        "A search index on a Standard SKU is receiving fewer than 10 queries per day.",
      severity: "MEDIUM",
      detectedAt: now,
      serviceOrigin: "search",
      serviceOriginName: "Azure AI Search",
      estimatedImpactUSD: "1800.00",
    },
    {
      id: "risk-token-spike-48h",
      title: "Token Consumption Spike > 40% in 48h",
      description:
        "OpenAI token consumption increased by over 40% in the last 48 hours.",
      severity: "MEDIUM",
      detectedAt: now,
      serviceOrigin: "foundry",
      serviceOriginName: "Azure AI Foundry / OpenAI",
      estimatedImpactUSD: "820.00",
    },
  ];

  const remediationActions: AiRemediationAction[] = [
    {
      id: "rem-databricks-autoterm",
      title: "Enable Auto-Termination on Databricks Clusters",
      description:
        "Configure a 20-minute auto-termination policy on all interactive Databricks clusters.",
      capabilityKey: "databricks",
      capabilityName: "Azure Databricks",
      estimatedMonthlySavingsUSD: "2000.00",
      confidence: "HIGH",
      actionType: "auto_termination",
    },
    {
      id: "rem-ml-autoshutdown",
      title: "Enable Auto-Shutdown on AML Compute Instances",
      description:
        "Configure auto-shutdown after 1 hour of inactivity on all Azure ML compute instances.",
      capabilityKey: "machine_learning",
      capabilityName: "Azure Machine Learning",
      estimatedMonthlySavingsUSD: "2100.00",
      confidence: "HIGH",
      actionType: "auto_shutdown",
    },
    {
      id: "rem-foundry-model-modernize",
      title: "Modernize Legacy Models to gpt-4o-mini",
      description:
        "Replace expensive model deployments with gpt-4o-mini for non-critical workloads.",
      capabilityKey: "foundry",
      capabilityName: "Azure AI Foundry / OpenAI",
      estimatedMonthlySavingsUSD: "1750.00",
      confidence: "MEDIUM",
      actionType: "model_modernization",
    },
    {
      id: "rem-search-rightsize",
      title: "Rightsize AI Search Replicas",
      description:
        "Reduce replica count on underutilized search services to match actual query volume.",
      capabilityKey: "search",
      capabilityName: "Azure AI Search",
      estimatedMonthlySavingsUSD: "1800.00",
      confidence: "HIGH",
      actionType: "rightsizing",
    },
    {
      id: "rem-docintel-commitment",
      title: "Evaluate Commitment Tier for Document Intelligence",
      description:
        "At current page volume, a Capacity commitment tier could yield significant savings.",
      capabilityKey: "doc_intelligence",
      capabilityName: "Document Intelligence",
      estimatedMonthlySavingsUSD: "2100.00",
      confidence: "MEDIUM",
      actionType: "commitment_tier",
    },
  ];

  return {
    metrics,
    capabilityBreakdown: breakdown,
    unitEconomics,
    riskSignals,
    remediationActions,
    mock: true,
  };
}

// ── Real Data: Run per-capability collectors ────────────────────────────────

/**
 * Runs the SAME sync + Cost Management pipeline as the original
 * /api/intelligence/azure-ai endpoint. This ensures we get REAL cost data
 * from Azure, not stale/empty SQL snapshots.
 */
async function fetchRealCapabilitiesFromAzure(tenantId: string): Promise<CachedCapability[]> {
  const results: CachedCapability[] = [];

  // Run all 8 capability collectors in parallel.
  // Each collector: syncs snapshots to SQL, then queries Cost Management API
  // for real MTD cost. Falls back to snapshot data if Cost Management is
  // unavailable (e.g., missing Reader role).
  const [
    search,
    docIntel,
    speechLang,
    visionVideo,
    contentSafety,
    aml,
    databricks,
    foundry,
  ] = await Promise.all([
    fetchSearchCapability(tenantId),
    fetchDocIntelCapability(tenantId),
    fetchAiServiceCapability(
      tenantId,
      "AzureSpeechLanguageSnapshots",
      "speech-language",
      syncSpeechLanguageSnapshots,
      getSpeechLanguageResources,
      ["speech", "translator", "textanalytics", "language"]
    ),
    fetchAiServiceCapability(
      tenantId,
      "AzureVisionVideoSnapshots",
      "vision-video",
      syncVisionVideoSnapshots,
      getVisionVideoResources,
      ["computervision", "customvision", "vision", "face"]
    ),
    fetchAiServiceCapability(
      tenantId,
      "AzureContentSafetySnapshots",
      "content-safety",
      syncContentSafetySnapshots,
      getContentSafetyResources,
      ["contentsafety", "content safety"]
    ),
    fetchAiServiceCapability(
      tenantId,
      "AzureMLSnapshots",
      "aml",
      syncAMLSnapshots,
      getAMLResources,
      ["machine learning", "machinelearningservices", "azureml"]
    ),
    fetchAiServiceCapability(
      tenantId,
      "AzureDatabricksSnapshots",
      "databricks",
      syncDatabricksSnapshots,
      getDatabricksResources,
      ["databricks"]
    ),
    fetchFoundryCapability(tenantId),
  ]);

  if (search) results.push(search);
  if (docIntel) results.push(docIntel);
  if (speechLang) results.push(speechLang);
  if (visionVideo) results.push(visionVideo);
  if (contentSafety) results.push(contentSafety);
  if (aml) results.push(aml);
  if (databricks) results.push(databricks);
  if (foundry) results.push(foundry);

  return results;
}

// ── Per-Capability Collectors (mirrors route.ts logic) ──────────────────────

async function fetchSearchCapability(tenantId: string): Promise<CachedCapability | null> {
  try {
    // 1. Try snapshot table first
    const [rows] = await pool.query(
      `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
              utilizationPercent, lastAccessedDaysAgo
       FROM AzureSearchSnapshots
       WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      [tenantId]
    ) as [Array<Record<string, unknown>>, unknown];

    // 2. If no snapshots, sync live from Azure
    if (!rows || rows.length === 0) {
      try {
        await syncAzureSearchSnapshots(tenantId);
        const [freshRows] = await pool.query(
          `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
                  utilizationPercent, lastAccessedDaysAgo
           FROM AzureSearchSnapshots
           WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
          [tenantId]
        ) as [Array<Record<string, unknown>>, unknown];
        if (freshRows && freshRows.length > 0) {
          return buildCapabilityFromRows("search", "Azure AI Search", freshRows);
        }
      } catch (syncErr) {
        console.warn("[azureAiSummary] Search sync failed:", syncErr);
      }
    }

    // 3. If still no data, try direct Resource Graph + Cost Management
    if (!rows || rows.length === 0) {
      try {
        const liveResources = await getAzureSearchResources(tenantId);
        if (liveResources && liveResources.length > 0) {
          const credential = await getAzureCredential(tenantId).catch(() => null);
          const enrichedResources = await Promise.all(
            liveResources.map(async (r: { id: string; name: string; region: string; resourceGroup: string }) => {
              const subId = r.id.split("/")[2] || "";
              let cost = 0;
              if (credential) {
                cost = await getAzureSearchRealCost(tenantId, credential, r.id, subId);
              }
              return {
                resourceName: r.name,
                region: r.region,
                resourceGroup: r.resourceGroup,
                monthlyCostUSD: cost > 0 ? cost : 0,
                utilizationPercent: 0,
                lastAccessedDaysAgo: 0,
              };
            })
          );
          return buildCapabilityFromRows("search", "Azure AI Search", enrichedResources);
        }
      } catch (liveErr) {
        console.warn("[azureAiSummary] Search live lookup failed:", liveErr);
      }
      return null;
    }

    return buildCapabilityFromRows("search", "Azure AI Search", rows);
  } catch (err) {
    console.error("[azureAiSummary] Search capability error:", err);
    return null;
  }
}

async function fetchDocIntelCapability(tenantId: string): Promise<CachedCapability | null> {
  try {
    const [rows] = await pool.query(
      `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
              utilizationPercent, lastAccessedDaysAgo
       FROM AzureDocumentIntelligenceSnapshots
       WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      [tenantId]
    ) as [Array<Record<string, unknown>>, unknown];

    if (!rows || rows.length === 0) {
      try {
        await syncDocIntelSnapshots(tenantId);
        const [freshRows] = await pool.query(
          `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
                  utilizationPercent, lastAccessedDaysAgo
           FROM AzureDocumentIntelligenceSnapshots
           WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
          [tenantId]
        ) as [Array<Record<string, unknown>>, unknown];
        if (freshRows && freshRows.length > 0) {
          return buildCapabilityFromRows("doc_intelligence", "Document Intelligence", freshRows);
        }
      } catch (syncErr) {
        console.warn("[azureAiSummary] DocIntel sync failed:", syncErr);
      }
    }

    if (!rows || rows.length === 0) {
      try {
        const liveResources = await getDocIntelResources(tenantId);
        if (liveResources && liveResources.length > 0) {
          const credential = await getAzureCredential(tenantId).catch(() => null);
          const enrichedResources = await Promise.all(
            liveResources.map(async (r: { id: string; name: string; region: string; resourceGroup: string }) => {
              const subId = r.id.split("/")[2] || "";
              let cost = 0;
              if (credential) {
                cost = await getDocIntelRealCost(tenantId, credential, r.id, subId);
              }
              return {
                resourceName: r.name,
                region: r.region,
                resourceGroup: r.resourceGroup,
                monthlyCostUSD: cost > 0 ? cost : 0,
                utilizationPercent: 0,
                lastAccessedDaysAgo: 0,
              };
            })
          );
          return buildCapabilityFromRows("doc_intelligence", "Document Intelligence", enrichedResources);
        }
      } catch (liveErr) {
        console.warn("[azureAiSummary] DocIntel live lookup failed:", liveErr);
      }
      return null;
    }

    return buildCapabilityFromRows("doc_intelligence", "Document Intelligence", rows);
  } catch (err) {
    console.error("[azureAiSummary] DocIntel capability error:", err);
    return null;
  }
}

async function fetchFoundryCapability(tenantId: string): Promise<CachedCapability | null> {
  try {
    // 1. Try snapshot table
    const [rows] = await pool.query(
      `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
              utilizationPercent, lastAccessedDaysAgo, snapshotDate
       FROM AzureFoundrySnapshots
       WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       ORDER BY snapshotDate DESC`,
      [tenantId]
    ) as [Array<Record<string, unknown>>, unknown];

    // 2. If no snapshots, sync live
    if (!rows || rows.length === 0) {
      try {
        await syncFoundrySnapshots(tenantId);
        const [freshRows] = await pool.query(
          `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
                  utilizationPercent, lastAccessedDaysAgo, snapshotDate
           FROM AzureFoundrySnapshots
           WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
           ORDER BY snapshotDate DESC`,
          [tenantId]
        ) as [Array<Record<string, unknown>>, unknown];
        if (freshRows && freshRows.length > 0) {
          const deduplicated = selectLatestAzureAiSnapshots(freshRows);
          return buildCapabilityFromRows("foundry", "Azure AI Foundry / OpenAI", deduplicated);
        }
      } catch (syncErr) {
        console.warn("[azureAiSummary] Foundry sync failed:", syncErr);
      }
    }

    // 3. If still no data, try direct Cost Management lookup via Resource Graph
    if (!rows || rows.length === 0) {
      try {
        const credential = await getAzureCredential(tenantId).catch(() => null);
        if (credential) {
          // Query Resource Graph for Foundry resources, then get cost for each
          const { ResourceGraphClient } = await import("@azure/arm-resourcegraph");
          const rgClient = new ResourceGraphClient(credential);
          const queryResult = await rgClient.resources({
            query: `resources
| where type =~ "Microsoft.CognitiveServices/accounts"
| where kind in~ ("OpenAI", "AIServices")
| project id, name, location, resourceGroup`,
            subscriptions: [],
          });
          const foundryResources = (queryResult.data as Array<{ id: string; name: string; location: string; resourceGroup: string }>) || [];
          let totalCost = 0;
          for (const r of foundryResources) {
            const subId = r.id.split("/")[2] || "";
            const cost = await getFoundryResourceCost(tenantId, credential, r.id, subId);
            totalCost += cost;
          }
          if (totalCost > 0) {
            return {
              capability: "foundry",
              name: "Azure AI Foundry / OpenAI",
              monthlyCostUSD: totalCost,
              wasteMetrics: {
                orphanedResourceCount: 0,
                underutilizedResourceCount: 0,
                idleResourceCount: 0,
                estimatedWasteUSD: 0,
              },
              resources: foundryResources.map((r) => ({
                name: r.name,
                region: r.location,
                resourceGroup: r.resourceGroup,
                type: "Microsoft.CognitiveServices/accounts",
                monthlyCost: 0,
              })),
              recommendations: [],
              source: "live" as const,
            };
          }
        }
      } catch (liveErr) {
        console.warn("[azureAiSummary] Foundry live lookup failed:", liveErr);
      }
      return null;
    }

    const deduplicated = selectLatestAzureAiSnapshots(rows);
    return buildCapabilityFromRows("foundry", "Azure AI Foundry / OpenAI", deduplicated);
  } catch (err) {
    console.error("[azureAiSummary] Foundry capability error:", err);
    return null;
  }
}

async function fetchAiServiceCapability(
  tenantId: string,
  tableName: string,
  capabilityKey: string,
  syncFn: (tid: string) => Promise<void>,
  getResourcesFn: (tid: string) => Promise<Array<{ id: string; name: string; region: string; resourceGroup: string }>>,
  serviceKeywords: string[]
): Promise<CachedCapability | null> {
  try {
    const [rows] = await pool.query(
      `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
              utilizationPercent, lastAccessedDaysAgo, snapshotDate
       FROM \`${tableName}\`
       WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       ORDER BY snapshotDate DESC`,
      [tenantId]
    ) as [Array<Record<string, unknown>>, unknown];

    if (!rows || rows.length === 0) {
      try {
        await syncFn(tenantId);
        const [freshRows] = await pool.query(
          `SELECT resourceName, region, resourceGroup, monthlyCostUSD,
                  utilizationPercent, lastAccessedDaysAgo, snapshotDate
           FROM \`${tableName}\`
           WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
           ORDER BY snapshotDate DESC`,
          [tenantId]
        ) as [Array<Record<string, unknown>>, unknown];
        if (freshRows && freshRows.length > 0) {
          const deduplicated = selectLatestAzureAiSnapshots(freshRows);
          return buildCapabilityFromRows(
            capabilityKey as AiCapabilityKey,
            CAPABILITY_META[capabilityKey as AiCapabilityKey]?.displayName || capabilityKey,
            deduplicated
          );
        } else {
          // Sync confirmed 0 resources in Azure
          return buildCapabilityFromRows(
            capabilityKey as AiCapabilityKey,
            CAPABILITY_META[capabilityKey as AiCapabilityKey]?.displayName || capabilityKey,
            []
          );
        }
      } catch (syncErr) {
        console.warn(`[azureAiSummary] ${capabilityKey} sync failed:`, syncErr);
      }
    }

    if (!rows || rows.length === 0) {
      try {
        const liveResources = await getResourcesFn(tenantId);
        if (liveResources && liveResources.length > 0) {
          const credential = await getAzureCredential(tenantId).catch(() => null);
          const enrichedResources = await Promise.all(
            liveResources.map(async (r) => {
              const subId = r.id.split("/")[2] || "";
              let cost = 0;
              if (credential) {
                cost = await getAiServiceRealCost(tenantId, credential, r.id, subId, serviceKeywords);
              }
              return {
                resourceName: r.name,
                region: r.region,
                resourceGroup: r.resourceGroup,
                monthlyCostUSD: cost > 0 ? cost : 0,
                utilizationPercent: 0,
                lastAccessedDaysAgo: 0,
              };
            })
          );
          return buildCapabilityFromRows(
            capabilityKey as AiCapabilityKey,
            CAPABILITY_META[capabilityKey as AiCapabilityKey]?.displayName || capabilityKey,
            enrichedResources
          );
        }
      } catch (liveErr) {
        console.warn(`[azureAiSummary] ${capabilityKey} live lookup failed:`, liveErr);
      }
      return null;
    }

    const deduplicated = selectLatestAzureAiSnapshots(rows);
    return buildCapabilityFromRows(
      capabilityKey as AiCapabilityKey,
      CAPABILITY_META[capabilityKey as AiCapabilityKey]?.displayName || capabilityKey,
      deduplicated
    );
  } catch (err) {
    console.error(`[azureAiSummary] ${capabilityKey} capability error:`, err);
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildCapabilityFromRows(
  capability: string,
  name: string,
  rows: Array<Record<string, unknown>>
): CachedCapability {
  const resources = rows.map((r) => ({
    name: (r.resourceName as string) || "Unknown",
    region: (r.region as string) || "Unknown",
    resourceGroup: (r.resourceGroup as string) || "Unknown",
    type: "Resource",
    monthlyCost: Number(r.monthlyCostUSD) || 0,
    utilizationPercent: Number(r.utilizationPercent) || 0,
    lastAccessedDaysAgo: Number(r.lastAccessedDaysAgo) || 0,
  }));

  const totalCost = resources.reduce((sum, r) => sum + r.monthlyCost, 0);
  const orphanedCount = resources.filter((r) => (r.lastAccessedDaysAgo || 0) > 30).length;
  const underutilizedCount = resources.filter((r) => (r.utilizationPercent || 0) < 20).length;
  const estimatedWaste = resources
    .filter((r) => (r.utilizationPercent || 0) < 20)
    .reduce((sum, r) => sum + r.monthlyCost * 0.3, 0);

  return {
    capability,
    name,
    monthlyCostUSD: totalCost,
    wasteMetrics: {
      orphanedResourceCount: orphanedCount,
      underutilizedResourceCount: underutilizedCount,
      idleResourceCount: resources.filter((r) => (r.utilizationPercent || 0) < 10).length,
      estimatedWasteUSD: Math.round(estimatedWaste * 100) / 100,
    },
    resources,
    recommendations: [],
    source: "snapshot" as const,
  };
}

// ── Map capability key from route.ts format to our format ───────────────────

function mapCapabilityKey(raw: string): AiCapabilityKey {
  const mapping: Record<string, AiCapabilityKey> = {
    search: "search",
    "document-intelligence": "doc_intelligence",
    "speech-language": "speech_language",
    "vision-video": "vision_video",
    "content-safety": "content_safety",
    aml: "machine_learning",
    databricks: "databricks",
    foundry: "foundry",
  };
  return mapping[raw] || "foundry";
}

// ── Build Summary Payload from Cached Capabilities ──────────────────────────

function buildSummaryFromCapabilities(capabilities: CachedCapability[]): AzureAiSummaryPayload {
  const now = new Date().toISOString();

  // Build capability breakdown
  const breakdown: AiCapabilityBreakdownItem[] = ALL_CAPABILITY_KEYS.map((key) => {
    const meta = CAPABILITY_META[key];
    const cap = capabilities.find((c) => mapCapabilityKey(c.capability) === key);

    if (!cap) {
      return {
        capabilityKey: key,
        displayName: meta.displayName,
        costMtdUSD: "0.00",
        sharePercentage: "0.0",
        wasteUSD: "0.00",
        activeResourcesCount: 0,
        colorHex: meta.colorHex,
        hasAnomaly: false,
      };
    }

    const waste = new Decimal(cap.wasteMetrics.estimatedWasteUSD || 0);
    return {
      capabilityKey: key,
      displayName: meta.displayName,
      costMtdUSD: new Decimal(cap.monthlyCostUSD || 0).toFixed(2),
      sharePercentage: "0.0", // recalculated below
      wasteUSD: waste.toFixed(2),
      activeResourcesCount: cap.resources.length,
      colorHex: meta.colorHex,
      hasAnomaly: waste.gt(0),
    };
  });

  // Recalculate share percentages
  const totalCost = breakdown.reduce(
    (sum, c) => sum.plus(new Decimal(c.costMtdUSD)),
    new Decimal(0)
  );
  if (totalCost.gt(0)) {
    for (const item of breakdown) {
      item.sharePercentage = new Decimal(item.costMtdUSD).div(totalCost).times(100).toFixed(1);
    }
  }

  // Total waste
  const totalWaste = breakdown.reduce(
    (sum, c) => sum.plus(new Decimal(c.wasteUSD)),
    new Decimal(0)
  );

  // Total potential savings from recommendations
  const allRecommendations = capabilities.flatMap((c) => c.recommendations || []);
  const totalPotentialSavings = allRecommendations.reduce(
    (sum, r) => sum + (r.potentialSavingsUSD || 0),
    0
  );

  // Forecast EOM
  const nowDate = new Date();
  const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const daysElapsed = Math.max(1, nowDate.getDate());
  const forecastRatio = new Decimal(daysInMonth).div(daysElapsed);
  const forecastEom = totalCost.times(forecastRatio);

  // Unit economics from Foundry snapshots
  const foundryCap = capabilities.find((c) => c.capability === "foundry");
  const unitEconomics: AiUnitEconomics = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    avgCostPerMillionTokensUSD: "0.00",
    billingModel: foundryCap && foundryCap.monthlyCostUSD > 0 ? "PAYG" : "UNKNOWN",
    activeDeployments: foundryCap?.resources?.length || 0,
    topModelName: "N/A",
  };

  // Risk signals
  const riskSignals: AiRiskAnomalySignal[] = [];
  for (const cap of capabilities) {
    const key = mapCapabilityKey(cap.capability);
    const meta = CAPABILITY_META[key];
    const waste = cap.wasteMetrics;

    if (waste.orphanedResourceCount > 0) {
      riskSignals.push({
        id: `risk-${key}-orphaned`,
        title: `${meta.displayName}: ${waste.orphanedResourceCount} Orphaned Resource(s)`,
        description: `Resources with no activity in 30+ days still accruing costs.`,
        severity: waste.estimatedWasteUSD > 1000 ? "HIGH" : "MEDIUM",
        detectedAt: now,
        serviceOrigin: key,
        serviceOriginName: meta.displayName,
        estimatedImpactUSD: new Decimal(waste.estimatedWasteUSD).toFixed(2),
      });
    }

    if (waste.underutilizedResourceCount > 0 && waste.orphanedResourceCount === 0) {
      riskSignals.push({
        id: `risk-${key}-underutilized`,
        title: `${meta.displayName}: ${waste.underutilizedResourceCount} Underutilized Resource(s)`,
        description: `Resources below 20% utilization. Consider rightsizing or scheduling.`,
        severity: "MEDIUM",
        detectedAt: now,
        serviceOrigin: key,
        serviceOriginName: meta.displayName,
        estimatedImpactUSD: new Decimal(waste.estimatedWasteUSD).toFixed(2),
      });
    }
  }

  // Remediation actions
  const remediationActions: AiRemediationAction[] = [];
  for (const cap of capabilities) {
    const key = mapCapabilityKey(cap.capability);
    const meta = CAPABILITY_META[key];
    const waste = cap.wasteMetrics;

    if (waste.estimatedWasteUSD > 0 && key === "databricks") {
      remediationActions.push({
        id: `rem-${key}-autoterm`,
        title: "Enable Auto-Termination on Databricks Clusters",
        description: "Configure a 20-minute auto-termination policy on all interactive clusters.",
        capabilityKey: key,
        capabilityName: meta.displayName,
        estimatedMonthlySavingsUSD: new Decimal(waste.estimatedWasteUSD).toFixed(2),
        confidence: "HIGH",
        actionType: "auto_termination",
      });
    }

    if (waste.estimatedWasteUSD > 0 && key === "machine_learning") {
      remediationActions.push({
        id: `rem-${key}-autoshutdown`,
        title: "Enable Auto-Shutdown on AML Compute Instances",
        description: "Configure auto-shutdown after 1 hour of inactivity.",
        capabilityKey: key,
        capabilityName: meta.displayName,
        estimatedMonthlySavingsUSD: new Decimal(waste.estimatedWasteUSD).toFixed(2),
        confidence: "HIGH",
        actionType: "auto_shutdown",
      });
    }

    if (cap.monthlyCostUSD > 100 && key === "foundry") {
      const savings = new Decimal(cap.monthlyCostUSD).times(0.15);
      remediationActions.push({
        id: `rem-${key}-model-modernize`,
        title: "Modernize Legacy Models to gpt-4o-mini",
        description: "Replace expensive model deployments with gpt-4o-mini for non-critical workloads.",
        capabilityKey: key,
        capabilityName: meta.displayName,
        estimatedMonthlySavingsUSD: savings.toFixed(2),
        confidence: "MEDIUM",
        actionType: "model_modernization",
      });
    }

    if (waste.estimatedWasteUSD > 0 && key === "search") {
      remediationActions.push({
        id: `rem-${key}-rightsize`,
        title: "Rightsize AI Search Replicas & Partitions",
        description: "Reduce replica/partition count on underutilized search services.",
        capabilityKey: key,
        capabilityName: meta.displayName,
        estimatedMonthlySavingsUSD: new Decimal(waste.estimatedWasteUSD).toFixed(2),
        confidence: "HIGH",
        actionType: "rightsizing",
      });
    }
  }

  // Sort by savings descending
  remediationActions.sort(
    (a, b) =>
      parseFloat(b.estimatedMonthlySavingsUSD) - parseFloat(a.estimatedMonthlySavingsUSD)
  );

  const metrics: AzureAiSummaryMetrics = {
    totalCostMtdUSD: totalCost.toFixed(2),
    forecastEomUSD: forecastEom.toFixed(2),
    estimatedWasteUSD: totalWaste.toFixed(2),
    potentialSavingsUSD: new Decimal(totalPotentialSavings).toFixed(2),
    totalTokensProcessed: unitEconomics.totalTokens,
    avgCostPerMillionTokensUSD: unitEconomics.avgCostPerMillionTokensUSD,
    billingModel: unitEconomics.billingModel,
    momVariationPct: "0.0",
    computedAt: now,
    source: "snapshot",
  };

  return {
    metrics,
    capabilityBreakdown: breakdown,
    unitEconomics,
    riskSignals,
    remediationActions,
    mock: false,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Main entry point: returns the full Azure AI Summary payload.
 *
 * Data flow:
 *   - Mock tenant → synthetic demo data immediately.
 *   - Real tenant → check Redis cache → on miss, run per-capability collectors
 *     (sync + Cost Management API) → cache result → return.
 */
export async function getAzureAiSummary(
  tenantId: string
): Promise<AzureAiSummaryPayload> {
  // Mock-first: serve synthetic data immediately for demo tenants
  if (isMockTenant(tenantId)) {
    return generateMockSummaryPayload();
  }

  // Real tenant: check Redis cache first
  try {
    const cached = await getCachedCapabilities(tenantId);
    if (cached && cached.capabilities && cached.capabilities.length > 0) {
      console.log(
        `[azureAiSummary] Serving from Redis cache for ${tenantId} ` +
        `(cached ${Math.round((Date.now() - cached.cachedAt) / 1000)}s ago)`
      );
      return buildSummaryFromCapabilities(cached.capabilities);
    }
  } catch (cacheErr) {
    console.warn("[azureAiSummary] Redis cache read failed, falling through to Azure:", cacheErr);
  }

  // Cache miss: run the real collectors
  console.log(`[azureAiSummary] Cache miss for ${tenantId}, running Azure collectors...`);
  try {
    const capabilities = await fetchRealCapabilitiesFromAzure(tenantId);

    // Cache the result for 2 hours (non-blocking)
    cacheCapabilities(tenantId, capabilities).catch((err) => {
      console.error(`[azureAiSummary] Failed to cache for ${tenantId}:`, err);
    });

    return buildSummaryFromCapabilities(capabilities);
  } catch (err) {
    console.error("[azureAiSummary] Real capability fetch failed:", err);
    return createZeroStatePayload();
  }
}

function createZeroStatePayload(): AzureAiSummaryPayload {
  const now = new Date().toISOString();
  const breakdown: AiCapabilityBreakdownItem[] = ALL_CAPABILITY_KEYS.map((key) => ({
    capabilityKey: key,
    displayName: CAPABILITY_META[key].displayName,
    costMtdUSD: "0.00",
    sharePercentage: "0.0",
    wasteUSD: "0.00",
    activeResourcesCount: 0,
    colorHex: CAPABILITY_META[key].colorHex,
    hasAnomaly: false,
  }));

  return {
    metrics: {
      totalCostMtdUSD: "0.00",
      forecastEomUSD: "0.00",
      estimatedWasteUSD: "0.00",
      potentialSavingsUSD: "0.00",
      totalTokensProcessed: 0,
      avgCostPerMillionTokensUSD: "0.00",
      billingModel: "UNKNOWN",
      momVariationPct: "0.0",
      computedAt: now,
      source: "live",
    },
    capabilityBreakdown: breakdown,
    unitEconomics: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      avgCostPerMillionTokensUSD: "0.00",
      billingModel: "UNKNOWN",
      activeDeployments: 0,
      topModelName: "N/A",
    },
    riskSignals: [],
    remediationActions: [],
    mock: false,
  };
}