/**
 * Azure FinOps Tenant Health Service
 * Composite Health Scoring, Cloud Optimization Index (COIN), Budget Governance & MFA Security Posture
 *
 * RBAC mínimo: `Reader` + `Cost Management Reader`.
 * Tolerancia cero a mocks en tenants reales: si faltan datos o la BD está vacía, devuelve estado real / vacío legítimo.
 */

import { Decimal } from "decimal.js";
import {
  SIGNAL_WEIGHTS,
  type HealthGrade,
  type HealthSignalItem,
  type TenantHealthActionPlan,
  type TenantHealthDataPoint,
  type TenantHealthPayload,
  type TenantHealthSummary,
  type TenantHealthStatusKey,
} from "@/types/azureTenantHealth.types";

export function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

/**
 * Señal 1: Cumplimiento de Presupuesto (Peso: 30%)
 * - Sin presupuesto -> Score: 70/100 (Penalización por falta de control)
 * - Con presupuesto y gasto <= 100% -> Score: 100/100
 * - Exceso de presupuesto -> max(0, 100 - (% Exceso * 2))
 */
export function calcBudgetComplianceScore(input: {
  budgetUSD: number | null;
  currentSpendUSD: number;
  projectedSpendUSD?: number;
}): {
  score: number;
  statusKey: TenantHealthStatusKey;
  statusParams?: Record<string, string | number>;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  const { budgetUSD, currentSpendUSD, projectedSpendUSD } = input;

  if (budgetUSD === null || budgetUSD <= 0) {
    return {
      score: 70,
      statusKey: "status_BUDGET_none" as const,
      statusLevel: "WARNING",
      commandPayload: `#{cmt_th_crear_presupuesto_en_azure_consumption_para}\naz consumption budget create --budget-name "budget-tenant-monthly" \\\n  --amount ${Math.max(500, Math.ceil(currentSpendUSD * 1.1))} --time-grain Monthly \\\n  --start-date "$(date +%Y-%m-01)" --end-date "2030-12-31"`,
    };
  }

  const spendToEvaluate = projectedSpendUSD !== undefined ? projectedSpendUSD : currentSpendUSD;
  const burnPct = new Decimal(spendToEvaluate).div(budgetUSD).times(100).toNumber();

  if (burnPct <= 100) {
    return {
      score: 100,
      statusKey: "status_BUDGET_ok" as const,
      statusParams: { budget: budgetUSD.toFixed(2), pct: burnPct.toFixed(1) },
      statusLevel: "OPTIMAL",
    };
  }

  const excessPct = burnPct - 100;
  const rawScore = Math.max(0, 100 - excessPct * 2);
  const score = Number(rawScore.toFixed(0));

  return {
    score,
    statusKey: "status_BUDGET_over" as const,
    statusParams: {
      pct: excessPct.toFixed(1),
      spend: spendToEvaluate.toFixed(2),
      budget: budgetUSD.toFixed(2),
    },
    statusLevel: score < 50 ? "CRITICAL" : "WARNING",
    commandPayload: `#{cmt_th_ajustar_o_crear_alertas_tempranas_de}\naz consumption budget create --budget-name "budget-tenant-alert" \\\n  --amount ${budgetUSD} --time-grain Monthly`,
  };
}

/**
 * Señal 2: Credenciales por Expirar (Peso: 25%)
 * - 0 credenciales vencen en <= 30 días -> Score: 100/100
 * - -20 puntos por cada credencial vencida / próxima a vencer
 */
export function calcCredentialExpiryScore(expiringCount: number): {
  score: number;
  statusKey: TenantHealthStatusKey;
  statusParams?: Record<string, string | number>;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  if (expiringCount <= 0) {
    return {
      score: 100,
      statusKey: "status_CRED_none" as const,
      statusParams: { days: 30 },
      statusLevel: "OPTIMAL",
    };
  }

  const penalty = expiringCount * 20;
  const score = Math.max(0, 100 - penalty);

  return {
    score,
    statusKey: "status_CRED_expiring" as const,
    statusParams: { count: expiringCount, days: 30 },
    statusLevel: score < 50 ? "CRITICAL" : "WARNING",
    commandPayload: `#{cmt_th_listar_credenciales_y_certificados_proximos_a}\naz ad app credential list --id <appId>`,
  };
}

