/**
 * Unit Economics — Costo Cloud contra Valor de Negocio
 *
 * RBAC mínimo: `Cost Management Reader` sobre las suscripciones (serie diaria de
 * gasto) y `Reader` para el inventario por servicio. El denominador de negocio
 * NO viene de Azure: vive en `TenantUnitMetrics`, que el tenant carga a mano o
 * ingiere por webhook.
 *
 * Esa asimetría define el módulo. El costo unitario es la única métrica FinOps
 * que no se puede calcular con datos de Azure solos, así que cuando falta el
 * denominador el servicio lo DECLARA (`hasBusinessData`, `daysMissingBusinessData`)
 * en vez de estimarlo: un costo unitario inventado es peor que ninguno, porque
 * se usa para decidir arquitectura.
 */

import { Decimal } from "decimal.js";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  ELASTICITY_THRESHOLD,
  UE_CATEGORY_COLORS,
  UNIT_METRIC_CATALOG,
  type ElasticityModel,
  type IngestionMode,
  type ScaleEfficiencyStatus,
  type ServiceUnitCostItem,
  type UnitEconomicsConfig,
  type UnitEconomicsDataPoint,
  type UnitEconomicsPayload,
  type UnitEconomicsRemediationAction,
  type UnitEconomicsSummary,
  type UnitMetricType,
} from "@/types/azureUnitEconomics.types";

const VALID_METRICS: UnitMetricType[] = ["DAU", "MAU", "TRANSACTIONS", "API_CALLS", "AI_TOKENS", "STORAGE_TB"];

// ─────────────────────────────────────────────────────────────────────────────
// Normalización y validación
// ─────────────────────────────────────────────────────────────────────────────

export function isValidMetricType(raw: unknown): raw is UnitMetricType {
  return typeof raw === "string" && (VALID_METRICS as string[]).includes(raw);
}

export function normalizeMetricType(raw: unknown): UnitMetricType {
  return isValidMetricType(raw) ? raw : "DAU";
}

export function normalizeIngestionMode(raw: unknown): IngestionMode {
  const v = String(raw || "").toLowerCase();
  if (v === "webhook") return "Webhook";
  if (v === "csv") return "Csv";
  return "Manual";
}

/**
 * Calcula el costo unitario del día con `decimal.js` (Regla Cero: nada de
 * floats en cálculos de costo). Devuelve `null` sin denominador, no cero:
 * un cero se lee como "eficiencia perfecta" cuando en realidad falta el dato.
 */
export function calcUnitCost(cloudCostUSD: number, businessUnits: number, scale = 1): number | null {
  if (!Number.isFinite(businessUnits) || businessUnits <= 0) return null;
  if (!Number.isFinite(cloudCostUSD)) return null;
  const normalizedUnits = new Decimal(businessUnits).div(scale);
  if (normalizedUnits.lte(0)) return null;
  // 8 decimales: el costo por llamada API o por token puede ser ~0.00001 USD.
  return new Decimal(cloudCostUSD).div(normalizedUnits).toDecimalPlaces(8).toNumber();
}

/** Variación porcentual entre dos valores; `0` cuando la base es cero. */
export function percentDelta(current: number, baseline: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return 0;
  return new Decimal(current).minus(baseline).div(Math.abs(baseline)).times(100).toDecimalPlaces(2).toNumber();
}

// ─────────────────────────────────────────────────────────────────────────────
// Elasticidad y economía de escala
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Correlación de Pearson entre gasto y volumen. Mide si el gasto de un servicio
 * sigue al negocio (elástico) o se mantiene plano (fijo).
 * Devuelve 0 con menos de tres puntos o varianza nula: afirmar correlación con
 * dos muestras sería ruido presentado como señal.
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return Number((num / Math.sqrt(dx * dy)).toFixed(4));
}

/** Coeficiente de variación (desvío estándar / media). 0 si la media es cero. */
export function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/**
 * Elasticidad real: cuánto varía el gasto en términos RELATIVOS por cada punto
 * de variación relativa del volumen.
 *
 * No se usa la correlación de Pearson para esto, y la distinción importa: la
 * correlación es invariante a la escala, así que un servicio cuyo gasto varía un
 * 1% pero perfectamente sincronizado con el volumen da correlación 1.0 y se
 * clasificaría como elástico cuando en realidad es un costo fijo con ruido.
 * La razón de coeficientes de variación sí captura la magnitud.
 *
 * Devuelve 0 cuando el volumen no varía: sin movimiento en el denominador no
 * hay elasticidad que medir.
 */
