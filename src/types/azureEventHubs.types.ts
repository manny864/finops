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

// SKU_DOWNGRADE cubria tres recomendaciones distintas (Dedicated -> Premium,
// rightsizing de PUs y Premium -> Standard), asi que no servia para derivar el
// texto de ninguna. El comparador de SKUs del tablero sigue cubriendo las tres
// via EH_MUESTRA_SKUS.
export const EVENT_HUBS_REMEDIATION_CATEGORIES = [
  "DEDICATED_TO_PREMIUM",
  "RIGHTSIZE_PUS",
  "PREMIUM_TO_STANDARD",
  "AUTO_INFLATE_OPTIMIZE",
  "ORPHAN_PURGE",
] as const;

export type EventHubsRemediationCategory = (typeof EVENT_HUBS_REMEDIATION_CATEGORIES)[number];

/** Las tres que salieron de partir SKU_DOWNGRADE: comparten comando y comparador. */
export const EH_SKU_CATEGORIES = new Set<EventHubsRemediationCategory>([
  "DEDICATED_TO_PREMIUM",
  "RIGHTSIZE_PUS",
  "PREMIUM_TO_STANDARD",
]);

export interface EventHubsRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  /** Valores a interpolar en `rem_EH_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  category: EventHubsRemediationCategory;
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
