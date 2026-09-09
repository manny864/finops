import { describe, it, expect } from "vitest";
import type { UeServiceCategory } from "@/types/azureUnitEconomics.types";
import {
  isValidMetricType,
  normalizeMetricType,
  normalizeIngestionMode,
  calcUnitCost,
  percentDelta,
  pearsonCorrelation,
  deriveElasticity,
  calcElasticityRatio,
  coefficientOfVariation,
  deriveScaleEfficiency,
  buildSummary,
  attributeUnitCostByService,
  generateUnitEconomicsRecommendations,
  validateIngestBatch,
  getMockUnitEconomicsPayload,
  categoryColor,
} from "@/services/azureUnitEconomics.service";
import type { UnitEconomicsConfig, UnitEconomicsDataPoint } from "@/types/azureUnitEconomics.types";

const cfg = (over: Partial<UnitEconomicsConfig> = {}): UnitEconomicsConfig => ({
  tenantId: "t",
  primaryMetric: "DAU",
  targetCostPerUnitUSD: 0.2,
  alertThresholdPercentage: 15,
  ingestionMode: "Manual",
  ...over,
});

const point = (date: string, cost: number, units: number): UnitEconomicsDataPoint => ({
  date,
  cloudCostUSD: cost,
  businessUnitsCount: units,
  unitCostUSD: calcUnitCost(cost, units),
});

describe("Unit Economics — cálculo del costo unitario", () => {
  it("divide con precisión decimal y no con floats", () => {
    expect(calcUnitCost(100, 400)).toBe(0.25);
    // 0.1 + 0.2 en float da 0.30000000000000004; el resultado debe ser exacto.
    expect(calcUnitCost(0.3, 3)).toBe(0.1);
  });

  it("devuelve null sin denominador, NO cero", () => {
    // Un cero se leería como eficiencia perfecta justo donde falta el dato.
    expect(calcUnitCost(500, 0)).toBeNull();
    expect(calcUnitCost(500, -10)).toBeNull();
    expect(calcUnitCost(500, NaN)).toBeNull();
    expect(calcUnitCost(NaN, 100)).toBeNull();
  });

  it("aplica la escala de la métrica: los tokens se miden en millones", () => {
    // 2.000.000 de tokens con $50 de gasto = $25 por millón, no $0.000025.
    expect(calcUnitCost(50, 2_000_000, 1_000_000)).toBe(25);
    expect(calcUnitCost(100, 500, 1)).toBe(0.2);
  });

  it("conserva escala suficiente para costos por token o por llamada API", () => {
    // ~0.00001 USD: con 2 decimales se redondearía a $0.00.
    const v = calcUnitCost(10, 1_000_000);
    expect(v).toBe(0.00001);
    expect(v).not.toBe(0);
  });

  it("percentDelta no divide por cero", () => {
    expect(percentDelta(120, 100)).toBe(20);
    expect(percentDelta(80, 100)).toBe(-20);
    expect(percentDelta(50, 0)).toBe(0);
    // Base negativa: el signo del delta no debe invertirse por el denominador.
    expect(percentDelta(-50, -100)).toBe(50);
  });
});

