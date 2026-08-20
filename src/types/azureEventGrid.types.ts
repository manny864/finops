export type EventGridSkuName = "Basic" | "Premium";

export interface EventGridResourceItem {
  id: string;
  name: string;
  resourceType: "Domain" | "Topic";
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: EventGridSkuName;
  publishedEvents: number;
  deliveredEvents: number;
  failedEvents?: number;
  throughputOpsSec?: number;
  avgLatencyMs?: number;
  costMtdUSD: number;
  costPreviousPeriodUSD: number;
  forecastEomUSD: number;
  topicsCount: number;
  isOrphan: boolean;
  publicNetworkAccess?: string;
}

export interface EventGridSummaryMetrics {
  costMtdUSD: number;
  totalDomains: number;
  totalTopics: number;
  totalEventsMTD: number;
  potentialSavingsUSD: number;
}

export interface EventGridRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  title: string;
  description: string;
  category: "SKU_DOWNGRADE" | "ORPHAN_PURGE";
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentSku?: EventGridSkuName;
  recommendedSku?: EventGridSkuName;
}

export interface EventGridSkuDistributionItem {
  sku: string;
  count: number;
  costUSD: number;
  color: string;
}

export interface EventGridTrendDataPoint {
  date: string;
  publishedEvents: number;
  deliveredEvents: number;
  costUSD: number;
}

export interface EventGridPayload {
  summary: EventGridSummaryMetrics;
  items: EventGridResourceItem[];
  remediationActions: EventGridRemediationAction[];
  skuDistribution: EventGridSkuDistributionItem[];
  trendHistory: EventGridTrendDataPoint[];
  source?: "live" | "mock";
  lastUpdated?: string;
}
