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

export type UnitEconomicsRemediationCategory =
  | "CONVERT_FIXED_TO_ELASTIC"
  | "SCALING_MISMATCH"
  | "CONFIGURE_UNIT_ALERT"
  | "SET_TARGET_COST";

/** Metadatos de presentación de cada métrica de negocio. */
export const UNIT_METRIC_CATALOG: Record<
  UnitMetricType,
  { displayName: string; unitLabel: string; unitSingular: string; /** Divisor para normalizar (p. ej. tokens en millones). */ scale: number }
> = {
  DAU: { displayName: "Usuarios Activos Diarios", unitLabel: "usuarios activos", unitSingular: "usuario activo", scale: 1 },
  MAU: { displayName: "Usuarios Activos Mensuales", unitLabel: "usuarios mensuales", unitSingular: "usuario mensual", scale: 1 },
  TRANSACTIONS: { displayName: "Transacciones / Pedidos", unitLabel: "transacciones", unitSingular: "transacción", scale: 1 },
  API_CALLS: { displayName: "Llamadas API", unitLabel: "millones de llamadas", unitSingular: "millón de llamadas", scale: 1_000_000 },
  AI_TOKENS: { displayName: "Tokens IA", unitLabel: "millones de tokens", unitSingular: "millón de tokens", scale: 1_000_000 },
  STORAGE_TB: { displayName: "Almacenamiento Productivo", unitLabel: "TB", unitSingular: "TB", scale: 1 },
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
  serviceCategory: string;
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
  metricDisplayName: string;
  unitLabel: string;
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
  title: string;
  description: string;
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
export const UE_CATEGORY_COLORS: Record<string, string> = {
  "Cómputo": "#0078D4",
  "Base de Datos": "#2563EB",
  "Almacenamiento": "#0284C7",
  "Redes": "#38BDF8",
  "IA": "#93C5FD",
  "Otros": "#94A3B8",
};
