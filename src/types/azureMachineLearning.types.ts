export type AmlComputeType =
  | "ComputeInstance"
  | "AmlComputeCluster"
  | "OnlineEndpoint"
  | "Serverless";

export type AmlComputeState = "Running" | "Stopped" | "Scaling" | "Idle";

export interface AmlComputeResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  computeType: AmlComputeType;
  vmSize: string;
  state: AmlComputeState;
  minNodes: number;
  maxNodes: number;
  currentNodes: number;
  hasAutoShutdownSchedule: boolean;
  autoShutdownTime?: string;
  avgCpuPercentage: number;
  avgGpuPercentage?: number;
  monthlyCostUSD: number;
  isWasteful: boolean;
}

export interface AmlComputeTypeBreakdown {
  type: string;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface AmlSummaryMetrics {
  totalMonthlyCostUSD: number;
  computeInstancesCount: number;
  activeTrainingClustersCount: number;
  onlineEndpointsCount: number;
  idleNodesCount: number;
  potentialSavingsUSD: number;
  breakdownByComputeType: AmlComputeTypeBreakdown[];
}

export const AML_REMEDIATION_CATEGORIES = [
  "AUTO_SHUTDOWN_CI",
  "SCALE_TO_ZERO_CLUSTER",
  "SPOT_TRAINING",
  "IDLE_ENDPOINT",
] as const;

export type AmlRemediationCategory =
  (typeof AML_REMEDIATION_CATEGORIES)[number];

export interface AmlRemediationAction {
  id: string;
  resourceId: string;
  params?: Record<string, string | number>;
  category: AmlRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface AmlDailyPoint {
  date: string;
  computeHours: number;
  avgCpuPercent: number;
  activeNodes: number;
}

export interface AmlPayload {
  summary: AmlSummaryMetrics;
  resources: AmlComputeResource[];
  dailyTrend: AmlDailyPoint[];
  remediationActions: AmlRemediationAction[];
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}
