/**
 * Azure FinOps Anomaly Detection Service
 * Statistical Z-Score (3-Sigma), Moving Baseline Averages, Root Cause Attribution & Lifecycle Tracking
 *
 * RBAC mínimo: `Reader` + `Cost Management Reader`.
 * Tolerancia cero a mocks en tenants reales: si no hay datos o la BD está vacía, devuelve estado vacío legítimo.
 */

import { Decimal } from "decimal.js";
import {
  type AnomalyConfidenceDataPoint,
  type AnomalyDetectionSummary,
  type AnomalyPayload,
  type AnomalyRootCauseItem,
  type CostAnomalyItem,
} from "@/types/azureAnomalyDetection.types";

export const ANOMALY_Z_SCORE_THRESHOLD = 3.0;
export const DEFAULT_BASELINE_WINDOW_DAYS = 60;

/**
 * Calcula estadísticas de media móvil, variabilidad (desviación estándar) y límite 3σ.
 */
export function computeZScoreStats(values: number[]): {
  mean: number;
  stdDev: number;
  upperLimit3Sigma: number;
} {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, upperLimit3Sigma: 0 };
  }

  const n = new Decimal(values.length);
  const sum = values.reduce((acc, v) => acc.plus(v), new Decimal(0));
  const mean = sum.div(n);

  const variance = values
    .reduce((acc, v) => acc.plus(new Decimal(v).minus(mean).pow(2)), new Decimal(0))
    .div(n);

  const stdDev = new Decimal(Math.sqrt(variance.toNumber()));
  const upperLimit3Sigma = mean.plus(stdDev.times(3));

  return {
    mean: Number(mean.toDecimalPlaces(2).toNumber()),
    stdDev: Number(stdDev.toDecimalPlaces(2).toNumber()),
    upperLimit3Sigma: Number(upperLimit3Sigma.toDecimalPlaces(2).toNumber()),
  };
}

/**
 * Construye la serie temporal de banda de confianza contra costo real diario.
 */
export function buildConfidenceTrend(
  dailyCosts: Array<{ date: string; amount: number }>,
  mean: number,
  stdDev: number,
  threshold = ANOMALY_Z_SCORE_THRESHOLD
): AnomalyConfidenceDataPoint[] {
  const upper = Number((mean + 3 * stdDev).toFixed(2));
  return dailyCosts.map((d) => {
    const cost = Number(d.amount.toFixed(2));
    const zScore = stdDev > 0 ? Number(((cost - mean) / stdDev).toFixed(2)) : 0;
    const isAnomaly = zScore >= threshold;
    return {
      date: d.date,
      actualCostUSD: cost,
      expectedCostUSD: mean,
      upperLimit3SigmaUSD: upper,
      isAnomaly,
      zScore,
    };
  });
}

/**
 * Calcula la síntesis global de anomalías para el tenant.
 */
export function buildAnomalySummary(
  dailyCosts: Array<{ date: string; amount: number }>,
  anomalies: CostAnomalyItem[]
): AnomalyDetectionSummary {
  const values = dailyCosts.map((d) => d.amount).filter((v) => v > 0);
  const { mean, stdDev, upperLimit3Sigma } = computeZScoreStats(values);

  const openList = anomalies.filter((a) => a.state === "OPEN");
  const postponedList = anomalies.filter((a) => a.state === "SNOOZED");
  const completedList = anomalies.filter((a) => a.state === "RESOLVED");

  const unresolvedImpactUSD = [...openList, ...postponedList].reduce(
    (sum, a) => sum + Math.max(0, a.deltaUSD),
    0
  );

  const resolvedWithTime = completedList.filter((a) => a.resolvedAtDate && a.detectionDate);
  const meanTimeToResolutionHours =
    resolvedWithTime.length > 0
      ? resolvedWithTime.reduce((acc, a) => {
          const diffMs =
            new Date(a.resolvedAtDate!).getTime() - new Date(a.detectionDate).getTime();
          return acc + Math.max(0, diffMs / (1000 * 60 * 60));
        }, 0) / resolvedWithTime.length
      : undefined;

  const confidenceTrend = buildConfidenceTrend(dailyCosts, mean, stdDev);

  return {
    openAnomaliesCount: openList.length,
    unresolvedImpactUSD: Number(unresolvedImpactUSD.toFixed(2)),
    completedCount: completedList.length,
    meanTimeToResolutionHours: meanTimeToResolutionHours
      ? Number(meanTimeToResolutionHours.toFixed(1))
      : undefined,
    baselineMovingAvgUSD: mean,
    zScoreToleranceUSD: Number((3 * stdDev).toFixed(2)),
    alertThresholdUSD: upperLimit3Sigma,
    confidenceTrend,
    anomalies,
  };
}

/**
 * Dataset sintético determinista para modo demo por tier.
 */
