export type VisionVideoKind =
  | "ComputerVision"
  | "Face"
  | "VideoIndexer"
  | "CustomVision.Training"
  | "CustomVision.Prediction"
  | "AIServices";

export type VisionVideoSku = "F0" | "S0" | "S1";

export interface VisionVideoResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  kind: VisionVideoKind;
  skuName: VisionVideoSku;
  imagesAnalyzed: number;
  videoMinutesProcessed: number;
  faceCallsCount: number;
  trainingHours: number;
  totalCostUSD: number;
  isDevOrTest: boolean;
  isOrphan: boolean;
}

export interface VisionVideoServiceBreakdown {
  serviceName: string;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface VisionVideoSummary {
  totalCostUSD: number;
  totalImages: number;
  totalVideoMinutes: number;
  totalFaceCalls: number;
  potentialSavingsUSD: number;
  breakdownByService: VisionVideoServiceBreakdown[];
}

export type VisionRemediationCategory =
  | "DEV_F0_DOWNGRADE"
  | "VIDEO_PRESET_OPTIMIZE"
  | "BATCH_PROCESSING"
  | "ORPHAN_ACCOUNT";

export interface VisionVideoRemediationAction {
  id: string;
  resourceId: string;
  title: string;
  description: string;
  category: VisionRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface VisionVideoDailyPoint {
  date: string;
  imagesK: number;
  videoMinutes: number;
  faceCallsK: number;
}

export interface VisionVideoPayload {
  summary: VisionVideoSummary;
  resources: VisionVideoResource[];
  dailyTrend: VisionVideoDailyPoint[];
  remediationActions: VisionVideoRemediationAction[];
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}
