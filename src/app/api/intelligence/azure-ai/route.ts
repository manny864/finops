import { NextRequest, NextResponse } from "next/server";
import Decimal from "decimal.js";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

type Capability = "search" | "document-intelligence" | "speech-language" | "vision-video" | "content-safety" | "aml" | "databricks";

interface CapabilityMetrics {
  capability: Capability;
  name: string;
  description: string;
  monthlyCostUSD: number;
  usage: { metric: string; value: number; unit: string }[];
  resources: Array<{ name: string; region: string; resourceGroup: string; type: string; monthlyCost: number }>;
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
};

const MOCK_CAPABILITIES: CapabilityMetrics[] = [
  {
    capability: "search",
    name: CAPABILITIES_METADATA.search.name,
    description: CAPABILITIES_METADATA.search.description,
    monthlyCostUSD: 12450.5,
    usage: [
      { metric: "Search Queries (daily avg)", value: 45000, unit: "queries/day" },
      { metric: "Indexed Documents", value: 2500000, unit: "docs" },
      { metric: "Storage GB", value: 650, unit: "GB" },
    ],
    resources: [
      {
        name: "search-prod-eastus",
        region: "East US",
        resourceGroup: "prod-search-rg",
        type: "Microsoft.Search/searchServices",
        monthlyCost: 12450.5,
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
    usage: [
      { metric: "Pages Processed", value: 450000, unit: "pages/month" },
      { metric: "Avg Processing Time", value: 850, unit: "ms" },
      { metric: "Success Rate", value: 97.3, unit: "%" },
    ],
    resources: [
      {
        name: "doc-intel-prod",
        region: "East US",
        resourceGroup: "ai-services-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 8920.75,
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
    usage: [
      { metric: "Audio Minutes Processed", value: 125000, unit: "min/month" },
      { metric: "Language Pairs Translated", value: 25, unit: "pairs" },
      { metric: "Sentiment Analyses", value: 320000, unit: "analyses/month" },
    ],
    resources: [
      {
        name: "speech-lang-prod",
        region: "East US",
        resourceGroup: "ai-services-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 7200,
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
    usage: [
      { metric: "Images Analyzed", value: 650000, unit: "images/month" },
      { metric: "Video Minutes Indexed", value: 85000, unit: "min/month" },
      { metric: "Faces Detected", value: 2100000, unit: "faces/month" },
    ],
    resources: [
      {
        name: "vision-prod-eastus",
        region: "East US",
        resourceGroup: "media-ai-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 9150.25,
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
    usage: [
      { metric: "Moderation Requests", value: 850000, unit: "requests/month" },
      { metric: "Avg Latency", value: 125, unit: "ms" },
      { metric: "Blocked Content %", value: 3.2, unit: "%" },
    ],
    resources: [
      {
        name: "content-safety-prod",
        region: "East US",
        resourceGroup: "safety-rg",
        type: "Microsoft.CognitiveServices/accounts",
        monthlyCost: 3240,
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
    usage: [
      { metric: "Active Experiments", value: 32, unit: "count" },
      { metric: "Training Hours", value: 2400, unit: "h/month" },
      { metric: "Inference Endpoints", value: 12, unit: "endpoints" },
    ],
    resources: [
      {
        name: "aml-workspace-prod",
        region: "East US",
        resourceGroup: "ml-ops-rg",
        type: "Microsoft.MachineLearningServices/workspaces",
        monthlyCost: 15800.5,
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
    usage: [
      { metric: "Cluster DBUs", value: 125000, unit: "DBU/month" },
      { metric: "Active Clusters", value: 8, unit: "clusters" },
      { metric: "Jobs Executed", value: 12500, unit: "jobs/month" },
    ],
    resources: [
      {
        name: "databricks-workspace-prod",
        region: "East US",
        resourceGroup: "analytics-rg",
        type: "Microsoft.Databricks/workspaces",
        monthlyCost: 42150.75,
      },
    ],
    lastUpdated: new Date().toISOString(),
    source: "mock",
  },
];

async function fetchRealCapabilities(tenantId: string): Promise<CapabilityMetrics[]> {
  try {
    const [rows]: any = await pool.query(
      `
      SELECT
        'search' as capability,
        region, resource_group, resource_name, type,
        SUM(cost_usd) AS total_cost,
        COUNT(*) as metric_count
      FROM CostMeterSnapshots
      WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND LOWER(service_name) LIKE '%search%'
      GROUP BY region, resource_group, resource_name, type
      LIMIT 10
      `,
      [tenantId]
    );

    if (!rows || rows.length === 0) return [];

    return rows.map((r: any) => ({
      capability: "search" as Capability,
      name: CAPABILITIES_METADATA.search.name,
      description: CAPABILITIES_METADATA.search.description,
      monthlyCostUSD: parseFloat(r.total_cost || 0),
      usage: [
        { metric: "Resources", value: rows.length, unit: "count" },
        { metric: "Avg Cost per Resource", value: parseFloat((r.total_cost / rows.length).toFixed(2)), unit: "$/month" },
      ],
      resources: rows.map((rr: any) => ({
        name: rr.resource_name || "unknown",
        region: rr.region || "unknown",
        resourceGroup: rr.resource_group || "unknown",
        type: rr.type || "unknown",
        monthlyCost: parseFloat(rr.total_cost || 0),
      })),
      lastUpdated: new Date().toISOString(),
      source: "snapshot" as const,
    }));
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
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        mock: true,
        capabilities: MOCK_CAPABILITIES,
        totalCost: MOCK_CAPABILITIES.reduce((sum, c) => sum + c.monthlyCostUSD, 0),
      });
    }

    const realCapabilities = await fetchRealCapabilities(tenantId);

    return NextResponse.json({
      success: true,
      mock: false,
      capabilities: realCapabilities.length > 0 ? realCapabilities : MOCK_CAPABILITIES,
      totalCost: (realCapabilities.length > 0 ? realCapabilities : MOCK_CAPABILITIES).reduce(
        (sum, c) => sum + c.monthlyCostUSD,
        0
      ),
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Azure AI API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
