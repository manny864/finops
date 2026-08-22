import { describe, it, expect } from "vitest";
import {
  scoreToGrade,
  calcBudgetComplianceScore,
  calcCredentialExpiryScore,
  calcCoinOptimizationScore,
  calcMfaSecurityScore,
  buildTenantHealthSummary,
  getMockTenantHealthPayload,
  assembleLiveTenantHealth,
} from "@/services/azureTenantHealth.service";

describe("Tenant Health — Motor de Puntuación de Señales", () => {
  it("scoreToGrade clasifica según los rangos establecidos", () => {
    expect(scoreToGrade(95)).toBe("A");
    expect(scoreToGrade(85)).toBe("B");
    expect(scoreToGrade(75)).toBe("C");
    expect(scoreToGrade(55)).toBe("D");
    expect(scoreToGrade(40)).toBe("F");
  });

  it("calcBudgetComplianceScore penaliza la ausencia de presupuesto con 70/100", () => {
    const noBudget = calcBudgetComplianceScore({ budgetUSD: null, currentSpendUSD: 200 });
    expect(noBudget.score).toBe(70);
    expect(noBudget.statusLevel).toBe("WARNING");

    const perfectBudget = calcBudgetComplianceScore({ budgetUSD: 1000, currentSpendUSD: 800 });
    expect(perfectBudget.score).toBe(100);
    expect(perfectBudget.statusLevel).toBe("OPTIMAL");

    const excessBudget = calcBudgetComplianceScore({ budgetUSD: 1000, currentSpendUSD: 1200 });
    expect(excessBudget.score).toBeLessThan(100);
  });

  it("calcCredentialExpiryScore descuenta 20 puntos por cada credencial vencida", () => {
    const zero = calcCredentialExpiryScore(0);
    expect(zero.score).toBe(100);
    expect(zero.statusLevel).toBe("OPTIMAL");

    const one = calcCredentialExpiryScore(1);
    expect(one.score).toBe(80);
    expect(one.statusLevel).toBe("WARNING");

    const three = calcCredentialExpiryScore(3);
    expect(three.score).toBe(40);
    expect(three.statusLevel).toBe("CRITICAL");
  });

  it("calcCoinOptimizationScore calcula porcentaje de remediaciones", () => {
    const zero = calcCoinOptimizationScore(0, 68);
    expect(zero.score).toBe(0);
    expect(zero.statusLevel).toBe("CRITICAL");

    const partial = calcCoinOptimizationScore(34, 68);
    expect(partial.score).toBe(50);

    const full = calcCoinOptimizationScore(68, 68);
    expect(full.score).toBe(100);
    expect(full.statusLevel).toBe("OPTIMAL");
  });

  it("calcMfaSecurityScore evalúa el ratio de administradores con MFA", () => {
    const zero = calcMfaSecurityScore(0, 1);
    expect(zero.score).toBe(0);
    expect(zero.statusLevel).toBe("CRITICAL");

    const full = calcMfaSecurityScore(4, 4);
    expect(full.score).toBe(100);
    expect(full.statusLevel).toBe("OPTIMAL");
  });
});

describe("Tenant Health — Resumen, Dataset Demo y Ensamblado Vivo", () => {
  it("getMockTenantHealthPayload devuelve score compuesto y plan de acción priorizado", () => {
    const payload = getMockTenantHealthPayload("demo-tenant-1111");
    expect(payload.source).toBe("mock");
    expect(payload.summary.overallScore).toBeGreaterThanOrEqual(0);
    expect(payload.summary.signals).toHaveLength(4);
    expect(payload.summary.historicalTrend).toHaveLength(30);
    expect(payload.summary.actionPlan.length).toBeGreaterThan(0);
  });

  it("assembleLiveTenantHealth genera resumen ponderado en vivo sin dependencias mock", () => {
    const live = assembleLiveTenantHealth({
      budgetUSD: 2000,
      currentSpendUSD: 1500,
      expiringCredsCount: 0,
      coinImplemented: 20,
      coinTotal: 40,
      adminsWithMfa: 2,
      totalAdmins: 2,
    });

    expect(live.source).toBe("live");
    expect(live.summary.overallScore).toBeGreaterThan(80);
    expect(live.summary.signals.find((s) => s.signalType === "BUDGET_COMPLIANCE")?.score).toBe(100);
    expect(live.summary.signals.find((s) => s.signalType === "CREDENTIAL_EXPIRY")?.score).toBe(100);
    expect(live.summary.signals.find((s) => s.signalType === "SECURITY_MFA")?.score).toBe(100);
  });
});
