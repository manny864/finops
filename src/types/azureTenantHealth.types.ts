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
  statusText: string;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  detailsCount?: { current: number; total: number };
  actionRequiredTitle?: string;
  actionType?: string;
  commandPayload?: string;
}

export interface TenantHealthDataPoint {
  date: string;
  overallScore: number;
  grade: HealthGrade;
}

export interface TenantHealthActionPlan {
  id: string;
  title: string;
  pillar: "Budget" | "Credentials" | "COIN" | "Security";
  healthPointsGain: number;
  estimatedSavingsUSD: number;
  priority: "HIGH" | "MEDIUM";
  actionType: string;
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

export const GRADE_THRESHOLDS: Array<{ min: number; grade: HealthGrade; label: string }> = [
  { min: 90, grade: "A", label: "Grado A — Excelente" },
  { min: 80, grade: "B", label: "Grado B — Bueno" },
  { min: 70, grade: "C", label: "Grado C — Aceptable" },
  { min: 50, grade: "D", label: "Grado D — Requiere Atención" },
  { min: 0, grade: "F", label: "Grado F — Crítico" },
];
