export type ContentSafetySku = "F0" | "S0";

export interface ContentSafetyResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  skuName: ContentSafetySku;
  textRecordsCount: number;
  imagesAnalyzedCount: number;
  blocklistMatchesCount: number;
  blockedItemsCount: number;
  totalCostUSD: number;
  isDevOrTest: boolean;
  isOrphan: boolean;
}

export interface ContentSafetyModalityBreakdown {
  modality: string;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface ContentSafetySummary {
  totalCostUSD: number;
  totalTextRecords: number;
  totalImagesAnalyzed: number;
  totalBlockedItems: number;
  blockRatePercentage: number;
  potentialSavingsUSD: number;
  breakdownByModality: ContentSafetyModalityBreakdown[];
}

export type ContentSafetyRemediationCategory =
  | "HASH_CACHING"
  | "DEV_F0_DOWNGRADE"
  | "BLOCKLIST_OPTIMIZATION";

export interface ContentSafetyRemediationAction {
  id: string;
  resourceId: string;
  title: string;
  description: string;
  category: ContentSafetyRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface ContentSafetyDailyPoint {
  date: string;
  textAnalyzedK: number;
  imagesAnalyzedK: number;
  blockedCount: number;
}

export interface ContentSafetyPayload {
  summary: ContentSafetySummary;
  resources: ContentSafetyResource[];
  dailyTrend: ContentSafetyDailyPoint[];
  remediationActions: ContentSafetyRemediationAction[];
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}
