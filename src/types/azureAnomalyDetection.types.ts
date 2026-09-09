/**
 * TypeScript Contracts for FinOps Anomaly Detection
 * Statistical Z-Score, 3-Sigma Confidence Bands, Root Cause Attribution & Lifecycle Management
 */

export type AnomalyState = "OPEN" | "SNOOZED" | "DISMISSED" | "RESOLVED";

export type AnomalySeverity = "CRITICAL" | "HIGH" | "MEDIUM";

export interface AnomalyRootCauseItem {
  serviceName: string;
  resourceGroup: string;
  resourceId?: string;
  contributionPercentage: number;
  deltaSpendUSD: number;
}

export interface CostAnomalyItem {
  id: string;
  detectionDate: string;
  actualCostUSD: number;
  expectedCostUSD: number;
  deltaUSD: number;
  zScore: number;
  severity: AnomalySeverity;
  state: AnomalyState;
  /**
   * El titulo era siempre "Pico de Costo en <servicio>", asi que del servidor
   * viaja solo el servicio dominante y la frase sale de `anomalyTitle`.
   * `DESCONOCIDO` es el centinela de la rama sin causa raiz identificada.
   */
  titleService: string;
  rootCauses: AnomalyRootCauseItem[];
  snoozedUntilDate?: string;
  resolutionNotes?: string;
  resolvedAtDate?: string;
  resolvedBy?: string;
}

export interface AnomalyConfidenceDataPoint {
  date: string;
  actualCostUSD: number;
  expectedCostUSD: number;
  upperLimit3SigmaUSD: number;
  isAnomaly: boolean;
  zScore?: number;
}

export interface AnomalyDetectionSummary {
  openAnomaliesCount: number;
  unresolvedImpactUSD: number;
  completedCount: number;
  meanTimeToResolutionHours?: number;
  baselineMovingAvgUSD: number;
  zScoreToleranceUSD: number;
  alertThresholdUSD: number;
  confidenceTrend: AnomalyConfidenceDataPoint[];
  anomalies: CostAnomalyItem[];
}

export interface AnomalyRemediationAction {
  id: string;
  anomalyId: string;
  actionType: "RESOLVE" | "SNOOZE" | "DISMISS" | "ADJUST_LIMIT" | "CREATE_ALERT";
  snoozeDays?: number;
  notes?: string;
  commandPayload?: string;
}

export interface AnomalyPayload {
  summary: AnomalyDetectionSummary;
  source: "live" | "mock";
  lastUpdated: string;
}

export const ANOMALY_STATUS_LABELS: Record<AnomalyState, string> = {
  OPEN: "Abierta",
  SNOOZED: "Pospuesta",
  DISMISSED: "Descartada",
  RESOLVED: "Completada",
};
