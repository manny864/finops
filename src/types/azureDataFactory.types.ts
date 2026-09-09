export const DATA_FACTORY_REMEDIATION_CATEGORIES = [
  "IR_DOWNGRADE",
  "DATA_FLOW_CACHE_ENABLE",
  "ORPHAN_PURGE",
] as const;

export type DataFactoryRemediationCategory = (typeof DATA_FACTORY_REMEDIATION_CATEGORIES)[number];

export interface AdfResourceItem {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  avgIRUtilizationPercentage: number;
  totalPipelineRuns: number;
  successfulPipelineRuns?: number;
  failedPipelineRuns?: number;
  avgPipelineDurationMinutes: number;
  costMtdUSD: number;
  costPreviousPeriodUSD: number;
  forecastEomUSD: number;
  integrationRuntimesCount: number;
  managedIRCount?: number;
  selfHostedIRCount?: number;
  ssisIRCount?: number;
  publicNetworkAccess?: boolean;
  isOrphan: boolean;
}

export interface AdfSummaryMetrics {
  costMtdUSD: number;
  totalDataFactories: number;
  totalPipelineRunsMTD: number;
  totalIntegrationRuntimes: number;
  potentialSavingsUSD: number;
}

export interface AdfRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  /** Valores a interpolar en `rem_ADF_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  category: DataFactoryRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentCores?: number;
  recommendedCores?: number;
}

export interface AdfCostDistributionItem {
  category: string;
  count: number;
  costUSD: number;
  color: string;
}

export interface AdfTrendDataPoint {
  date: string;
  successfulRuns: number;
  failedRuns: number;
  costUSD: number;
}

export interface AdfPayload {
  summary: AdfSummaryMetrics;
  items: AdfResourceItem[];
  remediationActions: AdfRemediationAction[];
  costDistribution: AdfCostDistributionItem[];
  trendHistory: AdfTrendDataPoint[];
  source?: "live" | "mock";
  lastUpdated?: string;
}
