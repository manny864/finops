export type ServiceBusSkuName = "Basic" | "Standard" | "Premium";

export interface ServiceBusNamespaceResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: ServiceBusSkuName;
  skuCapacity: number;
  avgCapacityPercentage: number;
  totalMessages: number;
  totalMessagingSize: number; // in bytes or MB
  costMtdUSD: number;
  costPreviousPeriodUSD: number;
  forecastEomUSD: number;
  queuesCount: number;
  topicsCount: number;
  isOrphan: boolean;
  zoneRedundant?: boolean;
  incomingMessages?: number;
  outgoingMessages?: number;
  avgLatencyMs?: number;
}

export interface ServiceBusSummaryMetrics {
  costMtdUSD: number;
  totalNamespaces: number;
  totalMessagesMTD: number;
  totalQueues: number;
  totalTopics: number;
  potentialSavingsUSD: number;
}

// SKU_DOWNGRADE cubria el rightsizing de Messaging Units y la migracion de
// Premium a Standard: el tablero ya tenia que mirar `actionType` para
// distinguirlas, senal de que la categoria no alcanzaba.
export const SERVICE_BUS_REMEDIATION_CATEGORIES = [
  "RIGHTSIZE_MUS",
  "PREMIUM_TO_STANDARD",
  "ORPHAN_PURGE",
  "RETENTION_OPTIMIZE",
] as const;

export type ServiceBusRemediationCategory = (typeof SERVICE_BUS_REMEDIATION_CATEGORIES)[number];

export interface ServiceBusRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  /** Valores a interpolar en `rem_SB_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  category: ServiceBusRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentSku?: ServiceBusSkuName;
  recommendedSku?: ServiceBusSkuName;
  currentCapacity?: number;
  recommendedCapacity?: number;
}

export interface ServiceBusSkuDistributionItem {
  sku: string;
  count: number;
  costUSD: number;
  color: string;
}

export interface ServiceBusTrendDataPoint {
  date: string;
  incomingMessages: number;
  outgoingMessages: number;
  costUSD: number;
}

export interface ServiceBusPayload {
  summary: ServiceBusSummaryMetrics;
  items: ServiceBusNamespaceResource[];
  remediationActions: ServiceBusRemediationAction[];
  skuDistribution: ServiceBusSkuDistributionItem[];
  trendHistory: ServiceBusTrendDataPoint[];
  source?: "live" | "mock";
  lastUpdated?: string;
}