export function calcElasticityRatio(dailySpend: number[], dailyUnits: number[]): number {
  const n = Math.min(dailySpend.length, dailyUnits.length);
  if (n < 3) return 0;
  const cvUnits = coefficientOfVariation(dailyUnits.slice(0, n));
  if (cvUnits === 0) return 0;
  return Number((coefficientOfVariation(dailySpend.slice(0, n)) / cvUnits).toFixed(4));
}

/**
 * Clasifica la elasticidad de un servicio. Un servicio elástico (Container Apps,
 * Functions) sube y baja con el negocio; uno fijo (una VM encendida 24/7) cuesta
 * lo mismo con 10 o con 10.000 usuarios, y es el que castiga el costo unitario
 * en los valles.
 */
export function deriveElasticity(elasticityRatio: number): ElasticityModel {
  const abs = Math.abs(elasticityRatio);
  if (abs >= 0.7) return "Elastic";
  if (abs >= ELASTICITY_THRESHOLD) return "Semi-Elastic";
  return "Fixed";
}

/**
 * Economía de escala: compara la primera mitad del período con la segunda.
 * Lo deseable es que el volumen suba y el costo unitario baje.
 */
export function deriveScaleEfficiency(
  volumeChangePct: number,
  unitCostChangePct: number
): ScaleEfficiencyStatus {
  // Sin movimiento de volumen no hay nada que afirmar sobre escala.
  if (Math.abs(volumeChangePct) < 5) return "Unknown";
  if (volumeChangePct > 0) {
    if (unitCostChangePct <= 0) return "Optimal"; // más volumen, menor costo unitario
    // Que el costo unitario suba junto con el volumen es ineficiencia
    // arquitectónica: algo escala peor que linealmente.
    return unitCostChangePct > 10 ? "Critical" : "Degrading";
  }
  // Con el volumen cayendo, que el costo unitario suba es esperable (los costos
  // fijos se reparten entre menos unidades): no se marca como crítico.
  return unitCostChangePct > 25 ? "Degrading" : "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregación
// ─────────────────────────────────────────────────────────────────────────────

export function buildSummary(input: {
  series: UnitEconomicsDataPoint[];
  config: UnitEconomicsConfig;
  services: ServiceUnitCostItem[];
  previousPeriodAvgUnitCost?: number | null;
}): UnitEconomicsSummary {
  const { series, config, services } = input;
  const meta = UNIT_METRIC_CATALOG[config.primaryMetric];

  const totalCloudSpend = series.reduce((a, p) => a + p.cloudCostUSD, 0);
  const totalUnits = series.reduce((a, p) => a + p.businessUnitsCount, 0);
  const withData = series.filter((p) => p.unitCostUSD !== null);

  // El promedio se calcula sobre el total del período, no promediando promedios
  // diarios: un día de bajo volumen distorsionaría el resultado.
  const avgUnitCost = calcUnitCost(totalCloudSpend, totalUnits, meta.scale) ?? 0;

  // Mitades del período, para medir economía de escala.
  const half = Math.floor(series.length / 2);
  const firstHalf = series.slice(0, half);
  const secondHalf = series.slice(half);
  const sumUnits = (arr: UnitEconomicsDataPoint[]) => arr.reduce((a, p) => a + p.businessUnitsCount, 0);
  const sumCost = (arr: UnitEconomicsDataPoint[]) => arr.reduce((a, p) => a + p.cloudCostUSD, 0);

  const volumeChangePercentage = percentDelta(sumUnits(secondHalf), sumUnits(firstHalf));
  const firstUnitCost = calcUnitCost(sumCost(firstHalf), sumUnits(firstHalf), meta.scale);
  const secondUnitCost = calcUnitCost(sumCost(secondHalf), sumUnits(secondHalf), meta.scale);
  const unitCostChangePercentage =
    firstUnitCost !== null && secondUnitCost !== null ? percentDelta(secondUnitCost, firstUnitCost) : 0;

  return {
    activeMetricType: config.primaryMetric,
    metricDisplayName: meta.displayName,
    unitLabel: meta.unitSingular,
    avgUnitCostUSD: avgUnitCost,
    targetUnitCostUSD: config.targetCostPerUnitUSD,
    unitCostDeltaPercentage:
      config.targetCostPerUnitUSD > 0 ? percentDelta(avgUnitCost, config.targetCostPerUnitUSD) : 0,
    periodOverPeriodDeltaPercentage:
      input.previousPeriodAvgUnitCost && input.previousPeriodAvgUnitCost > 0
        ? percentDelta(avgUnitCost, input.previousPeriodAvgUnitCost)
        : 0,
    totalCloudSpendUSD: Number(totalCloudSpend.toFixed(2)),
    totalBusinessUnits: Number(totalUnits.toFixed(2)),
    scaleEfficiencyStatus:
      withData.length >= 6 ? deriveScaleEfficiency(volumeChangePercentage, unitCostChangePercentage) : "Unknown",
    volumeChangePercentage,
    unitCostChangePercentage,
    servicesBreakdown: services.slice().sort((a, b) => b.monthlySpendUSD - a.monthlySpendUSD),
    daysMissingBusinessData: series.filter((p) => p.cloudCostUSD > 0 && p.businessUnitsCount <= 0).length,
    hasBusinessData: totalUnits > 0,
  };
}

/** Atribuye a cada servicio su porción del costo unitario. */
export function attributeUnitCostByService(
  services: Array<{
    serviceName: string;
    serviceCategory: string;
    monthlySpendUSD: number;
    associatedResourcesCount: number;
    dailySpend?: number[];
  }>,
  dailyUnits: number[],
  totalCloudSpendUSD: number,
  totalBusinessUnits: number,
  scale = 1
): ServiceUnitCostItem[] {
  return services.map((s) => {
    // La correlación se conserva porque es informativa para el operador (dice
    // si el gasto acompaña o va a contramano), pero la CLASIFICACIÓN usa el
    // ratio de variación, que es la definición económica de elasticidad.
    const volumeCorrelation = s.dailySpend ? pearsonCorrelation(s.dailySpend, dailyUnits) : 0;
    const elasticityRatio = s.dailySpend ? calcElasticityRatio(s.dailySpend, dailyUnits) : 0;
    return {
      serviceName: s.serviceName,
      serviceCategory: s.serviceCategory,
      monthlySpendUSD: Number(s.monthlySpendUSD.toFixed(2)),
      spendPercentage:
        totalCloudSpendUSD > 0 ? Number(((s.monthlySpendUSD / totalCloudSpendUSD) * 100).toFixed(1)) : 0,
      unitCostContributionUSD: calcUnitCost(s.monthlySpendUSD, totalBusinessUnits, scale) ?? 0,
      elasticityModel: deriveElasticity(elasticityRatio),
      associatedResourcesCount: s.associatedResourcesCount,
      volumeCorrelation,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de recomendaciones
// ─────────────────────────────────────────────────────────────────────────────

export function generateUnitEconomicsRecommendations(
  summary: UnitEconomicsSummary,
  config: UnitEconomicsConfig
): UnitEconomicsRemediationAction[] {
  const out: UnitEconomicsRemediationAction[] = [];

  // Sin denominador no hay economía unitaria que analizar: la única acción útil
  // es cargar el dato, y no se simulan hallazgos sobre datos que no existen.
  if (!summary.hasBusinessData) {
    out.push({
      id: "configure-metric",
      targetId: config.primaryMetric,
      targetName: summary.metricDisplayName,
      title: "Cargar el volumen de negocio para activar Unit Economics",
      description:
        "El costo unitario es la única métrica FinOps que no se puede calcular solo con datos de Azure: hace falta el denominador de negocio, que vive en tus sistemas. Cargalo a mano en la configuración, o automatizá el envío diario contra el endpoint de ingesta desde tu pipeline. Hasta entonces el módulo muestra el gasto pero no puede dividirlo.",
      category: "SET_TARGET_COST",
      estimatedSavingsUSD: 0,
      confidence: "HIGH",
      actionType: "CONFIGURE_METRIC",
    });
    return out;
  }

  // Servicios rígidos: son los que castigan el costo unitario en los valles.
  const fixed = summary.servicesBreakdown.filter((s) => s.elasticityModel === "Fixed" && s.monthlySpendUSD > 0);
  for (const s of fixed.slice(0, 3)) {
    // Migrar a un modelo elástico recorta el gasto en las horas valle. Se usa un
    // 30% conservador: el ahorro real depende del perfil de carga, y prometer
    // más sin medirlo sería inventar.
    const saving = new Decimal(s.monthlySpendUSD).times(0.3).toDecimalPlaces(2).toNumber();
    out.push({
      id: `elastic-${s.serviceName}`,
      targetId: s.serviceName,
      targetName: s.serviceName,
      title: `Convertir ${s.serviceName} a un modelo elástico`,
      description: `Su gasto no correlaciona con el volumen de negocio (correlación ${s.volumeCorrelation.toFixed(
        2
      )}): cuesta lo mismo con el pico que con el valle, y aporta ${s.unitCostContributionUSD.toFixed(
        6
      )} USD por ${summary.unitLabel} incluso cuando nadie lo usa. Migrar a Container Apps, Functions o escalado automático hace que el costo siga al negocio. Verificar antes que la carga tolere arranques en frío.`,
      category: "CONVERT_FIXED_TO_ELASTIC",
      estimatedSavingsUSD: saving,
      confidence: "MEDIUM",
      actionType: "MIGRATE_TO_ELASTIC",
    });
  }

  // Ineficiencia arquitectónica: el costo unitario sube junto con el volumen.
  if (summary.scaleEfficiencyStatus === "Critical" || summary.scaleEfficiencyStatus === "Degrading") {
    const worst = summary.servicesBreakdown
      .filter((s) => s.volumeCorrelation > 0.7)
      .sort((a, b) => b.monthlySpendUSD - a.monthlySpendUSD)[0];
    out.push({
      id: "scaling-mismatch",
      targetId: worst?.serviceName || "arquitectura",
      targetName: worst?.serviceName || "Arquitectura general",
      title: `Costo unitario en alza pese al crecimiento (+${summary.volumeChangePercentage.toFixed(1)}% de volumen)`,
      description: `El volumen creció ${summary.volumeChangePercentage.toFixed(
        1
      )}% y el costo por ${summary.unitLabel} subió ${summary.unitCostChangePercentage.toFixed(
        1
      )}% en vez de bajar. Eso es escalado peor que lineal: algún componente crece más rápido que el negocio.${
        worst
          ? ` El candidato más probable es ${worst.serviceName}, que concentra ${worst.spendPercentage}% del gasto con correlación ${worst.volumeCorrelation.toFixed(2)}.`
          : ""
      } Revisar consultas N+1, falta de caché o sobre-aprovisionamiento reactivo.`,
      category: "SCALING_MISMATCH",
      estimatedSavingsUSD: 0,
      confidence: "MEDIUM",
      actionType: "REVIEW_ARCHITECTURE",
    });
  }

  // Meta sin configurar: sin target no hay forma de saber si el número es bueno.
  if (config.targetCostPerUnitUSD <= 0) {
    out.push({
      id: "set-target",
      targetId: config.primaryMetric,
      targetName: summary.metricDisplayName,
      title: "Definir el costo unitario objetivo",
      description: `El costo actual es ${summary.avgUnitCostUSD.toFixed(6)} USD por ${
        summary.unitLabel
      }, pero sin una meta no hay forma de saber si eso es bueno o malo. Un target convierte la métrica en una decisión: por encima se investiga, por debajo se libera presupuesto. Un punto de partida razonable es el promedio actual menos el ahorro que ya tengas identificado.`,
      category: "SET_TARGET_COST",
      estimatedSavingsUSD: 0,
      confidence: "HIGH",
      actionType: "CONFIGURE_TARGET",
    });
  } else if (summary.unitCostDeltaPercentage > config.alertThresholdPercentage) {
    out.push({
      id: "alert-threshold",
      targetId: config.primaryMetric,
      targetName: summary.metricDisplayName,
      title: `Costo unitario ${summary.unitCostDeltaPercentage.toFixed(1)}% por encima de la meta`,
      description: `El promedio del período (${summary.avgUnitCostUSD.toFixed(
        6
      )} USD) supera la meta de ${config.targetCostPerUnitUSD.toFixed(6)} USD por ${
        summary.unitLabel
      } más allá del umbral configurado (${config.alertThresholdPercentage}%). Configurar una alerta automática sobre esta métrica evita que el desvío se descubra recién en la factura.`,
      category: "CONFIGURE_UNIT_ALERT",
      estimatedSavingsUSD: 0,
      confidence: "HIGH",
      actionType: "CREATE_UNIT_ALERT",
    });
  }

  // Días con gasto y sin denominador: erosionan la confianza en la métrica.
  if (summary.daysMissingBusinessData > 0) {
    out.push({
      id: "missing-data",
      targetId: config.primaryMetric,
      targetName: summary.metricDisplayName,
      title: `${summary.daysMissingBusinessData} día(s) con gasto y sin volumen cargado`,
      description: `Esos días quedan fuera del promedio porque dividir por cero no es una opción, y el gráfico los muestra con un hueco en vez de con un cero engañoso. Automatizar la ingesta diaria desde el pipeline elimina el problema de raíz.`,
      category: "SET_TARGET_COST",
      estimatedSavingsUSD: 0,
      confidence: "MEDIUM",
      actionType: "AUTOMATE_INGESTION",
    });
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = (tenantId: string): UnitEconomicsConfig => ({
  tenantId,
  primaryMetric: "DAU",
  targetCostPerUnitUSD: 0,
  alertThresholdPercentage: 15,
  ingestionMode: "Manual",
});

export async function getTenantConfig(tenantId: string): Promise<UnitEconomicsConfig> {
  try {
    const [rows] = await pool.query(
      `SELECT primary_metric, target_cost_per_unit_usd, alert_threshold_percentage, ingestion_mode
       FROM TenantUnitEconomicsConfig WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    );
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
    if (!row) return DEFAULT_CONFIG(tenantId);
    return {
      tenantId,
      primaryMetric: normalizeMetricType(row.primary_metric),
      targetCostPerUnitUSD: Number(row.target_cost_per_unit_usd) || 0,
      alertThresholdPercentage: Number(row.alert_threshold_percentage) || 15,
      ingestionMode: normalizeIngestionMode(row.ingestion_mode),
    };
  } catch (error) {
    console.warn("[azureUnitEconomics.service] getTenantConfig:", errorMessage(error));
    return DEFAULT_CONFIG(tenantId);
  }
}

export async function saveTenantConfig(config: UnitEconomicsConfig): Promise<void> {
  await pool.query(
    `INSERT INTO TenantUnitEconomicsConfig
       (tenant_id, primary_metric, target_cost_per_unit_usd, alert_threshold_percentage, ingestion_mode)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       primary_metric = VALUES(primary_metric),
       target_cost_per_unit_usd = VALUES(target_cost_per_unit_usd),
       alert_threshold_percentage = VALUES(alert_threshold_percentage),
       ingestion_mode = VALUES(ingestion_mode)`,
    [
      config.tenantId,
      config.primaryMetric,
      config.targetCostPerUnitUSD,
      config.alertThresholdPercentage,
      config.ingestionMode,
    ]
  );
}

/** Serie de unidades de negocio por fecha, para la métrica indicada. */
export async function getBusinessUnits(
  tenantId: string,
  metricType: UnitMetricType,
  fromDate: string,
  toDate: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(metric_date, '%Y-%m-%d') AS d, unit_count
       FROM TenantUnitMetrics
       WHERE tenant_id = ? AND metric_type = ? AND metric_date BETWEEN ? AND ?`,
      [tenantId, metricType, fromDate, toDate]
    );
    for (const r of rows as Array<{ d: string; unit_count: string }>) {
      out.set(r.d, Number(r.unit_count) || 0);
    }
  } catch (error) {
    console.warn("[azureUnitEconomics.service] getBusinessUnits:", errorMessage(error));
  }
  return out;
}

/**
 * Inserta o actualiza el volumen de un día. Usado por la carga manual y por el
 * endpoint de ingesta.
 */
export async function upsertBusinessUnits(input: {
  tenantId: string;
  metricDate: string;
  metricType: UnitMetricType;
  unitCount: number;
  source: IngestionMode;
  notes?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO TenantUnitMetrics (tenant_id, metric_date, metric_type, unit_count, source, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE unit_count = VALUES(unit_count), source = VALUES(source), notes = VALUES(notes)`,
    [input.tenantId, input.metricDate, input.metricType, input.unitCount, input.source, input.notes || null]
  );
}

/** Valida un lote de ingesta y separa filas buenas de rechazadas con su motivo. */
export function validateIngestBatch(
  raw: unknown
): { valid: Array<{ metricDate: string; metricType: UnitMetricType; unitCount: number }>; rejected: Array<{ index: number; reason: string }> } {
  const valid: Array<{ metricDate: string; metricType: UnitMetricType; unitCount: number }> = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const items = Array.isArray(raw) ? raw : [raw];

  items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      rejected.push({ index, reason: "El elemento no es un objeto" });
      return;
    }
    const o = item as Record<string, unknown>;
    const metricDate = String(o.metricDate || o.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) {
      rejected.push({ index, reason: "metricDate debe tener formato YYYY-MM-DD" });
      return;
    }
    if (!isValidMetricType(o.metricType)) {
      rejected.push({ index, reason: `metricType inválido: ${String(o.metricType)}` });
      return;
    }
    const unitCount = Number(o.unitCount ?? o.units ?? o.value);
    if (!Number.isFinite(unitCount) || unitCount < 0) {
      rejected.push({ index, reason: "unitCount debe ser un número >= 0" });
      return;
    }
    valid.push({ metricDate, metricType: o.metricType, unitCount });
  });

  return { valid, rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintético por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

export function getMockUnitEconomicsPayload(tenantId: string, windowDays = 30): UnitEconomicsPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const config: UnitEconomicsConfig = {
    tenantId,
    primaryMetric: isEnterprise ? "TRANSACTIONS" : "DAU",
    targetCostPerUnitUSD: isEnterprise ? 0.04 : 0.2,
    alertThresholdPercentage: 15,
    ingestionMode: isBusiness ? "Webhook" : "Manual",
  };

  const meta = UNIT_METRIC_CATALOG[config.primaryMetric];
  const baseSpend = isEnterprise ? 640 : isBusiness ? 320 : 180;
  const baseUnits = isEnterprise ? 14_000 : isBusiness ? 2_400 : 900;

  // Serie determinista (sin Math.random) para que la demo sea estable. El
  // volumen crece a lo largo del período y el gasto lo sigue parcialmente, de
  // modo que el costo unitario baja: economía de escala favorable.
  const series: UnitEconomicsDataPoint[] = Array.from({ length: windowDays }, (_, i) => {
    const t = i / Math.max(1, windowDays - 1);
    const weekly = 1 + 0.12 * Math.sin((i / 7) * Math.PI * 2);
    const units = Math.round(baseUnits * (1 + 0.35 * t) * weekly);
    // El gasto sube menos que el volumen: ahí está la economía de escala.
    const cost = Number((baseSpend * (1 + 0.14 * t) * weekly).toFixed(2));
    // Un par de días sin volumen cargado, que es el caso real más común.
    const missing = i === 9 || i === 17;
    const businessUnitsCount = missing ? 0 : units;
    return {
      date: new Date(Date.now() - (windowDays - 1 - i) * 86400000).toISOString().slice(0, 10),
      cloudCostUSD: cost,
      businessUnitsCount,
      unitCostUSD: calcUnitCost(cost, businessUnitsCount, meta.scale),
      targetUnitCostUSD: config.targetCostPerUnitUSD,
    };
  });

  const dailyUnits = series.map((p) => p.businessUnitsCount);
  const totalSpend = series.reduce((a, p) => a + p.cloudCostUSD, 0);
  const totalUnits = series.reduce((a, p) => a + p.businessUnitsCount, 0);

  // Servicios con perfiles de gasto distintos: los elásticos siguen al volumen,
  // los fijos son planos.
  const svcDefs: Array<{
    serviceName: string;
    serviceCategory: string;
    share: number;
    associatedResourcesCount: number;
    /** 1 = sigue al volumen, 0 = plano. */
    elasticity: number;
  }> = [
    { serviceName: "Azure App Service", serviceCategory: "Cómputo", share: 0.42, associatedResourcesCount: 6, elasticity: 0.95 },
    { serviceName: "Azure Database for MySQL", serviceCategory: "Base de Datos", share: 0.28, associatedResourcesCount: 2, elasticity: 0.05 },
    { serviceName: "Azure Cache for Redis", serviceCategory: "Base de Datos", share: 0.12, associatedResourcesCount: 1, elasticity: 0.02 },
    { serviceName: "Azure Storage", serviceCategory: "Almacenamiento", share: 0.08, associatedResourcesCount: 9, elasticity: 0.55 },
    { serviceName: "Azure Front Door", serviceCategory: "Redes", share: 0.1, associatedResourcesCount: 1, elasticity: 0.9 },
  ];
  if (isEnterprise) {
    svcDefs.push({ serviceName: "Azure OpenAI", serviceCategory: "IA", share: 0.15, associatedResourcesCount: 3, elasticity: 0.98 });
  }

  const shareTotal = svcDefs.reduce((a, s) => a + s.share, 0);
  const services = attributeUnitCostByService(
    svcDefs.map((s) => {
      const monthlySpendUSD = (totalSpend * s.share) / shareTotal;
      // Perfil diario: mezcla entre seguir el volumen y ser plano.
      const flat = monthlySpendUSD / windowDays;
      const dailySpend = dailyUnits.map((u) => {
        const volumeFactor = totalUnits > 0 ? (u * windowDays) / totalUnits : 1;
        return flat * (s.elasticity * volumeFactor + (1 - s.elasticity));
      });
      return {
        serviceName: s.serviceName,
        serviceCategory: s.serviceCategory,
        monthlySpendUSD,
        associatedResourcesCount: s.associatedResourcesCount,
        dailySpend,
      };
    }),
    dailyUnits,
    totalSpend,
    totalUnits,
    meta.scale
  );

  const summary = buildSummary({ series, config, services });
  const remediations = generateUnitEconomicsRecommendations(summary, config);

  return {
    summary,
    config,
    series,
    remediations,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    windowDays,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado vivo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combina la serie diaria de gasto de Azure con el volumen de negocio del
 * tenant. El gasto lo provee el llamador (la ruta ya resuelve Cost Management y
 * su caché), de modo que este servicio queda testeable sin tocar Azure.
 *
 * Nunca inventa el denominador: si no hay unidades para un día, `unitCostUSD`
 * queda en `null` y el resumen lo cuenta en `daysMissingBusinessData`.
 */
export async function assembleLiveUnitEconomics(input: {
  tenantId: string;
  windowDays: number;
  dailyCosts: Map<string, number>;
  serviceSpend: Array<{
    serviceName: string;
    serviceCategory: string;
    monthlySpendUSD: number;
    associatedResourcesCount: number;
    dailySpend?: number[];
  }>;
}): Promise<UnitEconomicsPayload> {
  const { tenantId, windowDays, dailyCosts, serviceSpend } = input;
  const config = await getTenantConfig(tenantId);
  const meta = UNIT_METRIC_CATALOG[config.primaryMetric];

  const dates = Array.from({ length: windowDays }, (_, i) =>
    new Date(Date.now() - (windowDays - 1 - i) * 86400000).toISOString().slice(0, 10)
  );
  const units = await getBusinessUnits(tenantId, config.primaryMetric, dates[0], dates[dates.length - 1]);

  const series: UnitEconomicsDataPoint[] = dates.map((date) => {
    const cloudCostUSD = Number((dailyCosts.get(date) || 0).toFixed(2));
    const businessUnitsCount = units.get(date) || 0;
    return {
      date,
      cloudCostUSD,
      businessUnitsCount,
      unitCostUSD: calcUnitCost(cloudCostUSD, businessUnitsCount, meta.scale),
      targetUnitCostUSD: config.targetCostPerUnitUSD > 0 ? config.targetCostPerUnitUSD : undefined,
    };
  });

  const totalSpend = series.reduce((a, p) => a + p.cloudCostUSD, 0);
  const totalUnits = series.reduce((a, p) => a + p.businessUnitsCount, 0);
  const services = attributeUnitCostByService(
    serviceSpend,
    series.map((p) => p.businessUnitsCount),
    totalSpend,
    totalUnits,
    meta.scale
  );

  const summary = buildSummary({ series, config, services });
  const remediations = generateUnitEconomicsRecommendations(summary, config);

  return {
    summary,
    config,
    series,
    remediations,
    source: "live",
    lastUpdated: new Date().toISOString(),
    windowDays,
  };
}

/** Colores por categoría, reexportado para que la UI no importe el mapa crudo. */
export function categoryColor(category: string): string {
  return UE_CATEGORY_COLORS[category] || UE_CATEGORY_COLORS["Otros"];
}
