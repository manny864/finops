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
  statusText: string;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  const { budgetUSD, currentSpendUSD, projectedSpendUSD } = input;

  if (budgetUSD === null || budgetUSD <= 0) {
    return {
      score: 70,
      statusText: "Sin presupuesto mensual configurado este mes",
      statusLevel: "WARNING",
      commandPayload: `# Crear presupuesto en Azure Consumption para el tenant\naz consumption budget create --budget-name "budget-tenant-monthly" \\\n  --amount ${Math.max(500, Math.ceil(currentSpendUSD * 1.1))} --time-grain Monthly \\\n  --start-date "$(date +%Y-%m-01)" --end-date "2030-12-31"`,
    };
  }

  const spendToEvaluate = projectedSpendUSD !== undefined ? projectedSpendUSD : currentSpendUSD;
  const burnPct = new Decimal(spendToEvaluate).div(budgetUSD).times(100).toNumber();

  if (burnPct <= 100) {
    return {
      score: 100,
      statusText: `Presupuesto de $${budgetUSD.toFixed(2)} USD respetado (${burnPct.toFixed(1)}% proyectado)`,
      statusLevel: "OPTIMAL",
    };
  }

  const excessPct = burnPct - 100;
  const rawScore = Math.max(0, 100 - excessPct * 2);
  const score = Number(rawScore.toFixed(0));

  return {
    score,
    statusText: `Desvío presupuestario del +${excessPct.toFixed(1)}% ($${spendToEvaluate.toFixed(2)} / $${budgetUSD.toFixed(2)} USD)`,
    statusLevel: score < 50 ? "CRITICAL" : "WARNING",
    commandPayload: `# Ajustar o crear alertas tempranas de presupuesto al 80% y 100%\naz consumption budget create --budget-name "budget-tenant-alert" \\\n  --amount ${budgetUSD} --time-grain Monthly`,
  };
}

/**
 * Señal 2: Credenciales por Expirar (Peso: 25%)
 * - 0 credenciales vencen en <= 30 días -> Score: 100/100
 * - -20 puntos por cada credencial vencida / próxima a vencer
 */
