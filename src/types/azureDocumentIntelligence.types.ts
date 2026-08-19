export type DocIntelligenceSku = "F0" | "S0";

export interface DocIntelligenceResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: DocIntelligenceSku;
  totalPagesProcessed: number;
  prebuiltPages: number;
  customPages: number;
  trainingHours: number;
  trainingCostUSD: number;
  inferenceCostUSD: number;
  totalCostUSD: number;
  primaryModelType: string;
  isOrphan: boolean;
  customModelsCount?: number;
  totalCalls?: number;
  successfulCalls?: number;
  clientErrors?: number;
  serverErrors?: number;
  publicNetworkAccess?: boolean;
  privateEndpointCount?: number;
  isDevOrTest?: boolean;
}

export interface DocIntelligenceModelBreakdown {
  modelName: string;
  pagesCount: number;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface DocIntelligenceSummary {
  totalCostUSD: number;
  totalPages: number;
  avgCostPerPageUSD: number;
  prebuiltSharePercentage: number;
  customSharePercentage: number;
  potentialSavingsUSD: number;
  totalTrainingHours?: number;
  totalTrainingCostUSD?: number;
  forecastEomUSD?: number;
  breakdownByModel: DocIntelligenceModelBreakdown[];
}

export type DocIntelligenceRemediationCategory =
  | "MODEL_ARBITRAGE"
  | "COMMITMENT_TIER"
  | "DEV_F0_DOWNGRADE"
  | "ORPHAN_ACCOUNT";

export interface DocIntelligenceRemediationAction {
  id: string;
  resourceId: string;
  title: string;
  description: string;
  category: DocIntelligenceRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface DocIntelligenceDailyPoint {
  date: string;
  pages: number;
  calls: number;
  errors: number;
}

export interface DocIntelligencePayload {
  summary: DocIntelligenceSummary;
  resources: DocIntelligenceResource[];
  remediationActions: DocIntelligenceRemediationAction[];
  dailyProcessing: DocIntelligenceDailyPoint[];
  source: "live" | "snapshot" | "mock";
  computedAt: string;
}