import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

type Capability = "search" | "document-intelligence" | "speech-language" | "vision-video" | "content-safety" | "aml" | "databricks" | "foundry";

interface FinopsRecommendation {
  id: string;
  capability: Capability;
  title: string;
  description: string;
  potentialSavingsUSD: number;
  effort: "low" | "medium" | "high";
  roiMonths: number;
  actionType: "rightsizing" | "termination" | "optimization" | "migration" | "consolidation";
  resourceAffected: string;
  confidence: number;
}

interface CapabilityMetrics {
  capability: Capability;
  name: string;
  description: string;
  monthlyCostUSD: number;
  costBreakdown: {
    computeCost: number;
    storageCost: number;
    queryTransactionCost: number;
    overheadCost: number;
  };
  usage: { metric: string; value: number; unit: string; costPer?: number }[];
  resources: Array<{
    name: string;
    region: string;
    resourceGroup: string;
    type: string;
    monthlyCost: number;
    utilizationPercent?: number;
    lastAccessedDaysAgo?: number;
  }>;
  wasteMetrics: {
    orphanedResourceCount: number;
    underutilizedResourceCount: number;
    idleResourceCount: number;
    estimatedWasteUSD: number;
  };
  recommendations: FinopsRecommendation[];
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}

const CAPABILITIES_METADATA: Record<Capability, { name: string; description: string }> = {
  search: {
    name: "Azure AI Search",
    description: "Vectorial search, semantic ranking, RAG patterns for hybrid retrieval-augmented generation.",
  },
  "document-intelligence": {
    name: "Azure AI Document Intelligence",
    description: "Deep learning models for text, table, and structured data extraction from documents, invoices, forms.",
  },
  "speech-language": {
    name: "Azure AI Speech & Language",
    description: "Speech-to-text transcription, real-time translation, sentiment analysis, conversational language understanding.",
  },
  "vision-video": {
    name: "Azure AI Vision & Video Indexer",
    description: "Image and video analysis: object/face detection, text extraction (OCR), auto-tagging, content summarization.",
  },
  "content-safety": {
    name: "Azure AI Content Safety",
    description: "AI-powered moderation: detect and filter inappropriate text and images.",
  },
  aml: {
    name: "Azure Machine Learning",
    description: "MLOps platform: build, train, deploy models. AutoML, experiment tracking, managed endpoints.",
  },
  databricks: {
    name: "Azure Databricks",
    description: "Analytics and ML: distributed Spark workloads, MLflow experiment tracking, LLM fine-tuning.",
  },
  foundry: {
    name: "Azure AI Foundry",
    description: "Model catalog, prompt orchestration, fine-tuning, and managed inference for enterprise GenAI workloads.",
  },
};