export function calcCredentialExpiryScore(expiringCount: number): {
  score: number;
  statusText: string;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  if (expiringCount <= 0) {
    return {
      score: 100,
      statusText: "0 credenciales vencen en los próximos 30 días",
      statusLevel: "OPTIMAL",
    };
  }

  const penalty = expiringCount * 20;
  const score = Math.max(0, 100 - penalty);

  return {
    score,
    statusText: `${expiringCount} credencial(es) o secreto(s) vencen en los próximos 30 días`,
    statusLevel: score < 50 ? "CRITICAL" : "WARNING",
    commandPayload: `# Listar credenciales y certificados próximos a expirar\naz ad app credential list --id <appId>`,
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
  statusText: string;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  if (totalActive <= 0) {
    return {
      score: 100,
      statusText: "Sin recomendaciones activas pendientes (100% Optimizado)",
      statusLevel: "OPTIMAL",
    };
  }

  const pct = new Decimal(implemented).div(totalActive).times(100).toNumber();
  const score = Number(Math.min(100, Math.max(0, pct)).toFixed(0));

  return {
    score,
    statusText: `${implemented}/${totalActive} recomendaciones implementadas (90 días)`,
    statusLevel: score >= 80 ? "OPTIMAL" : score >= 50 ? "WARNING" : "CRITICAL",
    commandPayload: `# Consultar recomendaciones de optimización de Azure Advisor\naz advisor recommendation list --category Cost`,
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
  statusText: string;
  statusLevel: "OPTIMAL" | "WARNING" | "CRITICAL";
  commandPayload?: string;
} {
  if (totalAdmins <= 0) {
    return {
      score: 100,
      statusText: "Sin cuentas de administración descubiertas",
      statusLevel: "OPTIMAL",
    };
  }

  const pct = new Decimal(adminsWithMfa).div(totalAdmins).times(100).toNumber();
  const score = Number(Math.min(100, Math.max(0, pct)).toFixed(0));

  return {
    score,
    statusText: `${adminsWithMfa}/${totalAdmins} administradores con MFA activo`,
    statusLevel: score === 100 ? "OPTIMAL" : score >= 50 ? "WARNING" : "CRITICAL",
    commandPayload: `# Requerir MFA mediante Directiva de Acceso Condicional en Entra ID\n# Portal: Entra ID -> Security -> Conditional Access -> New Policy -> Require MFA for Admins`,
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
      title: "Habilitar MFA obligatorio en Cuenta Administradora Principal",
      pillar: "Security",
      healthPointsGain: 20,
      estimatedSavingsUSD: 0,
      priority: "HIGH",
      actionType: "ENABLE_MFA",
      commandPayload: `# Aplicar política de MFA para administradores privilegiados\naz rest --method POST --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies"`,
    });
  }

  const coinSignal = signals.find((s) => s.signalType === "COIN_OPTIMIZATION");
  if (coinSignal && coinSignal.score < 80) {
    plan.push({
      id: "act-coin-01",
      title: "Implementar Quick Wins de Desperdicio (Discos y NICs huérfanas)",
      pillar: "COIN",
      healthPointsGain: 15,
      estimatedSavingsUSD: isMock ? 185.5 : 0,
      priority: "HIGH",
      actionType: "PURGE_ZOMBIES",
      commandPayload: `# Purgar recursos huérfanos sin uso\naz resource delete --ids $(az disk list --query "[?diskState=='Unattached'].id" -o tsv)`,
    });
  }

  const budgetSignal = signals.find((s) => s.signalType === "BUDGET_COMPLIANCE");
  if (budgetSignal && budgetSignal.score < 100) {
    plan.push({
      id: "act-budget-01",
      title: "Configurar Presupuesto Mensual con Alertas de Umbral Temprano",
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
      title: "Rotar Secretos y Certificados de Service Principals próximos a vencer",
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
    ? { score: 95, statusText: "Presupuesto de $5,000 USD respetado (82% proyectado)", statusLevel: "OPTIMAL" as const }
    : { score: 70, statusText: "Sin presupuesto configurado este mes", statusLevel: "WARNING" as const };

  // Señal 2: Credenciales (100 pts)
  const credRes = { score: 100, statusText: "0 credenciales vencen en los próximos 30 días", statusLevel: "OPTIMAL" as const };

  // Señal 3: COIN (0 pts en demo Pro, 55 pts en Business, 85 pts en Enterprise)
  const coinRes = isEnterprise
    ? { score: 85, statusText: "58/68 recomendaciones implementadas (90 días)", statusLevel: "OPTIMAL" as const, detailsCount: { current: 58, total: 68 } }
    : isBusiness
      ? { score: 55, statusText: "32/68 recomendaciones implementadas (90 días)", statusLevel: "WARNING" as const, detailsCount: { current: 32, total: 68 } }
      : { score: 0, statusText: "0/68 recomendaciones implementadas (90 días)", statusLevel: "CRITICAL" as const, detailsCount: { current: 0, total: 68 } };

  // Señal 4: MFA (0 pts en demo Pro, 50 pts en Business, 100 pts en Enterprise)
  const mfaRes = isEnterprise
    ? { score: 100, statusText: "4/4 administradores con MFA activo", statusLevel: "OPTIMAL" as const, detailsCount: { current: 4, total: 4 } }
    : isBusiness
      ? { score: 50, statusText: "1/2 administradores con MFA activo", statusLevel: "WARNING" as const, detailsCount: { current: 1, total: 2 } }
      : { score: 0, statusText: "0/1 administradores con MFA activo", statusLevel: "CRITICAL" as const, detailsCount: { current: 0, total: 1 } };

  const signals: HealthSignalItem[] = [
    {
      signalType: "BUDGET_COMPLIANCE",
      displayName: "Cumplimiento de Presupuesto",
      score: budgetRes.score,
      weightPercentage: SIGNAL_WEIGHTS.BUDGET_COMPLIANCE,
      weightedScore: (budgetRes.score * SIGNAL_WEIGHTS.BUDGET_COMPLIANCE) / 100,
      statusText: budgetRes.statusText,
      statusLevel: budgetRes.statusLevel,
      actionRequiredTitle: "Crear Presupuesto",
      actionType: "SET_BUDGET",
      commandPayload: `# Crear presupuesto mensual en Azure Consumption\naz consumption budget create --budget-name "budget-tenant" --amount 1000 --time-grain Monthly`,
    },
    {
      signalType: "CREDENTIAL_EXPIRY",
      displayName: "Credenciales por Expirar",
      score: credRes.score,
      weightPercentage: SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY,
      weightedScore: (credRes.score * SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY) / 100,
      statusText: credRes.statusText,
      statusLevel: credRes.statusLevel,
    },
    {
      signalType: "COIN_OPTIMIZATION",
      displayName: "Índice de Optimización (COIN)",
      score: coinRes.score,
      weightPercentage: SIGNAL_WEIGHTS.COIN_OPTIMIZATION,
      weightedScore: (coinRes.score * SIGNAL_WEIGHTS.COIN_OPTIMIZATION) / 100,
      statusText: coinRes.statusText,
      statusLevel: coinRes.statusLevel,
      detailsCount: coinRes.detailsCount,
      actionRequiredTitle: "Ver Recomendaciones",
      actionType: "VIEW_ADVISOR",
    },
    {
      signalType: "SECURITY_MFA",
      displayName: "Postura de Seguridad (MFA)",
      score: mfaRes.score,
      weightPercentage: SIGNAL_WEIGHTS.SECURITY_MFA,
      weightedScore: (mfaRes.score * SIGNAL_WEIGHTS.SECURITY_MFA) / 100,
      statusText: mfaRes.statusText,
      statusLevel: mfaRes.statusLevel,
      detailsCount: mfaRes.detailsCount,
      actionRequiredTitle: "Forzar MFA",
      actionType: "ENFORCE_MFA",
      commandPayload: `# Requerir MFA para cuentas administradoras en Entra ID\n# conditionalAccess policy definition...`,
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
      statusText: budgetSignal.statusText,
      statusLevel: budgetSignal.statusLevel,
      actionRequiredTitle: budgetSignal.score < 100 ? "Crear Presupuesto" : undefined,
      actionType: "SET_BUDGET",
      commandPayload: budgetSignal.commandPayload,
    },
    {
      signalType: "CREDENTIAL_EXPIRY",
      displayName: "Credenciales por Expirar",
      score: credSignal.score,
      weightPercentage: SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY,
      weightedScore: (credSignal.score * SIGNAL_WEIGHTS.CREDENTIAL_EXPIRY) / 100,
      statusText: credSignal.statusText,
      statusLevel: credSignal.statusLevel,
      actionRequiredTitle: credSignal.score < 100 ? "Rotar Credenciales" : undefined,
      actionType: "ROTATE_SECRETS",
      commandPayload: credSignal.commandPayload,
    },
    {
      signalType: "COIN_OPTIMIZATION",
      displayName: "Índice de Optimización (COIN)",
      score: coinSignal.score,
      weightPercentage: SIGNAL_WEIGHTS.COIN_OPTIMIZATION,
      weightedScore: (coinSignal.score * SIGNAL_WEIGHTS.COIN_OPTIMIZATION) / 100,
      statusText: coinSignal.statusText,
      statusLevel: coinSignal.statusLevel,
      detailsCount: { current: input.coinImplemented, total: input.coinTotal },
      actionRequiredTitle: coinSignal.score < 80 ? "Ver Recomendaciones" : undefined,
      actionType: "VIEW_ADVISOR",
    },
    {
      signalType: "SECURITY_MFA",
      displayName: "Postura de Seguridad (MFA)",
      score: mfaSignal.score,
      weightPercentage: SIGNAL_WEIGHTS.SECURITY_MFA,
      weightedScore: (mfaSignal.score * SIGNAL_WEIGHTS.SECURITY_MFA) / 100,
      statusText: mfaSignal.statusText,
      statusLevel: mfaSignal.statusLevel,
      detailsCount: { current: input.adminsWithMfa, total: input.totalAdmins },
      actionRequiredTitle: mfaSignal.score < 100 ? "Forzar MFA" : undefined,
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
