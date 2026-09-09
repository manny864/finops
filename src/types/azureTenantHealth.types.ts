/**
 * TypeScript Contracts for FinOps Tenant Health & Governance
 * Composite Health Scoring, COIN Optimization Index, Budget Compliance & Privileged Security Posture
 */

export type HealthSignalType =
  | "BUDGET_COMPLIANCE"
  | "CREDENTIAL_EXPIRY"
  | "COIN_OPTIMIZATION"
  | "SECURITY_MFA";

export type HealthGrade = "A" | "B" | "C" | "D" | "F";

export interface HealthSignalItem {
  signalType: HealthSignalType;
  displayName: string;
  score: number;
  weightPercentage: number;
  weightedScore: number;
  /** Clave del resumen (`status_*`) y sus valores; la prosa vive en el catalogo. */
  statusKey: TenantHealthStatusKey;
  statusParams?: Record<string, string | number>;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  detailsCount?: { current: number; total: number };
  /**
   * El rotulo del boton salia del servidor, pero era derivable de `actionType`
   * ("Crear Presupuesto" <-> SET_BUDGET): campo redundante, no traducible.
   * Queda solo el hecho de que hace falta accion.
   */
  actionRequired?: boolean;
  actionType?: TenantHealthActionType;
  commandPayload?: string;
}

export interface TenantHealthDataPoint {
  date: string;
  overallScore: number;
  grade: HealthGrade;
}

export const TENANT_HEALTH_STATUS_KEYS = [
  "status_BUDGET_none",
  "status_BUDGET_ok",
  "status_BUDGET_over",
  "status_CRED_none",
  "status_CRED_expiring",
  "status_COIN_none",
  "status_COIN_progress",
  "status_MFA_none",
  "status_MFA_active",
] as const;

export type TenantHealthStatusKey = (typeof TENANT_HEALTH_STATUS_KEYS)[number];

export const TENANT_HEALTH_ACTION_TYPES = [
  "ENABLE_MFA",
  "PURGE_ZOMBIES",
  "SET_BUDGET",
  "ROTATE_SECRETS",
  "ENFORCE_MFA",
  "VIEW_ADVISOR",
] as const;

export type TenantHealthActionType = (typeof TENANT_HEALTH_ACTION_TYPES)[number];

export interface TenantHealthActionPlan {
  id: string;
  pillar: "Budget" | "Credentials" | "COIN" | "Security";
  healthPointsGain: number;
  estimatedSavingsUSD: number;
  priority: "HIGH" | "MEDIUM";
  /** Discrimina la accion y da la clave `plan_<actionType>` del rotulo. */
  actionType: TenantHealthActionType;
  commandPayload?: string;
}

export interface TenantHealthSummary {
  overallScore: number;
  grade: HealthGrade;
  signals: HealthSignalItem[];
  historicalTrend: TenantHealthDataPoint[];
  actionPlan: TenantHealthActionPlan[];
}

export interface TenantHealthPayload {
  summary: TenantHealthSummary;
  source: "live" | "mock";
  lastUpdated: string;
}

export const SIGNAL_WEIGHTS: Record<HealthSignalType, number> = {
  BUDGET_COMPLIANCE: 30,
  CREDENTIAL_EXPIRY: 25,
  COIN_OPTIMIZATION: 25,
  SECURITY_MFA: 20,
};

/**
 * El `label` repetia el grado y el unico consumidor lo partia por el guion
 * para quedarse con el calificativo: se fue, y el calificativo vive en
 * `grade_<G>` del catalogo.
 */
export const GRADE_THRESHOLDS: Array<{ min: number; grade: HealthGrade }> = [
  { min: 90, grade: "A" },
  { min: 80, grade: "B" },
  { min: 70, grade: "C" },
  { min: 50, grade: "D" },
  { min: 0, grade: "F" },
];
