/**
 * Servicio Azure FinOps: Motor de Seguimiento y Simulación Contractual MACC
 * Cálculos matemáticos precisos con decimal.js para Pacing Velocity, Burn-Up curves,
 * auditoría de Marketplace elegible y simulación de renegociación de compromisos Microsoft.
 */

import Decimal from "decimal.js";
import {
  MaccContractStatus,
  MaccBillingAccountItem,
  MaccPacingDataPoint,
  MaccSubscriptionBreakdownItem,
  MaccSummaryMetrics,
  MaccTrackingPayload,
  MaccSimulationResult,
} from "@/types/azureMaccTracking.types";

/**
 * Evaluación determinista del estado contractual MACC
 */
export function computeMaccStatus(
  consumed: number,
  commitment: number,
  projected: number
): MaccContractStatus {
  if (commitment <= 0) return "ON_TRACK";

  const decCommitment = new Decimal(commitment);
  const decProjected = new Decimal(projected);

  // Si la proyección supera el compromiso por más del 10% -> Cumplimiento anticipado
  if (decProjected.gt(decCommitment.times(1.1))) {
    return "EARLY_COMPLETION";
  }

  // Si la proyección es menor al 90% del compromiso -> Riesgo de sub-consumo (Shortfall)
  if (decProjected.lt(decCommitment.times(0.9))) {
    return "UNDER_BURN_RISK";
  }

  return "ON_TRACK";
}

/**
 * Genera la curva de Pacing Velocity mes a mes con comparación Real vs Teórico vs Forecast
 */
export function generateMaccPacingTrend(
  commitmentUSD: number,
  consumedUSD: number,
  burnRateMonthlyUSD: number,
  startDateStr: string,
  endDateStr: string
): MaccPacingDataPoint[] {
  const points: MaccPacingDataPoint[] = [];

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const now = new Date();

  // Calcular número de meses totales y transcurridos
  const totalMonths = Math.max(
    1,
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  );
  const elapsedMonths = Math.max(
    1,
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  );

  const linearMonthlyTarget = new Decimal(commitmentUSD).div(totalMonths).toNumber();
  const currentActualBurnRate = new Decimal(consumedUSD).div(elapsedMonths).toNumber();

  let accumulatedActual = 0;

  for (let m = 0; m <= totalMonths; m++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + m);
    const dateStr = d.toISOString().split("T")[0].substring(0, 7); // YYYY-MM

    const linearTarget = Number(
      new Decimal(linearMonthlyTarget).times(m).toFixed(2)
    );

    if (m <= elapsedMonths) {
      accumulatedActual = Number(
        new Decimal(currentActualBurnRate).times(m).toFixed(2)
      );

      points.push({
        date: dateStr,
        actualSpendUSD: Math.min(commitmentUSD * 1.5, accumulatedActual),
        linearTargetUSD: Math.min(commitmentUSD, linearTarget),
        commitmentTargetUSD: commitmentUSD,
      });
    } else {
      // Meses futuros: Línea de Forecast
      const forecastAccumulated = Number(
        new Decimal(accumulatedActual)
          .plus(new Decimal(burnRateMonthlyUSD).times(m - elapsedMonths))
          .toFixed(2)
      );

      points.push({
        date: dateStr,
        linearTargetUSD: Math.min(commitmentUSD, linearTarget),
        forecastSpendUSD: forecastAccumulated,
        commitmentTargetUSD: commitmentUSD,
      });
    }
  }

  return points;
}

/**
 * Simulación de Renegociación Contractual y Ampliación de Banda
 */