/**
 * Señal 3: Índice de Optimización COIN (Peso: 25%)
 * Score = (Recomendaciones Implementadas / Total Activas) * 100
 */
export function calcCoinOptimizationScore(
  implemented: number,
  totalActive: number
): {
  score: number;
  statusKey: TenantHealthStatusKey;
  statusParams?: Record<string, string | number>;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  if (totalActive <= 0) {
    return {
      score: 100,
      statusKey: "status_COIN_none" as const,
      statusLevel: "OPTIMAL",
    };
  }

  const pct = new Decimal(implemented).div(totalActive).times(100).toNumber();
  const score = Number(Math.min(100, Math.max(0, pct)).toFixed(0));

  return {
    score,
    statusKey: "status_COIN_progress" as const,
    statusParams: { implemented, total: totalActive, days: 90 },
    statusLevel: score >= 80 ? "OPTIMAL" : score >= 50 ? "WARNING" : "CRITICAL",
    commandPayload: `#{cmt_th_consultar_recomendaciones_de_optimizacion_de_azure}\naz advisor recommendation list --category Cost`,
  };
}

/**
 * Señal 4: Postura de Seguridad MFA en Roles Privilegiados (Peso: 20%)
 * Score = (Admins con MFA / Total Admins) * 100
 */
export function calcMfaSecurityScore(
  adminsWithMfa: number,
  totalAdmins: number
): {
  score: number;
  statusKey: TenantHealthStatusKey;
  statusParams?: Record<string, string | number>;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  if (totalAdmins <= 0) {
    return {
      score: 100,
      statusKey: "status_MFA_none" as const,
      statusLevel: "OPTIMAL",
    };
  }

  const pct = new Decimal(adminsWithMfa).div(totalAdmins).times(100).toNumber();
  const score = Number(Math.min(100, Math.max(0, pct)).toFixed(0));

  return {
    score,
    statusKey: "status_MFA_active" as const,
    statusParams: { current: adminsWithMfa, total: totalAdmins },
    statusLevel: score === 100 ? "OPTIMAL" : score >= 50 ? "WARNING" : "CRITICAL",
    /**
     * Este payload eran DOS lineas de comentario y ningun comando: el usuario
     * abria el modal, veia texto y no tenia nada que copiar. Se le agrega el
     * diagnostico --quienes son los admins y cual es el estado de las politicas
     * de acceso condicional-- que es lo que se puede hacer por CLI. La politica
     * en si se crea con el POST de `act-mfa-01`, que ya existe mas abajo.
     */
    commandPayload: `#{cmt_th_requerir_mfa_mediante_directiva_de_acceso}\n#{cmt_th_portal_entra_id_security_conditional_access}\n\n#{cmt_th_admins_sin_mfa_diag}\naz ad directory-role member list --role "Global Administrator" --query "[].{nombre:displayName, upn:userPrincipalName}" -o table\n\n#{cmt_th_politicas_ca_diag}\naz rest --method GET --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" --query "value[].{nombre:displayName, estado:state}" -o table`,
  };
}

/**
 * Genera el plan de acción priorizado para alcanzar Grado A (90+)
 */
