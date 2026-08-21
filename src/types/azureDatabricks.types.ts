export type DatabricksSkuTier = "Standard" | "Premium";

export type DatabricksComputeType = "AllPurpose" | "Job" | "ServerlessSQL";

export type DatabricksClusterState = "Running" | "Terminated" | "Pending";

export interface DatabricksWorkspaceResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuTier: DatabricksSkuTier;
  managedResourceGroupId: string;
  totalDbuConsumed: number;
  dbuCostUSD: number;
  vmComputeCostUSD: number;
  storageCostUSD: number;
  totalMonthlyCostUSD: number;
  allPurposePercentage: number;
  jobsPercentage: number;
  activeClustersCount: number;
  isOrphan: boolean;
}

export interface DatabricksClusterItem {
  clusterId: string;
  clusterName: string;
  workspaceId: string;
  workspaceName?: string;
  resourceGroup?: string;
  subscriptionName?: string;
  computeType: DatabricksComputeType;
  nodeType: string;
  driverNodeType: string;
  minWorkers: number;
  maxWorkers: number;
  autoterminationMinutes: number;
  state: DatabricksClusterState;
  dbuRatePerHour: number;
  monthlyCostUSD: number;
  isInefficient: boolean;
}

export interface DatabricksComponentBreakdown {
  component: string;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface DatabricksSummary {
  totalCostUSD: number;
  totalDbus: number;
  dbuSpendUSD: number;
  azureComputeSpendUSD: number;
  jobsEfficiencyRatio: number;
  potentialSavingsUSD: number;
  breakdownByComponent: DatabricksComponentBreakdown[];
}

export type DatabricksRemediationCategory =
  | "MIGRATE_TO_JOBS"
  | "REDUCE_AUTOTERMINATION"
  | "SINGLE_NODE_DEV"
  | "PURGE_ORPHAN_DISKS";

export interface DatabricksRemediationAction {
  id: string;
  targetId: string;
  title: string;
  description: string;
  category: DatabricksRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface DatabricksDailyPoint {
  date: string;
  dbusConsumed: number;
  costUSD: number;
}

export interface DatabricksPayload {
  summary: DatabricksSummary;
  workspaces: DatabricksWorkspaceResource[];
  clusters: DatabricksClusterItem[];
  dailyTrend: DatabricksDailyPoint[];
  remediationActions: DatabricksRemediationAction[];
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}