export function simulateMaccRenegotiation(
  commitmentUSD: number,
  consumedUSD: number,
  burnRateMonthlyUSD: number,
  increasePercentage: number
): MaccSimulationResult {
  const decBurnRate = new Decimal(burnRateMonthlyUSD || 1);
  const decRemaining = new Decimal(Math.max(0, commitmentUSD - consumedUSD));

  // Meses restantes para alcanzar el 100% al ritmo actual
  const monthsToCompletion = decRemaining.div(decBurnRate).toNumber();

  const completionDate = new Date();
  completionDate.setMonth(completionDate.getMonth() + Math.round(monthsToCompletion));
  const estimatedCompletionDate = completionDate.toISOString().split("T")[0];

  // Compromiso simulado con aumento (ej. +20% o +50%)
  const multiplier = new Decimal(1).plus(new Decimal(increasePercentage).div(100));
  const simulatedCommitmentUSD = Number(
    new Decimal(commitmentUSD).times(multiplier).toFixed(2)
  );

  // Escala de descuentos por banda de volumen Microsoft
  const currentTierDiscountPercentage = commitmentUSD >= 10000000 ? 18 : commitmentUSD >= 5000000 ? 14 : 10;
  const simulatedDiscountPercentage =
    simulatedCommitmentUSD >= 15000000
      ? 22
      : simulatedCommitmentUSD >= 10000000
        ? 18
        : 14;

  const additionalDiscountDiff = new Decimal(simulatedDiscountPercentage - currentTierDiscountPercentage).div(100);
  const additionalAnnualSavingsUSD = Number(
    new Decimal(burnRateMonthlyUSD).times(12).times(additionalDiscountDiff).toFixed(2)
  );

  return {
    estimatedCompletionDate,
    monthsAheadOfSchedule: Math.max(0, Math.round(12 - monthsToCompletion)),
    currentTierDiscountPercentage,
    simulatedCommitmentUSD,
    simulatedDiscountPercentage,
    additionalAnnualSavingsUSD,
  };
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockMaccPayload(tenantId: string): MaccTrackingPayload {
  const isEnterprise = tenantId.includes("4444");

  const billingAccounts: MaccBillingAccountItem[] = [
    {
      id: "ba-mock-01",
      billingAccountId: "EA-87654321",
      displayName: "Contoso Enterprise Enrollment Global",
      agreementType: "EA",
      commitmentAmountUSD: isEnterprise ? 10000000 : 5000000,
      consumedAmountUSD: isEnterprise ? 6200000 : 2900000,
      remainingAmountUSD: isEnterprise ? 3800000 : 2100000,
      progressPercentage: isEnterprise ? 62 : 58,
      startDate: "2025-10-22",
      endDate: "2027-10-22",
      daysRemaining: 426,
      monthlyBurnRateUSD: isEnterprise ? 620000 : 290000,
      projectedFinalCostUSD: isEnterprise ? 14880000 : 6960000,
      status: "EARLY_COMPLETION",
      eligibleFirstPartySpendUSD: isEnterprise ? 5400000 : 2550000,
      eligibleMarketplaceSpendUSD: isEnterprise ? 680000 : 300000,
      ineligibleSpendUSD: isEnterprise ? 120000 : 50000,
    },
  ];

  if (isEnterprise) {
    billingAccounts.push({
      id: "ba-mock-02",
      billingAccountId: "EA-99001234",
      displayName: "Fabrikam Cloud Analytics Sub-Enrollment",
      agreementType: "EA",
      commitmentAmountUSD: 5000000,
      consumedAmountUSD: 2250000,
      remainingAmountUSD: 2750000,
      progressPercentage: 45,
      startDate: "2026-01-15",
      endDate: "2028-01-15",
      daysRemaining: 512,
      monthlyBurnRateUSD: 225000,
      projectedFinalCostUSD: 5400000,
      status: "ON_TRACK",
      eligibleFirstPartySpendUSD: 2000000,
      eligibleMarketplaceSpendUSD: 210000,
      ineligibleSpendUSD: 40000,
    });
  }

  const totalCommitmentUSD = billingAccounts.reduce((s, a) => s + a.commitmentAmountUSD, 0);
  const totalConsumedUSD = billingAccounts.reduce((s, a) => s + a.consumedAmountUSD, 0);
  const totalRemainingUSD = billingAccounts.reduce((s, a) => s + a.remainingAmountUSD, 0);
  const totalProjected = billingAccounts.reduce((s, a) => s + a.projectedFinalCostUSD, 0);

  const globalStatus = computeMaccStatus(totalConsumedUSD, totalCommitmentUSD, totalProjected);

  const subscriptionsBreakdown: MaccSubscriptionBreakdownItem[] = [
    {
      subscriptionId: "sub-prod-landingzone",
      subscriptionName: "CSCS-LandingZone-Production",
      billingAccountId: "EA-87654321",
      firstPartySpendUSD: isEnterprise ? 3200000 : 1500000,
      marketplaceEligibleSpendUSD: isEnterprise ? 420000 : 190000,
      ineligibleSpendUSD: 60000,
      totalEligibleSpendUSD: isEnterprise ? 3620000 : 1690000,
      contributionPercentage: 58.4,
    },
    {
      subscriptionId: "sub-data-analytics",
      subscriptionName: "CSCS-DataPlatform-Synapse",
      billingAccountId: "EA-87654321",
      firstPartySpendUSD: isEnterprise ? 1800000 : 850000,
      marketplaceEligibleSpendUSD: isEnterprise ? 210000 : 95000,
      ineligibleSpendUSD: 45000,
      totalEligibleSpendUSD: isEnterprise ? 2010000 : 945000,
      contributionPercentage: 32.4,
    },
    {
      subscriptionId: "sub-shared-services",
      subscriptionName: "CSCS-Shared-HubNetwork",
      billingAccountId: isEnterprise ? "EA-99001234" : "EA-87654321",
      firstPartySpendUSD: isEnterprise ? 400000 : 200000,
      marketplaceEligibleSpendUSD: 50000,
      ineligibleSpendUSD: 15000,
      totalEligibleSpendUSD: isEnterprise ? 450000 : 250000,
      contributionPercentage: 9.2,
    },
  ];

  const primaryAccount = billingAccounts[0];
  const pacingTrend = generateMaccPacingTrend(
    totalCommitmentUSD,
    totalConsumedUSD,
    primaryAccount.monthlyBurnRateUSD,
    primaryAccount.startDate,
    primaryAccount.endDate
  );

  const simulation = simulateMaccRenegotiation(
    totalCommitmentUSD,
    totalConsumedUSD,
    primaryAccount.monthlyBurnRateUSD,
    20
  );

  return {
    metrics: {
      totalCommitmentUSD,
      totalConsumedUSD,
      totalRemainingUSD,
      globalStatus,
      billingAccounts,
      subscriptionsBreakdown,
      pacingTrend,
      potentialRenegotiationSavingsUSD: simulation.additionalAnnualSavingsUSD,
    },
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensambla el estado en vivo para tenants conectados reales.
 */
export function assembleLiveMaccTracking(input: {
  billingAccounts: MaccBillingAccountItem[];
  subscriptionsBreakdown: MaccSubscriptionBreakdownItem[];
}): MaccTrackingPayload {
  const { billingAccounts, subscriptionsBreakdown } = input;

  const totalCommitmentUSD = billingAccounts.reduce((s, a) => s + a.commitmentAmountUSD, 0);
  const totalConsumedUSD = billingAccounts.reduce((s, a) => s + a.consumedAmountUSD, 0);
  const totalRemainingUSD = Math.max(0, totalCommitmentUSD - totalConsumedUSD);
  const totalProjected = billingAccounts.reduce((s, a) => s + a.projectedFinalCostUSD, 0);

  const globalStatus = computeMaccStatus(totalConsumedUSD, totalCommitmentUSD, totalProjected);

  let pacingTrend: MaccPacingDataPoint[] = [];
  if (billingAccounts.length > 0) {
    const mainAccount = billingAccounts[0];
    pacingTrend = generateMaccPacingTrend(
      totalCommitmentUSD,
      totalConsumedUSD,
      mainAccount.monthlyBurnRateUSD,
      mainAccount.startDate,
      mainAccount.endDate
    );
  }

  const simulation =
    billingAccounts.length > 0
      ? simulateMaccRenegotiation(
          totalCommitmentUSD,
          totalConsumedUSD,
          billingAccounts[0].monthlyBurnRateUSD,
          20
        )
      : { additionalAnnualSavingsUSD: 0 };

  return {
    metrics: {
      totalCommitmentUSD,
      totalConsumedUSD,
      totalRemainingUSD,
      globalStatus,
      billingAccounts,
      subscriptionsBreakdown,
      pacingTrend,
      potentialRenegotiationSavingsUSD: simulation.additionalAnnualSavingsUSD,
    },
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}