const MOCK_CAPABILITIES: CapabilityMetrics[] = [
  {
    capability: "search",
    name: CAPABILITIES_METADATA.search.name,
    description: CAPABILITIES_METADATA.search.description,
    monthlyCostUSD: 12450.5,
    costBreakdown: {
      computeCost: 7200,
      storageCost: 3150,
      queryTransactionCost: 1650.5,
      overheadCost: 450,
    },
    usage: [
      { metric: "Search Queries (daily avg)", value: 45000, unit: "queries/day", costPer: 0.0275 },
      { metric: "Indexed Documents", value: 2500000, unit: "docs" },
      { metric: "Storage GB", value: 650, unit: "GB", costPer: 4.85 },
      { metric: "Semantic Ranker Calls", value: 18000, unit: "calls/day", costPer: 0.0825 },
    ],
    resources: [
      {
        name: "search-prod-eastus",
        region: "East US",
        resourceGroup: "prod-search-rg",
        type: "Microsoft.Search/searchServices",
        monthlyCost: 12450.5,
        utilizationPercent: 72,
        lastAccessedDaysAgo: 0,
      },
      {
        name: "search-dev-eastus",
        region: "East US",
        resourceGroup: "dev-search-rg",
        type: "Microsoft.Search/searchServices",
        monthlyCost: 2100,
        utilizationPercent: 8,
        lastAccessedDaysAgo: 45,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 1,
      underutilizedResourceCount: 1,
      idleResourceCount: 0,
      estimatedWasteUSD: 1800,
    },
    recommendations: [
      {
        id: "search-orphan-dev",
        capability: "search",
        title: "Terminate Orphaned Dev Search Instance",
        description: "search-dev-eastus has <10% utilization and hasn't been accessed in 45 days. Recommended for termination.",
        potentialSavingsUSD: 2100,
        effort: "low",
        roiMonths: 1,
        actionType: "termination",
        resourceAffected: "search-dev-eastus",
        confidence: 0.95,
      },
      {
        id: "search-semantic-ranker-capacity",
        capability: "search",
        title: "Right-size Semantic Ranker Queries",
        description: "Reduce Semantic Ranker calls outside peak hours (9am-5pm UTC). Potential 25-30% reduction with same SLA.",
        potentialSavingsUSD: 495,
        effort: "medium",
        roiMonths: 2,
        actionType: "optimization",
        resourceAffected: "search-prod-eastus",
        confidence: 0.78,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
  {
    capability: "document-intelligence",
    name: CAPABILITIES_METADATA["document-intelligence"].name,
    description: CAPABILITIES_METADATA["document-intelligence"].description,
    monthlyCostUSD: 8920.75,
    costBreakdown: {
      computeCost: 5200,
      storageCost: 1850,
      queryTransactionCost: 1620.75,
      overheadCost: 250,
    },
    usage: [
      { metric: "Pages Processed", value: 450000, unit: "pages/month", costPer: 0.0198 },
      { metric: "Avg Processing Time", value: 850, unit: "ms" },
      { metric: "Success Rate", value: 97.3, unit: "%" },
      { metric: "Custom Models Trained", value: 3, unit: "models" },
    ],
    resources: [
      {
        name: "doc-intel-prod",
        region: "East US",
        resourceGroup: "ai-services-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 8920.75,
        utilizationPercent: 64,
        lastAccessedDaysAgo: 0,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 0,
      underutilizedResourceCount: 0,
      idleResourceCount: 0,
      estimatedWasteUSD: 0,
    },
    recommendations: [
      {
        id: "doc-intel-capacity-tier",
        capability: "document-intelligence",
        title: "Evaluate Commitment Tier vs. Pay-As-You-Go",
        description: "At 450K pages/month, a Capacity commitment (C2 tier) could save ~$2,100/month (23% reduction).",
        potentialSavingsUSD: 2100,
        effort: "low",
        roiMonths: 1,
        actionType: "migration",
        resourceAffected: "doc-intel-prod",
        confidence: 0.88,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
  {
    capability: "speech-language",
    name: CAPABILITIES_METADATA["speech-language"].name,
    description: CAPABILITIES_METADATA["speech-language"].description,
    monthlyCostUSD: 7200,
    costBreakdown: {
      computeCost: 3600,
      storageCost: 1200,
      queryTransactionCost: 2100,
      overheadCost: 300,
    },
    usage: [
      { metric: "Audio Minutes Processed", value: 125000, unit: "min/month", costPer: 0.0288 },
      { metric: "Language Pairs Translated", value: 25, unit: "pairs" },
      { metric: "Sentiment Analyses", value: 320000, unit: "analyses/month", costPer: 0.00225 },
      { metric: "Live Transcription Sessions", value: 450, unit: "sessions/month", costPer: 2.14 },
    ],
    resources: [
      {
        name: "speech-lang-prod",
        region: "East US",
        resourceGroup: "ai-services-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 7200,
        utilizationPercent: 81,
        lastAccessedDaysAgo: 0,
      },
      {
        name: "speech-lang-westeurope",
        region: "West Europe",
        resourceGroup: "ai-services-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 1500,
        utilizationPercent: 12,
        lastAccessedDaysAgo: 90,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 1,
      underutilizedResourceCount: 1,
      idleResourceCount: 0,
      estimatedWasteUSD: 1350,
    },
    recommendations: [
      {
        id: "speech-consolidate-geo",
        capability: "speech-language",
        title: "Consolidate Geo-redundant Speech Service",
        description: "speech-lang-westeurope (12% utilization, dormant 90 days) can be retired. Route via ER + failover policy.",
        potentialSavingsUSD: 1500,
        effort: "high",
        roiMonths: 3,
        actionType: "consolidation",
        resourceAffected: "speech-lang-westeurope",
        confidence: 0.85,
      },
      {
        id: "speech-batch-optimization",
        capability: "speech-language",
        title: "Shift Batch Transcriptions to Batch API",
        description: "Current: live transcription (2.14/session). Batch API: ~$0.20/session. 450 sessions/mo → ~$870 savings.",
        potentialSavingsUSD: 870,
        effort: "medium",
        roiMonths: 2,
        actionType: "optimization",
        resourceAffected: "speech-lang-prod",
        confidence: 0.92,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
  {
    capability: "vision-video",
    name: CAPABILITIES_METADATA["vision-video"].name,
    description: CAPABILITIES_METADATA["vision-video"].description,
    monthlyCostUSD: 9150.25,
    costBreakdown: {
      computeCost: 5400,
      storageCost: 2100,
      queryTransactionCost: 1350.25,
      overheadCost: 300,
    },
    usage: [
      { metric: "Images Analyzed", value: 650000, unit: "images/month", costPer: 0.00525 },
      { metric: "Video Minutes Indexed", value: 85000, unit: "min/month", costPer: 0.0485 },
      { metric: "Faces Detected", value: 2100000, unit: "faces/month" },
      { metric: "Custom Vision Models", value: 7, unit: "models" },
    ],
    resources: [
      {
        name: "vision-prod-eastus",
        region: "East US",
        resourceGroup: "media-ai-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 9150.25,
        utilizationPercent: 68,
        lastAccessedDaysAgo: 0,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 0,
      underutilizedResourceCount: 0,
      idleResourceCount: 0,
      estimatedWasteUSD: 0,
    },
    recommendations: [
      {
        id: "vision-video-tier",
        capability: "vision-video",
        title: "Evaluate Video Indexer Standard vs. Premium",
        description: "Current payload suggests Standard tier suffices. Premium tier (3.5x cost) only needed for >250K hours/month indexed video.",
        potentialSavingsUSD: 0,
        effort: "low",
        roiMonths: 0,
        actionType: "optimization",
        resourceAffected: "vision-prod-eastus",
        confidence: 0.9,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
  {
    capability: "content-safety",
    name: CAPABILITIES_METADATA["content-safety"].name,
    description: CAPABILITIES_METADATA["content-safety"].description,
    monthlyCostUSD: 3240,
    costBreakdown: {
      computeCost: 1800,
      storageCost: 400,
      queryTransactionCost: 900,
      overheadCost: 140,
    },
    usage: [
      { metric: "Moderation Requests", value: 850000, unit: "requests/month", costPer: 0.0038 },
      { metric: "Avg Latency", value: 125, unit: "ms" },
      { metric: "Blocked Content %", value: 3.2, unit: "%" },
      { metric: "Promisify Escalations", value: 1250, unit: "escalations/month" },
    ],
    resources: [
      {
        name: "content-safety-prod",
        region: "East US",
        resourceGroup: "safety-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 3240,
        utilizationPercent: 79,
        lastAccessedDaysAgo: 0,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 0,
      underutilizedResourceCount: 0,
      idleResourceCount: 0,
      estimatedWasteUSD: 0,
    },
    recommendations: [
      {
        id: "safety-high-volume-commitment",
        capability: "content-safety",
        title: "Negotiate Volume Commitment",
        description: "At 850K requests/month, volume commitment tier could yield 15-20% discount (~$480-648/month).",
        potentialSavingsUSD: 550,
        effort: "low",
        roiMonths: 1,
        actionType: "optimization",
        resourceAffected: "content-safety-prod",
        confidence: 0.75,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
  {
    capability: "aml",
    name: CAPABILITIES_METADATA.aml.name,
    description: CAPABILITIES_METADATA.aml.description,
    monthlyCostUSD: 15800.5,
    costBreakdown: {
      computeCost: 10200,
      storageCost: 2800,
      queryTransactionCost: 2200.5,
      overheadCost: 600,
    },
    usage: [
      { metric: "Active Experiments", value: 32, unit: "count" },
      { metric: "Training Hours", value: 2400, unit: "h/month", costPer: 6.58 },
      { metric: "Inference Endpoints", value: 12, unit: "endpoints" },
      { metric: "Real-time Endpoint Calls", value: 2800000, unit: "calls/month", costPer: 0.00421 },
      { metric: "Spot VM Hours (Training)", value: 1800, unit: "h/month" },
    ],
    resources: [
      {
        name: "aml-workspace-prod",
        region: "East US",
        resourceGroup: "ml-ops-rg",
        type: "Microsoft.MachineLearningServices/workspaces",
        monthlyCost: 15800.5,
        utilizationPercent: 54,
        lastAccessedDaysAgo: 0,
      },
      {
        name: "aml-inference-endpoint-old",
        region: "East US",
        resourceGroup: "ml-ops-rg",
        type: "Microsoft.MachineLearningServices/onlineEndpoints",
        monthlyCost: 2200,
        utilizationPercent: 5,
        lastAccessedDaysAgo: 120,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 1,
      underutilizedResourceCount: 1,
      idleResourceCount: 0,
      estimatedWasteUSD: 2100,
    },
    recommendations: [
      {
        id: "aml-endpoint-idle",
        capability: "aml",
        title: "Terminate Idle Real-time Inference Endpoint",
        description: "aml-inference-endpoint-old: 5% utilization, no traffic 120 days. Migrate to batch/serverless if needed.",
        potentialSavingsUSD: 2200,
        effort: "high",
        roiMonths: 2,
        actionType: "termination",
        resourceAffected: "aml-inference-endpoint-old",
        confidence: 0.93,
      },
      {
        id: "aml-spot-vm-training",
        capability: "aml",
        title: "Expand Spot VM Usage for Non-critical Training",
        description: "Currently 1800/2400 training hours on Spot (75%). Move remaining 600h (25%) to Spot. Save ~$450/month (45% discount).",
        potentialSavingsUSD: 450,
        effort: "medium",
        roiMonths: 1,
        actionType: "optimization",
        resourceAffected: "aml-workspace-prod",
        confidence: 0.88,
      },
      {
        id: "aml-experiment-cleanup",
        capability: "aml",
        title: "Archive Inactive Experiments",
        description: "Of 32 experiments, 12 are >60 days idle. Moving to cold storage reduces metadata overhead.",
        potentialSavingsUSD: 180,
        effort: "low",
        roiMonths: 1,
        actionType: "optimization",
        resourceAffected: "aml-workspace-prod",
        confidence: 0.72,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
  {
    capability: "foundry",
    name: CAPABILITIES_METADATA.foundry.name,
    description: CAPABILITIES_METADATA.foundry.description,
    monthlyCostUSD: 11240.3,
    costBreakdown: {
      computeCost: 7450,
      storageCost: 1380,
      queryTransactionCost: 1930.3,
      overheadCost: 480,
    },
    usage: [
      { metric: "Prompt Tokens", value: 42000000, unit: "tokens/month", costPer: 0.00018 },
      { metric: "Completion Tokens", value: 18500000, unit: "tokens/month", costPer: 0.00028 },
      { metric: "Fine-tuning Jobs", value: 14, unit: "jobs/month", costPer: 142.5 },
      { metric: "Model Endpoints", value: 9, unit: "endpoints" },
    ],
    resources: [
      {
        name: "foundry-prod-eastus",
        region: "East US",
        resourceGroup: "genai-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 11240.3,
        utilizationPercent: 69,
        lastAccessedDaysAgo: 0,
      },
      {
        name: "foundry-playground-dev",
        region: "East US",
        resourceGroup: "genai-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 980,
        utilizationPercent: 9,
        lastAccessedDaysAgo: 52,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 1,
      underutilizedResourceCount: 1,
      idleResourceCount: 0,
      estimatedWasteUSD: 820,
    },
    recommendations: [
      {
        id: "foundry-dev-playground-retire",
        capability: "foundry",
        title: "Retire Foundry Dev Playground Instance",
        description: "foundry-playground-dev shows 9% utilization and no activity in 52 days. Keep IaC template and spin up on demand.",
        potentialSavingsUSD: 980,
        effort: "low",
        roiMonths: 1,
        actionType: "termination",
        resourceAffected: "foundry-playground-dev",
        confidence: 0.93,
      },
      {
        id: "foundry-token-governance",
        capability: "foundry",
        title: "Apply Token Budgets and Prompt Caching",
        description: "Introduce per-project token budgets and prompt caching for repetitive calls. Estimated 15-20% token cost reduction.",
        potentialSavingsUSD: 1750,
        effort: "medium",
        roiMonths: 2,
        actionType: "optimization",
        resourceAffected: "foundry-prod-eastus",
        confidence: 0.84,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
  {
    capability: "databricks",
    name: CAPABILITIES_METADATA.databricks.name,
    description: CAPABILITIES_METADATA.databricks.description,
    monthlyCostUSD: 42150.75,
    costBreakdown: {
      computeCost: 32400,
      storageCost: 4850,
      queryTransactionCost: 3900.75,
      overheadCost: 1000,
    },
    usage: [
      { metric: "Cluster DBUs", value: 125000, unit: "DBU/month", costPer: 0.262 },
      { metric: "Active Clusters", value: 8, unit: "clusters" },
      { metric: "Jobs Executed", value: 12500, unit: "jobs/month", costPer: 3.37 },
      { metric: "OneLake Storage", value: 850, unit: "GB", costPer: 5.7 },
      { metric: "Idle Cluster Hours", value: 480, unit: "h/month" },
    ],
    resources: [
      {
        name: "databricks-workspace-prod",
        region: "East US",
        resourceGroup: "analytics-rg",
        type: "Microsoft.Databricks/workspaces",
        monthlyCost: 42150.75,
        utilizationPercent: 62,
        lastAccessedDaysAgo: 0,
      },
      {
        name: "databricks-cluster-dev-sandbox",
        region: "East US",
        resourceGroup: "analytics-rg",
        type: "Microsoft.Databricks/clusters",
        monthlyCost: 4800,
        utilizationPercent: 8,
        lastAccessedDaysAgo: 45,
      },
    ],
    wasteMetrics: {
      orphanedResourceCount: 1,
      underutilizedResourceCount: 1,
      idleResourceCount: 0,
      estimatedWasteUSD: 4250,
    },
    recommendations: [
      {
        id: "databricks-cluster-idle",
        capability: "databricks",
        title: "Terminate Orphaned Dev Sandbox Cluster",
        description: "databricks-cluster-dev-sandbox: 8% utilization, dormant 45 days. Spin up on-demand for dev work.",
        potentialSavingsUSD: 4800,
        effort: "low",
        roiMonths: 1,
        actionType: "termination",
        resourceAffected: "databricks-cluster-dev-sandbox",
        confidence: 0.96,
      },
      {
        id: "databricks-auto-terminate-policy",
        capability: "databricks",
        title: "Enforce 20-min Auto-termination on Interactive Clusters",
        description: "480 idle cluster hours/month = incomplete auto-termination setup. Enforce 20-30min auto-pause policy: save ~$1,800-2,400/month.",
        potentialSavingsUSD: 2000,
        effort: "low",
        roiMonths: 1,
        actionType: "optimization",
        resourceAffected: "databricks-workspace-prod",
        confidence: 0.89,
      },
      {
        id: "databricks-dbu-allocation",
        capability: "databricks",
        title: "Right-size DBU Allocation Across Workspaces",
        description: "Current: 125K DBU/month. Historical: 95-105K. Consider F-SKU commitment tier for 10-15% savings.",
        potentialSavingsUSD: 3800,
        effort: "medium",
        roiMonths: 2,
        actionType: "migration",
        resourceAffected: "databricks-workspace-prod",
        confidence: 0.81,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
];

async function fetchAzureSearchMetrics(tenantId: string): Promise<CapabilityMetrics | null> {
  try {
    const [rows]: any = await pool.query(
      `
      SELECT
        resourceName,
        region,
        resourceGroup,
        skuName,
        replicaCount,
        partitionCount,
        indexCount,
        documentCount,
        storageGB,
        monthlyCostUSD,
        costBreakdown_compute,
        costBreakdown_storage,
        costBreakdown_queries,
        usage_qps,
        usage_latencyMs,
        usage_throttledPercent,
        usage_semanticQueriesDaily,
        utilizationPercent,
        lastAccessedDaysAgo
      FROM AzureSearchSnapshots
      WHERE tenantId = ? AND snapshotDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      `,
      [tenantId]
    );

    if (!rows || rows.length === 0) return null;

    const totalCost = rows.reduce((sum: number, r: any) => sum + parseFloat(r.monthlyCostUSD || 0), 0);
    const computeCost = rows.reduce((sum: number, r: any) => sum + parseFloat(r.costBreakdown_compute || 0), 0);
    const storageCost = rows.reduce((sum: number, r: any) => sum + parseFloat(r.costBreakdown_storage || 0), 0);
    const queryCost = rows.reduce((sum: number, r: any) => sum + parseFloat(r.costBreakdown_queries || 0), 0);

    const avgQps = rows.length > 0 ? rows.reduce((sum: number, r: any) => sum + (r.usage_qps || 0), 0) / rows.length : 0;
    const avgLatency = rows.length > 0 ? rows.reduce((sum: number, r: any) => sum + (r.usage_latencyMs || 0), 0) / rows.length : 0;
    const totalDocuments = rows.reduce((sum: number, r: any) => sum + (r.documentCount || 0), 0);
    const totalStorageGB = rows.reduce((sum: number, r: any) => sum + (r.storageGB || 0), 0);

    const resources = rows.map((r: any) => ({
      name: r.resourceName,
      region: r.region,
      resourceGroup: r.resourceGroup,
      type: "Microsoft.Search/searchServices",
      monthlyCost: parseFloat(r.monthlyCostUSD || 0),
      utilizationPercent: r.utilizationPercent || 0,
      lastAccessedDaysAgo: r.lastAccessedDaysAgo || 0,
    }));

    const recommendations: FinopsRecommendation[] = [];

    // Identify orphaned / underutilized resources
    for (const r of resources) {
      if ((r.utilizationPercent || 0) < 15) {
        recommendations.push({
          id: `search-underutilized-${r.name}`,
          capability: "search",
          title: `Right-size ${r.name} (Low QPS)`,
          description: `${r.name} shows ${r.utilizationPercent || 0}% CPU utilization. Consider reducing replicas or downsizing SKU.`,
          potentialSavingsUSD: r.monthlyCost * 0.25,
          effort: "low",
          roiMonths: 1,
          actionType: "rightsizing",
          resourceAffected: r.name,
          confidence: 0.8,
        });
      }

      if ((r.lastAccessedDaysAgo || 0) > 30) {
        recommendations.push({
          id: `search-orphaned-${r.name}`,
          capability: "search",
          title: `Terminate Orphaned Index: ${r.name}`,
          description: `No queries recorded in the last ${r.lastAccessedDaysAgo} days. Recommended for termination.`,
          potentialSavingsUSD: r.monthlyCost,
          effort: "low",
          roiMonths: 1,
          actionType: "termination",
          resourceAffected: r.name,
          confidence: 0.9,
        });
      }
    }

    return {
      capability: "search",
      name: CAPABILITIES_METADATA.search.name,
      description: CAPABILITIES_METADATA.search.description,
      monthlyCostUSD: totalCost,
      costBreakdown: {
        computeCost,
        storageCost,
        queryTransactionCost: queryCost,
        overheadCost: 0,
      },
      usage: [
        { metric: "Avg Queries/sec", value: parseFloat(avgQps.toFixed(2)), unit: "QPS", costPer: 0.0275 },
        { metric: "Avg Latency", value: parseFloat(avgLatency.toFixed(2)), unit: "ms" },
        { metric: "Total Indexed Docs", value: totalDocuments, unit: "docs" },
        { metric: "Total Storage", value: parseFloat(totalStorageGB.toFixed(2)), unit: "GB", costPer: 0.25 },
      ],
      resources,
      wasteMetrics: {
        orphanedResourceCount: resources.filter((r: any) => (r.lastAccessedDaysAgo || 0) > 30).length,
        underutilizedResourceCount: resources.filter((r: any) => (r.utilizationPercent || 0) < 20).length,
        idleResourceCount: resources.filter((r: any) => (r.utilizationPercent || 0) < 10).length,
        estimatedWasteUSD: resources
          .filter((r: any) => (r.utilizationPercent || 0) < 20)
          .reduce((sum: number, r: any) => sum + r.monthlyCost * 0.3, 0),
      },
      recommendations: recommendations.slice(0, 5),
      lastUpdated: new Date().toISOString(),
      source: "snapshot" as const,
    };
  } catch (err) {
    console.error("Error fetching Azure Search metrics:", err);
    return null;
  }
}

async function fetchRealCapabilities(tenantId: string): Promise<CapabilityMetrics[]> {
  try {
    const searchMetrics = await fetchAzureSearchMetrics(tenantId);
    const results: CapabilityMetrics[] = [];
    if (searchMetrics) results.push(searchMetrics);

    const [rows]: any = await pool.query(
      `
      SELECT
        service_name,
        resource_type,
        region,
        resource_group,
        resource_name,
        SUM(CAST(cost_usd AS DECIMAL(19,2))) as total_cost,
        COUNT(*) as resource_count,
        AVG(CAST(daily_active_hours AS DECIMAL(5,2))) as avg_daily_hours
      FROM CostMeterSnapshots
      WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY service_name, resource_type, region, resource_group, resource_name
      LIMIT 50
      `,
      [tenantId]
    );

    if (!rows || rows.length === 0) return results;

    const classifyCapability = (serviceName: string, resourceType: string): Capability | null => {
      const s = `${serviceName || ""} ${resourceType || ""}`.toLowerCase();
      if (s.includes("foundry") || s.includes("openai")) return "foundry";
      if (s.includes("databricks")) return "databricks";
      if (s.includes("machine learning") || s.includes("azureml")) return "aml";
      if (s.includes("search")) return "search";
      if (s.includes("speech") || s.includes("language")) return "speech-language";
      if (s.includes("vision") || s.includes("video indexer")) return "vision-video";
      if (s.includes("content safety")) return "content-safety";
      if (s.includes("document intelligence") || s.includes("form recognizer")) return "document-intelligence";
      if (s.includes("cognitiveservices")) return "document-intelligence";
      return null;
    };

    const grouped = new Map<Capability, any[]>();
    for (const row of rows) {
      const cap = classifyCapability(row.service_name, row.resource_type);
      if (!cap || cap === "search") continue; // Skip search, already handled above
      if (!grouped.has(cap)) grouped.set(cap, []);
      grouped.get(cap)!.push(row);
    }

    results.push(
      ...Array.from(grouped.entries()).map(([capability, capRows]) => {
        const totalCost = capRows.reduce((sum, r) => sum + parseFloat(r.total_cost || 0), 0);
        const resources = capRows.map((r) => ({
          name: r.resource_name || "unknown",
          region: r.region || "unknown",
          resourceGroup: r.resource_group || "unknown",
          type: r.resource_type || "unknown",
          monthlyCost: parseFloat(r.total_cost || 0),
          utilizationPercent: Math.min(100, Math.max(10, (parseFloat(r.avg_daily_hours || 0) / 24) * 100)),
          lastAccessedDaysAgo: 0,
        }));

        return {
          capability,
          name: CAPABILITIES_METADATA[capability].name,
          description: CAPABILITIES_METADATA[capability].description,
          monthlyCostUSD: totalCost,
          costBreakdown: {
            computeCost: totalCost * 0.58,
            storageCost: totalCost * 0.25,
            queryTransactionCost: totalCost * 0.13,
            overheadCost: totalCost * 0.04,
          },
          usage: [
            { metric: "Resources Detected", value: capRows.length, unit: "count" },
            { metric: "Avg Cost per Resource", value: capRows.length ? parseFloat((totalCost / capRows.length).toFixed(2)) : 0, unit: "$/month" },
          ],
          resources,
          wasteMetrics: {
            orphanedResourceCount: 0,
            underutilizedResourceCount: resources.filter((r) => (r.utilizationPercent || 0) < 20).length,
            idleResourceCount: resources.filter((r) => (r.utilizationPercent || 0) <= 10).length,
            estimatedWasteUSD: resources
              .filter((r) => (r.utilizationPercent || 0) < 20)
              .reduce((sum, r) => sum + r.monthlyCost * 0.3, 0),
          },
          recommendations: [],
          lastUpdated: new Date().toISOString(),
          source: "snapshot" as const,
        };
      })
    );

    return results;
  } catch (err) {
    console.error("Error fetching real capabilities:", err);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    // Demo tenant: return mock data
    if (isMockTenant(tenantId)) {
      const totalCost = MOCK_CAPABILITIES.reduce((sum, c) => sum + c.monthlyCostUSD, 0);
      const totalWaste = MOCK_CAPABILITIES.reduce((sum, c) => sum + c.wasteMetrics.estimatedWasteUSD, 0);
      const totalSavings = MOCK_CAPABILITIES.reduce(
        (sum, c) => sum + c.recommendations.reduce((s, r) => s + r.potentialSavingsUSD, 0),
        0
      );

      return NextResponse.json({
        success: true,
        mock: true,
        capabilities: MOCK_CAPABILITIES,
        totalCostUSD: totalCost,
        totalWasteUSD: totalWaste,
        totalPotentialSavingsUSD: totalSavings,
        financialSummary: {
          mtdCostUSD: totalCost,
          forecastEomUSD: totalCost * 1.08,
          deltaMoMPercent: 3.2,
          wasteRisk: "medium",
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Real tenant: query DB (no mock fallback for productive tenants)
    const realCapabilities = await fetchRealCapabilities(tenantId);
    const data = realCapabilities;

    const totalCost = data.reduce((sum, c) => sum + c.monthlyCostUSD, 0);
    const totalWaste = data.reduce((sum, c) => sum + c.wasteMetrics.estimatedWasteUSD, 0);

    return NextResponse.json({
      success: true,
      mock: false,
      capabilities: data,
      totalCostUSD: totalCost,
      totalWasteUSD: totalWaste,
      totalPotentialSavingsUSD: data.reduce(
        (sum, c) => sum + c.recommendations.reduce((s, r) => s + r.potentialSavingsUSD, 0),
        0
      ),
      financialSummary: {
        mtdCostUSD: totalCost,
        forecastEomUSD: totalCost * 1.1,
        deltaMoMPercent: 2.5,
        wasteRisk: totalCost > 0 && totalWaste / totalCost > 0.08 ? "high" : "medium",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error in Azure AI route:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