describe("Unit Economics — elasticidad", () => {
  it("la correlación exige al menos tres puntos y varianza real", () => {
    expect(pearsonCorrelation([1, 2], [1, 2])).toBe(0);
    // Serie plana: no hay correlación que afirmar aunque coincidan los largos.
    expect(pearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBe(1);
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBe(-1);
  });

  it("clasifica elástico, semi-elástico y fijo por el ratio de variación", () => {
    expect(deriveElasticity(0.95)).toBe("Elastic");
    expect(deriveElasticity(0.5)).toBe("Semi-Elastic");
    expect(deriveElasticity(0.1)).toBe("Fixed");
    // Sin ratio calculable, el default conservador es Fixed.
    expect(deriveElasticity(0)).toBe("Fixed");
  });

  it("el ratio de variación distingue lo que la correlación no puede", () => {
    const volumen = [100, 200, 300, 400];
    // Gasto que varía apenas 1% pero perfectamente sincronizado: Pearson lo da
    // como correlación perfecta, y sin embargo es un costo fijo con ruido.
    const casiPlano = [100, 100.5, 101, 101.5];
    expect(pearsonCorrelation(casiPlano, volumen)).toBe(1);
    expect(calcElasticityRatio(casiPlano, volumen)).toBeLessThan(0.35);
    expect(deriveElasticity(calcElasticityRatio(casiPlano, volumen))).toBe("Fixed");

    // Gasto que sigue al volumen en magnitud: elástico de verdad.
    const proporcional = [10, 20, 30, 40];
    expect(calcElasticityRatio(proporcional, volumen)).toBeCloseTo(1, 2);
    expect(deriveElasticity(calcElasticityRatio(proporcional, volumen))).toBe("Elastic");

    // Volumen plano: no hay elasticidad que medir.
    expect(calcElasticityRatio([1, 2, 3, 4], [50, 50, 50, 50])).toBe(0);
  });
});

describe("Unit Economics — economía de escala", () => {
  it("más volumen con menor costo unitario es óptimo", () => {
    expect(deriveScaleEfficiency(20, -8)).toBe("Optimal");
    expect(deriveScaleEfficiency(15, 0)).toBe("Optimal");
  });

  it("costo unitario que sube junto con el volumen es ineficiencia arquitectónica", () => {
    expect(deriveScaleEfficiency(20, 5)).toBe("Degrading");
    expect(deriveScaleEfficiency(20, 25)).toBe("Critical");
  });

  it("sin movimiento de volumen no se afirma nada", () => {
    expect(deriveScaleEfficiency(2, 30)).toBe("Unknown");
    expect(deriveScaleEfficiency(-3, -30)).toBe("Unknown");
  });

  it("con el volumen cayendo, que el costo unitario suba es esperable y no se marca crítico", () => {
    // Los costos fijos se reparten entre menos unidades: no es una regresión.
    expect(deriveScaleEfficiency(-20, 15)).toBe("Unknown");
    expect(deriveScaleEfficiency(-20, 40)).toBe("Degrading");
  });
});

describe("Unit Economics — resumen", () => {
  const series = [
    point("2026-08-01", 100, 1000),
    point("2026-08-02", 100, 1000),
    point("2026-08-03", 120, 1500),
    point("2026-08-04", 120, 1500),
  ];

  it("promedia sobre el total, no promediando promedios diarios", () => {
    const s = buildSummary({ series, config: cfg(), services: [] });
    // (100+100+120+120) / (1000+1000+1500+1500) = 440/5000 = 0.088
    expect(s.avgUnitCostUSD).toBeCloseTo(0.088, 5);
    expect(s.totalCloudSpendUSD).toBe(440);
    expect(s.totalBusinessUnits).toBe(5000);
  });

  it("cuenta los días con gasto y sin denominador", () => {
    const withGap = [...series, point("2026-08-05", 90, 0)];
    const s = buildSummary({ series: withGap, config: cfg(), services: [] });
    expect(s.daysMissingBusinessData).toBe(1);
    expect(s.hasBusinessData).toBe(true);
  });

  it("marca hasBusinessData en false cuando nunca hubo volumen", () => {
    const s = buildSummary({
      series: [point("2026-08-01", 100, 0), point("2026-08-02", 100, 0)],
      config: cfg(),
      services: [],
    });
    expect(s.hasBusinessData).toBe(false);
    expect(s.avgUnitCostUSD).toBe(0);
    expect(s.scaleEfficiencyStatus).toBe("Unknown");
  });

  it("no afirma economía de escala con muy pocos puntos", () => {
    const s = buildSummary({ series: series.slice(0, 2), config: cfg(), services: [] });
    expect(s.scaleEfficiencyStatus).toBe("Unknown");
  });

  it("el desvío frente a la meta es cero cuando no hay meta configurada", () => {
    const s = buildSummary({ series, config: cfg({ targetCostPerUnitUSD: 0 }), services: [] });
    expect(s.unitCostDeltaPercentage).toBe(0);
  });

  it("un resumen vacío no divide por cero", () => {
    const s = buildSummary({ series: [], config: cfg(), services: [] });
    expect(s.avgUnitCostUSD).toBe(0);
    expect(s.totalCloudSpendUSD).toBe(0);
    expect(s.volumeChangePercentage).toBe(0);
    expect(s.hasBusinessData).toBe(false);
  });
});

describe("Unit Economics — atribución por servicio", () => {
  it("reparte el costo unitario y calcula el porcentaje del gasto", () => {
    const items = attributeUnitCostByService(
      [
        { serviceName: "App Service", serviceCategory: "COMPUTE", monthlySpendUSD: 70, associatedResourcesCount: 3, dailySpend: [1, 2, 3, 4] },
        { serviceName: "MySQL", serviceCategory: "Base de Datos", monthlySpendUSD: 30, associatedResourcesCount: 1, dailySpend: [5, 5, 5, 5] },
      ],
      [10, 20, 30, 40],
      100,
      1000
    );
    expect(items[0].spendPercentage).toBe(70);
    expect(items[0].unitCostContributionUSD).toBe(0.07);
    expect(items[0].elasticityModel).toBe("Elastic");
    // Gasto plano frente a volumen creciente: costo fijo rígido.
    expect(items[1].elasticityModel).toBe("Fixed");
  });

  it("sin serie diaria la elasticidad queda en Fixed en vez de inventarse", () => {
    const items = attributeUnitCostByService(
      [{ serviceName: "X", serviceCategory: "Otros", monthlySpendUSD: 10, associatedResourcesCount: 0 }],
      [1, 2, 3],
      10,
      100
    );
    expect(items[0].volumeCorrelation).toBe(0);
    expect(items[0].elasticityModel).toBe("Fixed");
  });
});

describe("Unit Economics — recomendaciones", () => {
  it("sin denominador la única acción es cargar el dato, sin hallazgos simulados", () => {
    const s = buildSummary({ series: [point("2026-08-01", 100, 0)], config: cfg(), services: [] });
    const recs = generateUnitEconomicsRecommendations(s, cfg());
    expect(recs).toHaveLength(1);
    expect(recs[0].category).toBe("CONFIGURE_METRIC");
    expect(recs[0].actionType).toBe("CONFIGURE_METRIC");
  });

  it("propone convertir a elástico los servicios rígidos", () => {
    const services = attributeUnitCostByService(
      [{ serviceName: "VM Legacy", serviceCategory: "COMPUTE", monthlySpendUSD: 300, associatedResourcesCount: 2, dailySpend: [10, 10, 10, 10] }],
      [10, 40, 70, 100],
      300,
      1000
    );
    const s = buildSummary({ series: [point("2026-08-01", 300, 1000)], config: cfg(), services });
    const rec = generateUnitEconomicsRecommendations(s, cfg()).find((r) => r.category === "CONVERT_FIXED_TO_ELASTIC");
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(90); // 30% conservador de 300
    // El texto vive en el catálogo; lo que el servicio debe garantizar es que
    // manda los datos que la frase interpola.
    expect(rec!.params).toMatchObject({ service: "VM Legacy", unit: "DAU" });
  });

  it("señala el escalado peor que lineal cuando el costo unitario sube con el volumen", () => {
    const series = [
      point("2026-08-01", 100, 1000),
      point("2026-08-02", 100, 1000),
      point("2026-08-03", 100, 1000),
      point("2026-08-04", 260, 1500),
      point("2026-08-05", 260, 1500),
      point("2026-08-06", 260, 1500),
    ];
    const s = buildSummary({ series, config: cfg(), services: [] });
    expect(["Degrading", "Critical"]).toContain(s.scaleEfficiencyStatus);
    const rec = generateUnitEconomicsRecommendations(s, cfg()).find((r) => r.category === "SCALING_MISMATCH");
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(0);
  });

  it("pide definir la meta cuando no hay target, y alerta cuando se supera", () => {
    const s = buildSummary({ series: [point("2026-08-01", 100, 1000)], config: cfg({ targetCostPerUnitUSD: 0 }), services: [] });
    expect(
      generateUnitEconomicsRecommendations(s, cfg({ targetCostPerUnitUSD: 0 })).some((r) => r.actionType === "CONFIGURE_TARGET")
    ).toBe(true);

    // Costo real 0.10 contra meta 0.05 = +100%, muy por encima del umbral 15%.
    const s2 = buildSummary({ series: [point("2026-08-01", 100, 1000)], config: cfg({ targetCostPerUnitUSD: 0.05 }), services: [] });
    const alert = generateUnitEconomicsRecommendations(s2, cfg({ targetCostPerUnitUSD: 0.05 })).find(
      (r) => r.category === "CONFIGURE_UNIT_ALERT"
    );
    expect(alert).toBeDefined();
  });

  it("avisa de los días con gasto y sin volumen", () => {
    const s = buildSummary({
      series: [point("2026-08-01", 100, 1000), point("2026-08-02", 100, 0)],
      config: cfg(),
      services: [],
    });
    expect(generateUnitEconomicsRecommendations(s, cfg()).some((r) => r.actionType === "AUTOMATE_INGESTION")).toBe(true);
  });
});

describe("Unit Economics — validación de la ingesta", () => {
  it("acepta filas válidas y rechaza las malas con su motivo", () => {
    const { valid, rejected } = validateIngestBatch([
      { metricDate: "2026-08-21", metricType: "TRANSACTIONS", unitCount: 1200 },
      { metricDate: "21/08/2026", metricType: "DAU", unitCount: 10 },
      { metricDate: "2026-08-21", metricType: "INVENTADO", unitCount: 10 },
      { metricDate: "2026-08-21", metricType: "DAU", unitCount: -5 },
      { metricDate: "2026-08-21", metricType: "DAU", unitCount: "no-numero" },
      "esto no es un objeto",
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0].unitCount).toBe(1200);
    expect(rejected).toHaveLength(5);
    expect(rejected[0].reason).toContain("YYYY-MM-DD");
    expect(rejected[1].reason).toContain("metricType");
  });

  it("acepta alias de campo y un objeto suelto", () => {
    const { valid } = validateIngestBatch({ date: "2026-08-21", metricType: "API_CALLS", value: 900 });
    expect(valid).toHaveLength(1);
    expect(valid[0].metricType).toBe("API_CALLS");
  });

  it("acepta cero como volumen legítimo", () => {
    // Un día real con cero transacciones no es un dato inválido.
    const { valid } = validateIngestBatch([{ metricDate: "2026-08-21", metricType: "TRANSACTIONS", unitCount: 0 }]);
    expect(valid).toHaveLength(1);
  });

  it("valida el tipo de métrica contra la lista cerrada", () => {
    expect(isValidMetricType("AI_TOKENS")).toBe(true);
    expect(isValidMetricType("dau")).toBe(false);
    expect(isValidMetricType(null)).toBe(false);
    expect(normalizeMetricType("bad")).toBe("DAU");
    expect(normalizeIngestionMode("webhook")).toBe("Webhook");
    expect(normalizeIngestionMode(undefined)).toBe("Manual");
  });
});

describe("Unit Economics — payload demo", () => {
  it("genera una serie completa con economía de escala favorable", () => {
    const p = getMockUnitEconomicsPayload("demo-tenant-2222", 30);
    expect(p.source).toBe("mock");
    expect(p.series).toHaveLength(30);
    expect(p.summary.hasBusinessData).toBe(true);
    // El volumen crece más que el gasto: el costo unitario baja.
    expect(p.summary.scaleEfficiencyStatus).toBe("Optimal");
    expect(p.summary.servicesBreakdown.length).toBeGreaterThan(3);
  });

  it("incluye días sin volumen, que es el caso real más común", () => {
    const p = getMockUnitEconomicsPayload("demo-1111", 30);
    expect(p.summary.daysMissingBusinessData).toBeGreaterThan(0);
    // Esos días deben quedar en null, no en cero.
    expect(p.series.some((x) => x.unitCostUSD === null)).toBe(true);
  });

  it("escala por tier y cambia la métrica primaria en Enterprise", () => {
    const pro = getMockUnitEconomicsPayload("demo-1111");
    const ent = getMockUnitEconomicsPayload("demo-4444");
    expect(pro.config.primaryMetric).toBe("DAU");
    expect(ent.config.primaryMetric).toBe("TRANSACTIONS");
    expect(ent.summary.totalCloudSpendUSD).toBeGreaterThan(pro.summary.totalCloudSpendUSD);
  });

  it("es determinista entre llamadas", () => {
    const a = getMockUnitEconomicsPayload("demo-2222");
    const b = getMockUnitEconomicsPayload("demo-2222");
    expect(a.summary.avgUnitCostUSD).toBe(b.summary.avgUnitCostUSD);
    expect(a.series.map((x) => x.cloudCostUSD)).toEqual(b.series.map((x) => x.cloudCostUSD));
  });

  it("distingue servicios elásticos de rígidos en el dataset", () => {
    const p = getMockUnitEconomicsPayload("demo-4444");
    const models = new Set(p.summary.servicesBreakdown.map((s) => s.elasticityModel));
    expect(models.has("Elastic")).toBe(true);
    expect(models.has("Fixed")).toBe(true);
  });

  it("los porcentajes de gasto por servicio suman ~100%", () => {
    const p = getMockUnitEconomicsPayload("demo-4444");
    const pct = p.summary.servicesBreakdown.reduce((a, s) => a + s.spendPercentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
  });

  it("respeta la ventana solicitada", () => {
    expect(getMockUnitEconomicsPayload("demo-2222", 90).series).toHaveLength(90);
    expect(getMockUnitEconomicsPayload("demo-2222", 90).windowDays).toBe(90);
  });

  it("mapea las categorías a la paleta azul, con fallback", () => {
    expect(categoryColor("COMPUTE")).toBe("#0078D4");
    // El fallback sigue haciendo falta: un payload cacheado de antes de tokenizar
    // las categorías trae "Cómputo", que ya no está en el mapa.
    expect(categoryColor("Cómputo" as UeServiceCategory)).toBe("#94A3B8");
  });
});
