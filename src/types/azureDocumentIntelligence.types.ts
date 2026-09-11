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

export const DOC_INTELLIGENCE_REMEDIATION_CATEGORIES = [
  "MODEL_ARBITRAGE",
  "COMMITMENT_TIER",
  "DEV_F0_DOWNGRADE",
  "ORPHAN_ACCOUNT",
] as const;

export type DocIntelligenceRemediationCategory =
  (typeof DOC_INTELLIGENCE_REMEDIATION_CATEGORIES)[number];

export interface DocIntelligenceRemediationAction {
  id: string;
  resourceId: string;
  /**
   * Texto de respaldo en castellano. La UI muestra
   * `rem_DOC_<category>_title`/`_desc` del catalogo: la respuesta se cachea con
   * una clave que no incluye el locale, asi que armar la frase en el servidor le
   * daria al segundo lector el idioma del primero.
   */
  title: string;
  description: string;
  category: DocIntelligenceRemediationCategory;
  /** Valores a interpolar en las claves. Numeros y nombres, nunca frases. */
  params?: Record<string, string | number>;
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