export function getMockAnomalyPayload(tenantId: string): AnomalyPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const today = new Date();
  const dailyCosts: Array<{ date: string; amount: number }> = [];

  // 60 días de historial base
  for (let i = 59; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    // Variación natural alrededor de $27.43 USD
    const noise = Math.sin(i * 0.4) * 6.5 + ((i % 5) - 2) * 1.8;
    let baseAmount = Math.max(12, 27.43 + noise);

    // Anomalía real el día 2026-08-19 (o hace 2 días)
    if (i === 2) {
      baseAmount = 113.61;
    } else if (i === 22 && isBusiness) {
      // Anomalía histórica resuelta hace ~20 días
      baseAmount = 98.4;
    } else if (i === 40 && isEnterprise) {
      // Anomalía histórica resuelta hace ~40 días
      baseAmount = 145.2;
    }

    dailyCosts.push({
      date: dateStr,
      amount: Number(baseAmount.toFixed(2)),
    });
  }

  const rootCausesSpike: AnomalyRootCauseItem[] = [
    {
      serviceName: "Foundry Models (Azure OpenAI)",
      resourceGroup: "cscs-finops-mgmt-eastus2-rg",
      resourceId: "/subscriptions/demo-sub-01/resourceGroups/cscs-finops-mgmt-eastus2-rg/providers/Microsoft.CognitiveServices/accounts/oai-prod-shared",
      contributionPercentage: 99.2,
      deltaSpendUSD: 67.55,
    },
    {
      serviceName: "Azure Container Apps",
      resourceGroup: "cscs-finops-stg-westus2-rg",
      resourceId: "/subscriptions/demo-sub-01/resourceGroups/cscs-finops-stg-westus2-rg/providers/Microsoft.App/containerApps/finops-worker-stg",
      contributionPercentage: 0.6,
      deltaSpendUSD: 0.41,
    },
    {
      serviceName: "Azure Backup & Storage",
      resourceGroup: "cscs-finops-prod-westus2-backup-rg",
      resourceId: "/subscriptions/demo-sub-01/resourceGroups/cscs-finops-prod-westus2-backup-rg/providers/Microsoft.RecoveryServices/vaults/vault-prod",
      contributionPercentage: 0.1,
      deltaSpendUSD: 0.09,
    },
    {
      serviceName: "Otros Servicios Cloud",
      resourceGroup: "cscs-finops-global-rg",
      contributionPercentage: 0.1,
      deltaSpendUSD: 0.07,
    },
  ];

  const recentAnomalyDate = dailyCosts[dailyCosts.length - 3]?.date || "2026-08-19";

  const anomalies: CostAnomalyItem[] = [
    {
      id: "anom-001",
      detectionDate: recentAnomalyDate,
      actualCostUSD: 113.61,
      expectedCostUSD: 27.43,
      deltaUSD: 86.18,
      zScore: 3.32,
      severity: "CRITICAL",
      state: "OPEN",
      title: "Pico de Costo en Foundry Models / Azure OpenAI",
      rootCauses: rootCausesSpike,
    },
  ];

  if (isBusiness) {
    const pastDate = dailyCosts[dailyCosts.length - 23]?.date || "2026-07-30";
    anomalies.push({
      id: "anom-002",
      detectionDate: pastDate,
      actualCostUSD: 98.4,
      expectedCostUSD: 26.5,
      deltaUSD: 71.9,
      zScore: 3.12,
      severity: "HIGH",
      state: "RESOLVED",
      title: "Pico de Costo en Azure Databricks Cluster",
      rootCauses: [
        {
          serviceName: "Azure Databricks",
          resourceGroup: "cscs-finops-data-eastus-rg",
          contributionPercentage: 94.5,
          deltaSpendUSD: 67.95,
        },
        {
          serviceName: "Storage Accounts",
          resourceGroup: "cscs-finops-data-eastus-rg",
          contributionPercentage: 5.5,
          deltaSpendUSD: 3.95,
        },
      ],
      resolvedAtDate: new Date(new Date(pastDate).getTime() + 18 * 3600 * 1000).toISOString(),
      resolvedBy: "admin@cscloudsolutions.com",
      resolutionNotes: "Cluster auto-termination policy aplicada correctamente a 20 minutos de inactividad.",
    });
  }

  const summary = buildAnomalySummary(dailyCosts, anomalies);

  return {
    summary,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensambla anomalías en vivo con datos reales de CostSnapshots / Azure Cost Management.
 */
export function assembleLiveAnomalies(input: {
  dailyCosts: Array<{ date: string; amount: number }>;
  dbAnomalies?: Array<{
    id: string | number;
    date: string;
    amount: number;
    expected_amount: number;
    z_score: number;
    status: string;
    top_contributors?: AnomalyRootCauseItem[] | string;
    detected_at?: string;
    resolved_at?: string;
    resolution_notes?: string;
  }>;
}): AnomalyPayload {
  const anomalies: CostAnomalyItem[] = (input.dbAnomalies || []).map((row) => {
    let rootCauses: AnomalyRootCauseItem[] = [];
    if (typeof row.top_contributors === "string") {
      try {
        rootCauses = JSON.parse(row.top_contributors);
      } catch {
        rootCauses = [];
      }
    } else if (Array.isArray(row.top_contributors)) {
      rootCauses = row.top_contributors;
    }

    const stateMap: Record<string, CostAnomalyItem["state"]> = {
      open: "OPEN",
      new: "OPEN",
      postponed: "SNOOZED",
      snoozed: "SNOOZED",
      dismissed: "DISMISSED",
      completed: "RESOLVED",
      resolved: "RESOLVED",
    };

    const state = stateMap[String(row.status || "").toLowerCase()] || "OPEN";
    const actual = Number(row.amount) || 0;
    const expected = Number(row.expected_amount) || 0;
    const zScore = Number(row.z_score) || 0;
    const delta = Math.max(0, actual - expected);

    const dominant = rootCauses[0]?.serviceName || "Servicio Cloud";

    return {
      id: String(row.id),
      detectionDate: row.date,
      actualCostUSD: actual,
      expectedCostUSD: expected,
      deltaUSD: Number(delta.toFixed(2)),
      zScore: Number(zScore.toFixed(2)),
      severity: zScore >= 4 ? "CRITICAL" : zScore >= 3 ? "HIGH" : "MEDIUM",
      state,
      title: `Pico de Costo en ${dominant}`,
      rootCauses,
      resolvedAtDate: row.resolved_at || undefined,
      resolutionNotes: row.resolution_notes || undefined,
    };
  });

  const summary = buildAnomalySummary(input.dailyCosts, anomalies);

  return {
    summary,
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}
