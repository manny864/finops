export type EventHubsSkuName = "Basic" | "Standard" | "Premium" | "Dedicated";

export interface EventHubsResourceItem {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: EventHubsSkuName;
  skuCapacity: number; // Throughput Units (TU) for Standard/Basic, Processing Units (PU) for Premium, Capacity Units (CU) for Dedicated
  avgCapacityPercentage: number;
  totalIngressBytes: number; // Bytes
  totalEgressBytes: number; // Bytes
  costMtdUSD: number;
  costPreviousPeriodUSD: number;
  forecastEomUSD: number;
  eventHubsCount: number;
  autoInflateEnabled: boolean;
  maximumThroughputUnits?: number;
  isOrphan: boolean;
  zoneRedundant?: boolean;
  throttledRequests?: number;
  avgLatencyMs?: number;
}

export interface EventHubsSummaryMetrics {
  costMtdUSD: number;
  totalNamespaces: number;
  totalIngressMTD: number; // Bytes
  totalEventHubs: number;
  potentialSavingsUSD: number;
}

export interface EventHubsRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  title: string;
  description: string;
  category: "SKU_DOWNGRADE" | "AUTO_INFLATE_OPTIMIZE" | "ORPHAN_PURGE";
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentSku?: EventHubsSkuName;
  recommendedSku?: EventHubsSkuName;
  currentCapacity?: number;
  recommendedCapacity?: number;
}

export interface EventHubsSkuDistributionItem {
  sku: string;
  count: number;
  costUSD: number;
  color: string;
}

export interface EventHubsTrendDataPoint {
  date: string;
  ingressMB: number;
  egressMB: number;
  costUSD: number;
}

export interface EventHubsPayload {
  summary: EventHubsSummaryMetrics;
  items: EventHubsResourceItem[];
  remediationActions: EventHubsRemediationAction[];
  skuDistribution: EventHubsSkuDistributionItem[];
  trendHistory: EventHubsTrendDataPoint[];
  source?: "live" | "mock";
  lastUpdated?: string;
}
