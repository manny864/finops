// -----------------------------------------------------------------------
// Microsoft Fabric Analytics & FinOps — Type Definitions
// Capacity (F-SKU), Workspaces/Artefacts, OneLake Storage, Recommendations
// -----------------------------------------------------------------------

export type FabricCapacitySku =
  | "F2"
  | "F4"
  | "F8"
  | "F16"
  | "F32"
  | "F64"
  | "F128"
  | "F256"
  | "F512"
  | "F1024"
  | "F2048";

export type FabricCapacityState = "Active" | "Paused" | "Provisioning" | "Scaling";

export interface FabricCapacityDetail {
  id: string;
  name: string;
  sku: FabricCapacitySku;
  state: FabricCapacityState;
  region: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  capacityUnits: number; // e.g. F64 = 64 CUs
  adminMembers: string[];
  monthlyCostUsd: number;
  computeCostUsd: number;
  storageCostUsd: number;
  interactiveUtilPercent: number; // 10 min smoothing
  backgroundUtilPercent: number; // 24h smoothing
  peakDayUtilPercent: number;
  throttlingRisk: "low" | "medium" | "high";
  isDevOrTest: boolean;
}

export type FabricArtifactType =
  | "Lakehouse"
  | "Warehouse"
  | "DataPipeline"
  | "Notebook"
  | "SemanticModel"
  | "KqlDatabase";

export interface FabricArtifactItem {
  id: string;
  name: string;
  type: FabricArtifactType;
  workspace: string;
  capacitySku: string;
  cuConsumptionPercent: number;
  cuSecondsConsumed: number;
  storageGb: number;
  lastModified: string;
  owner: string;
  monthlyCostUsd: number;
}

export interface DeltaTableFragmentationItem {
  table: string;
  workspace: string;
  sizeGb: number;
  smallFilesCount: number;
  unpurgedHistoricalVersions: number;
  estimatedSavingsUsd: number;
}

export interface OneLakeStorageBreakdown {
  totalStorageGb: number;
  deltaTablesGb: number;
  shortcutsGb: number;
  duplicateDataGb: number;
  recommendedLifecycleGb: number;
  potentialSavingsUsd: number;
  deltaFragmentationItems: DeltaTableFragmentationItem[];
}

export type FabricRemediationRuleKey =
  | "auto_pause_dev"
  | "reservation_1y"
  | "onelake_shortcuts"
  | "delta_vacuum_optimize";

export interface FabricRemediationAction {
  id: string;
  ruleKey: FabricRemediationRuleKey;
  title: string;
  description: string;
  savingsMonthlyUsd: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
  cliCommand?: string;
  bicepSnippet?: string;
  scriptSnippet?: string;
}

export interface FabricFinopsSummaryResponse {
  success: boolean;
  mock: boolean;
  capacities: FabricCapacityDetail[];
  artefacts: FabricArtifactItem[];
  onelake: OneLakeStorageBreakdown;
  recommendations: FabricRemediationAction[];
  financialSummary: {
    totalSKUCostUSD: number;
    totalComputeCUHoursUSD: number;
    totalStorageUSD: number;
    forecastEomUSD: number;
    potentialSavingsUSD: number;
    deltaMoM: {
      value: number;
      percentage: number;
    };
    burstingDetected: boolean;
    throttlingRiskLevel: "low" | "medium" | "high";
  };
  efficiency: {
    totalCUs: number;
    activeCapacitiesCount: number;
    pausedCapacitiesCount: number;
    costPerCuHour: number;
    underutilizedArtefactsCount: number;
    duplicateStorageGb: number;
  };
  risk: {
    healthScore: number;
    criticalAlerts: number;
    throttlingRiskCapacitiesCount: number;
    highBurstingArtefactsCount: number;
  };
  timestamp: string;
  isDemoMode: boolean;
}
