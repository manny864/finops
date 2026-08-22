import { describe, it, expect } from "vitest";
import {
  computeZScoreStats,
  buildConfidenceTrend,
  buildAnomalySummary,
  getMockAnomalyPayload,
  assembleLiveAnomalies,
} from "@/services/azureAnomalyDetection.service";
import { type CostAnomalyItem } from "@/types/azureAnomalyDetection.types";

describe("Anomaly Detection — Cálculo Estadístico (Z-Score & 3-Sigma)", () => {
  it("calcula media, desviación estándar y límite 3-Sigma correctamente", () => {
    const values = [25, 27, 28, 26, 29, 31, 24, 27];
    const stats = computeZScoreStats(values);

    expect(stats.mean).toBeGreaterThan(25);
    expect(stats.mean).toBeLessThan(30);
    expect(stats.stdDev).toBeGreaterThan(0);
    expect(stats.upperLimit3Sigma).toBeGreaterThan(stats.mean);
    expect(stats.upperLimit3Sigma).toBeCloseTo(stats.mean + 3 * stats.stdDev, 1);
  });

  it("un conjunto vacío devuelve ceros de manera segura", () => {
    const stats = computeZScoreStats([]);
    expect(stats.mean).toBe(0);
    expect(stats.stdDev).toBe(0);
    expect(stats.upperLimit3Sigma).toBe(0);
  });

  it("detecta anomalías cuando el valor supera el umbral 3-Sigma", () => {
    const mean = 27.43;
    const stdDev = 25.92;
    const dailyCosts = [
      { date: "2026-08-17", amount: 28.5 },
      { date: "2026-08-18", amount: 30.1 },
      { date: "2026-08-19", amount: 113.61 }, // Anómalo
    ];

    const trend = buildConfidenceTrend(dailyCosts, mean, stdDev, 3.0);
    expect(trend).toHaveLength(3);
    expect(trend[0].isAnomaly).toBe(false);
    expect(trend[1].isAnomaly).toBe(false);
    expect(trend[2].isAnomaly).toBe(true);
    expect(trend[2].zScore).toBeGreaterThanOrEqual(3.3);
  });
});

describe("Anomaly Detection — Resumen y Métricas", () => {
  const dailyCosts = [
    { date: "2026-08-17", amount: 28.5 },
    { date: "2026-08-18", amount: 30.1 },
    { date: "2026-08-19", amount: 113.61 },
  ];

  const mockAnomalies: CostAnomalyItem[] = [
    {
      id: "anom-1",
      detectionDate: "2026-08-19",
      actualCostUSD: 113.61,
      expectedCostUSD: 27.43,
      deltaUSD: 86.18,
      zScore: 3.32,
      severity: "CRITICAL",
      state: "OPEN",
      title: "Pico en OpenAI",
      rootCauses: [
        {
          serviceName: "Azure OpenAI",
          resourceGroup: "cscs-rg",
          contributionPercentage: 99.2,
          deltaSpendUSD: 85.5,
        },
      ],
    },
    {
      id: "anom-2",
      detectionDate: "2026-07-20",
      actualCostUSD: 95.0,
      expectedCostUSD: 25.0,
      deltaUSD: 70.0,
      zScore: 3.1,
      severity: "HIGH",
      state: "RESOLVED",
      title: "Pico en Databricks",
      rootCauses: [],
      resolvedAtDate: "2026-07-21T10:00:00Z",
    },
  ];

  it("calcula conteos por estado e impacto sin resolver correctamente", () => {
    const summary = buildAnomalySummary(dailyCosts, mockAnomalies);

    expect(summary.openAnomaliesCount).toBe(1);
    expect(summary.completedCount).toBe(1);
    expect(summary.unresolvedImpactUSD).toBe(86.18);
    expect(summary.confidenceTrend).toHaveLength(3);
    expect(summary.alertThresholdUSD).toBeGreaterThan(summary.baselineMovingAvgUSD);
  });
});

describe("Anomaly Detection — Dataset Demo y Ensamblado Vivo", () => {
  it("getMockAnomalyPayload devuelve datos estructurados con atribución causal y tiering", () => {
    const payloadPro = getMockAnomalyPayload("demo-tenant-1111");
    expect(payloadPro.source).toBe("mock");
    expect(payloadPro.summary.anomalies.length).toBeGreaterThanOrEqual(1);

    const openAnom = payloadPro.summary.anomalies.find((a) => a.state === "OPEN");
    expect(openAnom).toBeDefined();
    expect(openAnom?.rootCauses.length).toBeGreaterThan(0);
    expect(openAnom?.rootCauses[0].serviceName).toContain("Foundry Models");
    expect(openAnom?.rootCauses[0].contributionPercentage).toBeGreaterThan(90);

    const payloadEnt = getMockAnomalyPayload("demo-tenant-4444");
    expect(payloadEnt.summary.anomalies.length).toBeGreaterThanOrEqual(payloadPro.summary.anomalies.length);
  });

  it("assembleLiveAnomalies devuelve estado vacío legítimo cuando no hay datos", () => {
    const live = assembleLiveAnomalies({ dailyCosts: [] });
    expect(live.source).toBe("live");
    expect(live.summary.openAnomaliesCount).toBe(0);
    expect(live.summary.unresolvedImpactUSD).toBe(0);
    expect(live.summary.anomalies).toHaveLength(0);
  });

  it("assembleLiveAnomalies mapea correctamente registros reales de la base de datos", () => {
    const live = assembleLiveAnomalies({
      dailyCosts: [{ date: "2026-08-19", amount: 120.0 }],
      dbAnomalies: [
        {
          id: 101,
          date: "2026-08-19",
          amount: 120.0,
          expected_amount: 30.0,
          z_score: 3.5,
          status: "open",
          top_contributors: JSON.stringify([
            {
              serviceName: "Azure Cosmos DB",
              resourceGroup: "prod-db-rg",
              contributionPercentage: 92.4,
              deltaSpendUSD: 83.16,
            },
          ]),
        },
      ],
    });

    expect(live.source).toBe("live");
    expect(live.summary.anomalies).toHaveLength(1);
    expect(live.summary.anomalies[0].state).toBe("OPEN");
    expect(live.summary.anomalies[0].rootCauses[0].serviceName).toBe("Azure Cosmos DB");
  });
});
