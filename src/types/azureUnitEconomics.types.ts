/**
 * TypeScript Contracts for Unit Economics — Costo Cloud contra Valor de Negocio
 *
 * El costo unitario es la única métrica FinOps que no se puede calcular con
 * datos de Azure solos: hace falta el denominador de negocio (usuarios,
 * transacciones, tokens), que vive en el sistema del cliente. Por eso el módulo
 * combina Cost Management con la tabla `TenantUnitMetrics` y declara
 * explícitamente cuándo falta el denominador, en vez de estimarlo.
 */

export type UnitMetricType = "DAU" | "MAU" | "TRANSACTIONS" | "API_CALLS" | "AI_TOKENS" | "STORAGE_TB";

export type ElasticityModel = "Elastic" | "Semi-Elastic" | "Fixed";

export type ScaleEfficiencyStatus = "Optimal" | "Degrading" | "Critical" | "Unknown";

export type IngestionMode = "Manual" | "Webhook" | "Csv";

export const UNIT_ECONOMICS_REMEDIATION_CATEGORIES = [
  "CONVERT_FIXED_TO_ELASTIC",
  "SCALING_MISMATCH",
  "CONFIGURE_UNIT_ALERT",
  // SET_TARGET_COST cubria tres recomendaciones distintas (cargar la metrica,
  // definir la meta, automatizar la ingesta), asi que no servia para derivar
  // el texto de ninguna. Se parte en tres.
  "SET_TARGET_COST",
  "CONFIGURE_METRIC",
  "AUTOMATE_INGESTION",
] as const;

export type UnitEconomicsRemediationCategory =
  (typeof UNIT_ECONOMICS_REMEDIATION_CATEGORIES)[number];

/**
 * Divisor para normalizar cada metrica (p. ej. tokens en millones).
 *
 * Los nombres visibles no viven aca: cuelgan del catalogo como
 * `metric_<METRICA>_name` / `_unit` / `_unitOne`. Tenerlos en el modulo los
 * congelaba en castellano para los tres idiomas, y ademas viajaban hasta las
 * descripciones de las recomendaciones.
 */
export const UNIT_METRIC_CATALOG: Record<UnitMetricType, { scale: number }> = {
  DAU: { scale: 1 },
  MAU: { scale: 1 },
  TRANSACTIONS: { scale: 1 },
  API_CALLS: { scale: 1_000_000 },
  AI_TOKENS: { scale: 1_000_000 },
  STORAGE_TB: { scale: 1 },
};

/**
 * Umbral de variación del costo unitario frente al volumen que separa un
 * servicio elástico de uno rígido. Un servicio elástico sigue al volumen: su
 * costo unitario se mantiene plano. Uno fijo diluye su costo unitario al crecer
 * el volumen, y lo dispara al caer.
 */
export const ELASTICITY_THRESHOLD = 0.35;

/** Punto diario de la serie de economía unitaria. */
export interface UnitEconomicsDataPoint {
  date: string;
  cloudCostUSD: number;
  businessUnitsCount: number;
  /**
   * Costo por unidad de negocio, en USD. `null` cuando no hay denominador ese
   * día: graficar cero fingiría eficiencia perfecta justo donde faltan datos.
   */
  unitCostUSD: number | null;
  targetUnitCostUSD?: number;
}

export interface ServiceUnitCostItem {
  serviceName: string;
  serviceCategory: UeServiceCategory;
  monthlySpendUSD: number;
  spendPercentage: number;
  /** Porción del costo unitario atribuible a este servicio. */
  unitCostContributionUSD: number;
  elasticityModel: ElasticityModel;
  associatedResourcesCount: number;
  /** Correlación entre el gasto del servicio y el volumen de negocio, -1..1. */
  volumeCorrelation: number;
}

export interface UnitEconomicsSummary {
  activeMetricType: UnitMetricType;
  avgUnitCostUSD: number;
  targetUnitCostUSD: number;
  /** Desvío del costo unitario frente a la meta, en %. Positivo = por encima. */
  unitCostDeltaPercentage: number;
  /** Variación frente al período anterior de igual largo, en %. */
  periodOverPeriodDeltaPercentage: number;
  totalCloudSpendUSD: number;
  totalBusinessUnits: number;
  scaleEfficiencyStatus: ScaleEfficiencyStatus;
  /** Variación del volumen entre la primera y la segunda mitad del período, en %. */
  volumeChangePercentage: number;
  /** Variación del costo unitario entre esas mismas mitades, en %. */
  unitCostChangePercentage: number;
  servicesBreakdown: ServiceUnitCostItem[];
  /** Días del período con costo pero sin denominador de negocio cargado. */
  daysMissingBusinessData: number;
  /** `false` cuando el tenant nunca cargó unidades: la UI pide configuración. */
  hasBusinessData: boolean;
}

export interface UnitEconomicsConfig {
  tenantId: string;
  primaryMetric: UnitMetricType;
  targetCostPerUnitUSD: number;
  alertThresholdPercentage: number;
  ingestionMode: IngestionMode;
}

export interface UnitEconomicsRemediationAction {
  id: string;
  targetId: string;
  targetName: string;
  /** Valores a interpolar en `rem_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  category: UnitEconomicsRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface UnitEconomicsPayload {
  summary: UnitEconomicsSummary;
  config: UnitEconomicsConfig;
  series: UnitEconomicsDataPoint[];
  remediations: UnitEconomicsRemediationAction[];
  source: "live" | "mock";
  lastUpdated: string;
  /** Ventana analizada en días. */
  windowDays: number;
}

/** Paleta institucional en tonos de azul para el gráfico de doble eje. */
export const UE_COLORS = {
  /** Barras de gasto nube diario: azul hielo, va al fondo. */
  cloudSpendBars: "#93C5FD",
  /** Línea de costo unitario: azul corporativo, es la protagonista. */
  unitCostLine: "#0078D4",
  /** Línea de meta: cobalto punteado. */
  targetLine: "#2563EB",
  /** Volumen de unidades de negocio: cian. */
  volume: "#0284C7",
} as const;

/** Colores por categoría de servicio, en la misma escala azul. */
/**
 * Categorias de servicio como token, no como rotulo. Antes eran las cadenas en
 * castellano ("Cómputo", "Base de Datos"), y se usaban a la vez como clave de
 * este mapa y como texto de la columna: en ingles y portugues la tabla mostraba
 * castellano. El nombre visible cuelga del catalogo en `svccat_<TOKEN>`.
 */
export const UE_SERVICE_CATEGORIES = [
  "COMPUTE",
  "DATABASE",
  "STORAGE",
  "NETWORK",
  "AI",
  "OTHER",
] as const;

export type UeServiceCategory = (typeof UE_SERVICE_CATEGORIES)[number];

export const UE_CATEGORY_COLORS: Record<UeServiceCategory, string> = {
  COMPUTE: "#0078D4",
  DATABASE: "#2563EB",
  STORAGE: "#0284C7",
  NETWORK: "#38BDF8",
  AI: "#93C5FD",
  OTHER: "#94A3B8",
};