export function generateTenantHealthActionPlan(signals: HealthSignalItem[], isMock = false): TenantHealthActionPlan[] {
  const plan: TenantHealthActionPlan[] = [];

  const mfaSignal = signals.find((s) => s.signalType === "SECURITY_MFA");
  if (mfaSignal && mfaSignal.score < 100) {
    plan.push({
      id: "act-mfa-01",
      pillar: "Security",
      healthPointsGain: 20,
      estimatedSavingsUSD: 0,
      priority: "HIGH",
      actionType: "ENABLE_MFA",
      commandPayload: `#{cmt_th_aplicar_politica_de_mfa_para_administradores}\naz rest --method POST --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies"`,
    });
  }

  const coinSignal = signals.find((s) => s.signalType === "COIN_OPTIMIZATION");
  if (coinSignal && coinSignal.score < 80) {
    plan.push({
      id: "act-coin-01",
      pillar: "COIN",
      healthPointsGain: 15,
      estimatedSavingsUSD: isMock ? 185.5 : 0,
      priority: "HIGH",
      actionType: "PURGE_ZOMBIES",
      commandPayload: `#{cmt_th_purgar_recursos_huerfanos_sin_uso}\naz resource delete --ids $(az disk list --query "[?diskState=='Unattached'].id" -o tsv)`,
    });
  }

  const budgetSignal = signals.find((s) => s.signalType === "BUDGET_COMPLIANCE");
  if (budgetSignal && budgetSignal.score < 100) {
    plan.push({
      id: "act-budget-01",
      pillar: "Budget",
      healthPointsGain: 10,
      estimatedSavingsUSD: 0,
      priority: "MEDIUM",
      actionType: "SET_BUDGET",
      commandPayload: budgetSignal.commandPayload,
    });
  }

  const credSignal = signals.find((s) => s.signalType === "CREDENTIAL_EXPIRY");
  if (credSignal && credSignal.score < 100) {
    plan.push({
      id: "act-cred-01",
      pillar: "Credentials",
      healthPointsGain: 10,
      estimatedSavingsUSD: 0,
      priority: "HIGH",
      actionType: "ROTATE_SECRETS",
      commandPayload: credSignal.commandPayload,
    });
  }

  return plan;
}

/**
 * Construye el resumen de salud a partir de las 4 señales.
 */
export function buildTenantHealthSummary(
  signals: HealthSignalItem[],
  historicalTrend?: TenantHealthDataPoint[],
  isMock = false
): TenantHealthSummary {
  const weightedSum = signals.reduce((acc, s) => acc + (s.score * s.weightPercentage) / 100, 0);
  const overallScore = Number(weightedSum.toFixed(0));
  const grade = scoreToGrade(overallScore);

  const trend =
    historicalTrend && historicalTrend.length > 0
      ? historicalTrend
      : generateDefaultHistoricalTrend(overallScore, isMock);

  const actionPlan = generateTenantHealthActionPlan(signals, isMock);

  return {
    overallScore,
    grade,
    signals,
    historicalTrend: trend,
    actionPlan,
  };
}

