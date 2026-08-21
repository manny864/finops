export type ApimSkuName = "Developer" | "Basic" | "Standard" | "Premium";

export interface ApimResourceItem {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: ApimSkuName;
  skuCapacity: number;
  avgCapacityPercentage: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  costMtdUSD: number;
  costPreviousPeriodUSD: number;
  forecastEomUSD: number;
  isDevOrTest: boolean;
  gatewayThroughputMbps?: number;
  publisherEmail?: string;
}

export interface ApimSummaryMetrics {
  costMtdUSD: number;
  totalInstances: number;
  totalUnits: number;
  totalRequestsMTD: number;
  nonProdSpendPercentage: number;
  potentialSavingsUSD: number;
}

export interface ApimRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  title: string;
  description: string;
  category: "DEV_SKU_DOWNGRADE" | "UNITS_RIGHTSIZING" | "CACHE_ENABLE";
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentSku?: ApimSkuName;
  recommendedSku?: ApimSkuName;
  currentCapacity?: number;
  recommendedCapacity?: number;
}

export interface ApimSkuDistributionItem {
  sku: string;
  count: number;
  costUSD: number;
  color: string;
}

export interface ApimTrendDataPoint {
  date: string;
  requests: number;
  latencyMs: number;
  costUSD: number;
}

export interface ApimPayload {
  summary: ApimSummaryMetrics;
  items: ApimResourceItem[];
  remediationActions: ApimRemediationAction[];
  skuDistribution: ApimSkuDistributionItem[];
  trendHistory: ApimTrendDataPoint[];
  source?: "live" | "mock";
  lastUpdated?: string;
}
