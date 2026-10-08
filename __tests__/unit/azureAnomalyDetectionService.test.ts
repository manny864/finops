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
      state: "New",
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
      state: "Resolved",
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

  it("la que alguien tomó sigue abierta, y un falso positivo no cuenta para el MTTR", () => {
    const tomada = { ...mockAnomalies[0], id: "anom-3", state: "Investigating" as const, deltaUSD: 10 };
    // Cerrado en 1 h: si entrara al promedio, el MTTR bajaría de 34 h a 17,5 h.
    const falso = {
      ...mockAnomalies[1], id: "anom-4", state: "False Positive" as const,
      detectionDate: "2026-07-20", resolvedAtDate: "2026-07-20T01:00:00Z",
    };
    const summary = buildAnomalySummary(dailyCosts, [...mockAnomalies, tomada, falso]);

    expect(summary.openAnomaliesCount).toBe(2);
    expect(summary.unresolvedImpactUSD).toBe(96.18);
    expect(summary.completedCount).toBe(1);
    expect(summary.meanTimeToResolutionHours).toBe(34);
  });
});

describe("Anomaly Detection — Dataset Demo y Ensamblado Vivo", () => {
  it("getMockAnomalyPayload devuelve datos estructurados con atribución causal y tiering", () => {
    const payloadPro = getMockAnomalyPayload("demo-tenant-1111");
    expect(payloadPro.source).toBe("mock");
    expect(payloadPro.summary.anomalies.length).toBeGreaterThanOrEqual(1);

    const openAnom = payloadPro.summary.anomalies.find((a) => a.state === "New");
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
          status: "New",
          // LA FORMA QUE ESCRIBE `getAnomalyTopContributors`, que es la unica
          // que existe en la base: snake_case, `delta`, `delta_pct_of_total`.
          //
          // Este test traia camelCase --la forma de la UI-- y por eso pasaba
          // sobre el bug: verificaba que el JSON se copiara tal cual, que era
          // justamente lo roto. Con el dato real en la base, la pantalla
          // dibujaba «% en» y «+$NaN».
          top_contributors: JSON.stringify([
            {
              resource_group: "prod-db-rg",
              service_name: "Azure Cosmos DB",
              cost: 90.0,
              baseline_avg: 6.84,
              delta: 83.16,
              delta_pct_of_total: 92.4,
            },
          ]),
        },
      ],
    });

    expect(live.source).toBe("live");
    expect(live.summary.anomalies).toHaveLength(1);
    expect(live.summary.anomalies[0].state).toBe("New");
    expect(live.summary.anomalies[0].rootCauses[0]).toEqual({
      serviceName: "Azure Cosmos DB",
      resourceGroup: "prod-db-rg",
      contributionPercentage: 92.4,
      deltaSpendUSD: 83.16,
    });
    // El titulo sale del contribuyente dominante: si la traduccion se rompe,
    // vuelve a decir DESCONOCIDO.
    expect(live.summary.anomalies[0].titleService).toBe("Azure Cosmos DB");
  });

  it("un contribuyente incompleto da 0, nunca NaN", () => {
    // Una fila vieja o a medio escribir no puede llegar a la pantalla como
    // `+$NaN`: `money()` formatea lo que reciba.
    const live = assembleLiveAnomalies({
      dailyCosts: [],
      dbAnomalies: [
        {
          id: 2, date: "2026-08-15", amount: 0.02, expected_amount: 0.01,
          z_score: 3.74, status: "New",
          top_contributors: JSON.stringify([{ service_name: "Key Vault" }]),
        },
      ],
    });
    expect(live.summary.anomalies[0].rootCauses[0]).toEqual({
      serviceName: "Key Vault",
      resourceGroup: "",
      contributionPercentage: 0,
      deltaSpendUSD: 0,
    });
  });

  it("los hechos por medidor y el responsable llegan al panel", () => {
    // El panel que se ve es este. Los hechos se calculaban y se guardaban, pero
    // esta consulta no los leía: el bloque «Qué cambió» no aparecía nunca.
    const hecho = {
      id: "f1", type: "USAGE_INCREASE" as const, serviceName: "Virtual Machines",
      meterName: "D4s v3", baseline: 10, actual: 40, delta: 30,
    };
    const fila = { date: "2026-08-15", amount: 40, expected_amount: 10, z_score: 3.5, status: "New" };
    const live = assembleLiveAnomalies({
      dailyCosts: [],
      dbAnomalies: [
        // mysql2 entrega la columna JSON ya parseada...
        { ...fila, id: 1, root_cause_facts: [hecho], assigned_to: "ana@contoso.com", assigned_detail: "Plataforma" },
        // ...pero el texto también vale, y uno roto no tumba la lista.
        { ...fila, id: 2, root_cause_facts: JSON.stringify([hecho]), assigned_to: null },
        { ...fila, id: 3, root_cause_facts: "{roto" },
      ],
    });
    const [a, b, c] = live.summary.anomalies;
    expect(a.rootCauseFacts).toEqual([hecho]);
    expect(a.assignedTo).toBe("ana@contoso.com");
    expect(a.assignedDetail).toBe("Plataforma");
    expect(b.rootCauseFacts).toEqual([hecho]);
    expect(b.assignedTo).toBeUndefined();
    expect(c.rootCauseFacts).toEqual([]);
  });

  it("la demo trae hechos calculados con la función de producción", () => {
    const [abierta, resuelta] = getMockAnomalyPayload("demo-tenant-4444").summary.anomalies;
    expect(abierta.rootCauseFacts?.[0]).toMatchObject({
      id: "f1",
      type: "USAGE_INCREASE",
      serviceName: "Foundry Models (Azure OpenAI)",
      meterName: "gpt-4o-mini Input Tokens",
    });
    // Abierta y sin responsable: se sugiere asignarlo. La resuelta ya lo tiene.
    expect(abierta.assignedTo).toBeUndefined();
    expect(resuelta.rootCauseFacts?.map((f) => f.serviceName)).toEqual(["Azure Databricks", "Storage Accounts"]);
    expect(resuelta.assignedTo).toBeTruthy();
  });

  it("el estado llega con el vocabulario de la columna, y uno ajeno se muestra como nueva", () => {
    // El panel tenía su propio vocabulario (Open/Postponed/Dismissed/Completed)
    // que la columna ENUM rechazaba: el triaje no se guardaba nunca.
    const fila = { date: "2026-08-15", amount: 40, expected_amount: 10, z_score: 3.5 };
    const live = assembleLiveAnomalies({
      dailyCosts: [],
      dbAnomalies: [
        { ...fila, id: 1, status: "Investigating" },
        { ...fila, id: 2, status: "False Positive" },
        { ...fila, id: 3, status: "Postponed" },
      ],
    });
    expect(live.summary.anomalies.map((a) => a.state)).toEqual(["Investigating", "False Positive", "New"]);
  });
});
