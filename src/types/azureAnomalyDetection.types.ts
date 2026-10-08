/**
 * TypeScript Contracts for FinOps Anomaly Detection
 * Statistical Z-Score, 3-Sigma Confidence Bands, Root Cause Attribution & Lifecycle Management
 */

import type { RootCauseFact } from "@/types/anomalyRootCause.types";

/**
 * El vocabulario de `Anomalies.status` (MEJ-33), que la pantalla usa tal cual.
 * La pantalla tenía otro (`Open`/`Postponed`/`Dismissed`/`Completed`) que la
 * columna ENUM rechazaba: el triaje se veía en pantalla y no se guardaba nunca.
 */
export const ANOMALY_STATES = ["New", "Investigating", "Resolved", "False Positive"] as const;
export type AnomalyState = (typeof ANOMALY_STATES)[number];

/** Abierta = nadie la cerró todavía, la haya tomado alguien o no. */
export const isOpenAnomalyState = (s: AnomalyState) => s === "New" || s === "Investigating";

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
  /** Detalle por medidor de `Anomalies.root_cause_facts`; lo único que puede citar la IA. */
  rootCauseFacts?: RootCauseFact[];
  /** `Anomalies.assigned_to`: el responsable que derivó la gobernanza del cliente (MEJ-33). */
  assignedTo?: string;
  /** Por dónde se lo encontró: el Cost Group o la etiqueta Owner del RG. */
  assignedDetail?: string;
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