function generateDefaultHistoricalTrend(currentScore: number, isMock = false): TenantHealthDataPoint[] {
  const out: TenantHealthDataPoint[] = [];
  const today = new Date();

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    // En tenants reales, mantener el score real constante si no hay historial previo
    const score = isMock
      ? Math.min(100, Math.max(20, Math.round(38 + (currentScore - 38) * ((30 - i) / 30) + Math.sin(i) * 2)))
      : currentScore;

    out.push({
      date: dateStr,
      overallScore: score,
      grade: scoreToGrade(score),
    });
  }

  return out;
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockTenantHealthPayload(tenantId: string): TenantHealthPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  // Señal 1: Presupuesto (70 pts si no hay presupuesto, 90+ si es enterprise)
  const budgetRes = isEnterprise
    ? { score: 95, statusKey: "status_BUDGET_ok" as const, statusParams: { budget: "5,000", pct: "82" }, statusLevel: "OPTIMAL" as const }
    : { score: 70, statusKey: "status_BUDGET_none" as const, statusLevel: "WARNING" as const };

  // Señal 2: Credenciales (100 pts)
  const credRes = { score: 100, statusKey: "status_CRED_none" as const,
      statusParams: { days: 30 }, statusLevel: "OPTIMAL" as const };

  // Señal 3: COIN (0 pts en demo Pro, 55 pts en Business, 85 pts en Enterprise)
  const coinRes = isEnterprise
    ? { score: 85, statusKey: "status_COIN_progress" as const, statusParams: { implemented: 58, total: 68, days: 90 }, statusLevel: "OPTIMAL" as const, detailsCount: { current: 58, total: 68 } }
    : isBusiness
      ? { score: 55, statusKey: "status_COIN_progress" as const, statusParams: { implemented: 32, total: 68, days: 90 }, statusLevel: "WARNING" as const, detailsCount: { current: 32, total: 68 } }
      : { score: 0, statusKey: "status_COIN_progress" as const, statusParams: { implemented: 0, total: 68, days: 90 }, statusLevel: "CRITICAL" as const, detailsCount: { current: 0, total: 68 } };

  // Señal 4: MFA (0 pts en demo Pro, 50 pts en Business, 100 pts en Enterprise)
  const mfaRes = isEnterprise
    ? { score: 100, statusKey: "status_MFA_active" as const, statusParams: { current: 4, total: 4 }, statusLevel: "OPTIMAL" as const, detailsCount: { current: 4, total: 4 } }
    : isBusiness
      ? { score: 50, statusKey: "status_MFA_active" as const, statusParams: { current: 1, total: 2 }, statusLevel: "WARNING" as const, detailsCount: { current: 1, total: 2 } }
      : { score: 0, statusKey: "status_MFA_active" as const, statusParams: { current: 0, total: 1 }, statusLevel: "CRITICAL" as const, detailsCount: { current: 0, total: 1 } };

  const signals: HealthSignalItem[] = [
    {
      signalType: "BUDGET_COMPLIANCE",
      displayName: "Cumplimiento de Presupuesto",
      score: budgetRes.score,
      weightPercentage: SIGNAL_WEIGHTS.BUDGET_COMPLIANCE,
      weightedScore: (budgetRes.score * SIGNAL_WEIGHTS.BUDGET_COMPLIANCE) / 100,
      statusKey: budgetRes.statusKey,
      statusParams: budgetRes.statusParams,
      statusLevel: budgetRes.statusLevel,
      actionRequired: true,
      actionType: "SET_BUDGET",
      commandPayload: `#{cmt_th_crear_presupuesto_mensual_en_azure_consumption}\naz consumption budget create --budget-name "budget-tenant" --amount 1000 --time-grain Monthly`,
    },
    {
      signalType: "CREDENTIAL_EXPIRY",
      displayName: "Credenciales por Expirar",
      score: credRes.score,
      weightPercentage: SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY,
      weightedScore: (credRes.score * SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY) / 100,
      statusKey: credRes.statusKey,
      statusParams: credRes.statusParams,
      statusLevel: credRes.statusLevel,
    },
    {
      signalType: "COIN_OPTIMIZATION",
      displayName: "Índice de Optimización (COIN)",
      score: coinRes.score,
      weightPercentage: SIGNAL_WEIGHTS.COIN_OPTIMIZATION,
      weightedScore: (coinRes.score * SIGNAL_WEIGHTS.COIN_OPTIMIZATION) / 100,
      statusKey: coinRes.statusKey,
      statusParams: coinRes.statusParams,
      statusLevel: coinRes.statusLevel,
      detailsCount: coinRes.detailsCount,
      actionRequired: true,
      actionType: "VIEW_ADVISOR",
    },
    {
      signalType: "SECURITY_MFA",
      displayName: "Postura de Seguridad (MFA)",
      score: mfaRes.score,
      weightPercentage: SIGNAL_WEIGHTS.SECURITY_MFA,
      weightedScore: (mfaRes.score * SIGNAL_WEIGHTS.SECURITY_MFA) / 100,
      statusKey: mfaRes.statusKey,
      statusParams: mfaRes.statusParams,
      statusLevel: mfaRes.statusLevel,
      detailsCount: mfaRes.detailsCount,
      actionRequired: true,
      actionType: "ENFORCE_MFA",
      commandPayload: `#{cmt_th_requerir_mfa_para_cuentas_administradoras_en}\n#{cmt_th_conditionalaccess_policy_definition}`,
    },
  ];

  const summary = buildTenantHealthSummary(signals, undefined, true);

  return {
    summary,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensambla el estado de salud en vivo para tenants conectados reales.
 */
export function assembleLiveTenantHealth(input: {
  budgetUSD: number | null;
  currentSpendUSD: number;
  expiringCredsCount: number;
  coinImplemented: number;
  coinTotal: number;
  adminsWithMfa: number;
  totalAdmins: number;
  historicalTrend?: TenantHealthDataPoint[];
}): TenantHealthPayload {
  const budgetSignal = calcBudgetComplianceScore({
    budgetUSD: input.budgetUSD,
    currentSpendUSD: input.currentSpendUSD,
  });

  const credSignal = calcCredentialExpiryScore(input.expiringCredsCount);
  const coinSignal = calcCoinOptimizationScore(input.coinImplemented, input.coinTotal);
  const mfaSignal = calcMfaSecurityScore(input.adminsWithMfa, input.totalAdmins);

  const signals: HealthSignalItem[] = [
    {
      signalType: "BUDGET_COMPLIANCE",
      displayName: "Cumplimiento de Presupuesto",
      score: budgetSignal.score,
      weightPercentage: SIGNAL_WEIGHTS.BUDGET_COMPLIANCE,
      weightedScore: (budgetSignal.score * SIGNAL_WEIGHTS.BUDGET_COMPLIANCE) / 100,
      statusKey: budgetSignal.statusKey,
      statusParams: budgetSignal.statusParams,
      statusLevel: budgetSignal.statusLevel,
      actionRequired: budgetSignal.score < 100,
      actionType: "SET_BUDGET",
      commandPayload: budgetSignal.commandPayload,
    },
    {
      signalType: "CREDENTIAL_EXPIRY",
      displayName: "Credenciales por Expirar",
      score: credSignal.score,
      weightPercentage: SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY,
      weightedScore: (credSignal.score * SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY) / 100,
      statusKey: credSignal.statusKey,
      statusParams: credSignal.statusParams,
      statusLevel: credSignal.statusLevel,
      actionRequired: credSignal.score < 100,
      actionType: "ROTATE_SECRETS",
      commandPayload: credSignal.commandPayload,
    },
    {
      signalType: "COIN_OPTIMIZATION",
      displayName: "Índice de Optimización (COIN)",
      score: coinSignal.score,
      weightPercentage: SIGNAL_WEIGHTS.COIN_OPTIMIZATION,
      weightedScore: (coinSignal.score * SIGNAL_WEIGHTS.COIN_OPTIMIZATION) / 100,
      statusKey: coinSignal.statusKey,
      statusParams: coinSignal.statusParams,
      statusLevel: coinSignal.statusLevel,
      detailsCount: { current: input.coinImplemented, total: input.coinTotal },
      actionRequired: coinSignal.score < 80,
      actionType: "VIEW_ADVISOR",
    },
    {
      signalType: "SECURITY_MFA",
      displayName: "Postura de Seguridad (MFA)",
      score: mfaSignal.score,
      weightPercentage: SIGNAL_WEIGHTS.SECURITY_MFA,
      weightedScore: (mfaSignal.score * SIGNAL_WEIGHTS.SECURITY_MFA) / 100,
      statusKey: mfaSignal.statusKey,
      statusParams: mfaSignal.statusParams,
      statusLevel: mfaSignal.statusLevel,
      detailsCount: { current: input.adminsWithMfa, total: input.totalAdmins },
      actionRequired: mfaSignal.score < 100,
      actionType: "ENFORCE_MFA",
      commandPayload: mfaSignal.commandPayload,
    },
  ];

  const summary = buildTenantHealthSummary(signals, input.historicalTrend, false);

  return {
    summary,
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}
