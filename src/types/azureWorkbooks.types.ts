/**
 * TypeScript Contracts for Azure Monitor Workbooks Governance & Query Cost Attribution
 *
 * El recurso Workbook en si no tiene costo. El gasto que gobierna este modulo es
 * INDIRECTO: las consultas KQL embebidas escanean datos de Log Analytics, y el
 * auto-refresh multiplica ese escaneo por las ejecuciones del mes. Ver la nota
 * sobre tarifas en LOG_ANALYTICS_QUERY_SCAN_USD_PER_GB: el escaneo NO se cobra
 * en tier Analytics, solo en Basic Logs / archivo / search jobs.
 */

/**
 * Precio de ESCANEO de datos por consulta, USD/GB.
 *
 * OJO — no es $2.30. En Log Analytics tier *Analytics* las consultas son
 * gratuitas e ilimitadas: lo que se factura a ~$2.30/GB es la INGESTA. El
 * escaneo por consulta solo genera cargo sobre *Basic Logs*, datos archivados y
 * *search jobs*, y ahi la tarifa es ~$0.005/GB.
 *
 * Este modulo usa la tarifa de escaneo real para el KPI de costo indirecto, de
 * modo que la cifra sea defendible frente a la factura. La palanca FinOps grande
 * de los workbooks no es el costo de consulta sino la higiene (huerfanos,
 * sprawl) y la exposicion a ingesta que revelan las tablas que consultan.
 */
export const LOG_ANALYTICS_QUERY_SCAN_USD_PER_GB = 0.005;

/**
 * Precio de INGESTA en Log Analytics (Analytics tier, USD/GB). Se usa solo para
 * dimensionar la exposicion de las tablas que un dashboard consulta, nunca para
 * cobrar la consulta en si.
 */
export const LOG_ANALYTICS_INGESTION_USD_PER_GB = 2.3;

/** GB escaneados por ejecucion a partir de los cuales una consulta es pesada. */
export const HEAVY_QUERY_GB_THRESHOLD = 1;

/** Dias sin modificacion a partir de los cuales un workbook se considera zombie. */
export const STALE_WORKBOOK_DAYS = 180;

/**
 * Tablas de Log Analytics de alto volumen. Un auto-refresh agresivo sobre
 * cualquiera de estas es el patron de fuga mas caro del modulo.
 */
export const HIGH_VOLUME_TABLES = [
  "CommonSecurityLog",
  "AppTraces",
  "ContainerLogV2",
  "ContainerLog",
  "AzureDiagnostics",
  "SecurityEvent",
  "Syslog",
  "W3CIISLog",
] as const;

export type WorkbookType = "Shared" | "Private";

export type WorkbookDataSource =
  | "LogAnalytics"
  | "ResourceGraph"
  | "AzureMetrics"
  | "Mixed"
  | "Unknown";

export type WorkbookHealthStatus = "Valid" | "Orphan" | "SourceError" | "Stale";

export type WorkbookRemediationCategory =
  | "PURGE_ORPHAN"
  | "DISABLE_AUTOREFRESH"
  | "OPTIMIZE_KQL"
  | "PROMOTE_TO_SHARED";

/** Una consulta individual extraida del `serializedData` del workbook. */
export interface WorkbookQuerySummary {
  /** Titulo del item dentro del workbook, si la definicion lo declara. */
  stepName: string;
  dataSource: WorkbookDataSource;
  /** Tablas de Log Analytics referenciadas por la consulta. */
  tablesReferenced: string[];
  /** GB estimados escaneados por ejecucion. */
  estimatedScanGB: number;
  /** `true` si la consulta no acota por TimeGenerated antes de agregar. */
  lacksTimeFilter: boolean;
  isHeavy: boolean;
  /** Fragmento del KQL, truncado para no inflar el payload. */
  queryPreview: string;
}

export interface WorkbookResourceItem {
  id: string;
  name: string;
  displayName: string;
  workbookType: WorkbookType;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  category: string;
  primaryDataSource: WorkbookDataSource;
  /** `properties.sourceId`: recurso o workspace al que el workbook esta anclado. */
  linkedSourceId?: string;
  /** Etiqueta legible del intervalo, p. ej. "1 min", "15 min" o `undefined` si esta desactivado. */
  autoRefreshInterval?: string;
  /** Intervalo normalizado en segundos; 0 = desactivado. Se usa para ordenar y filtrar. */
  autoRefreshSeconds: number;
  lastModifiedDate: string;
  /** Dias transcurridos desde `lastModifiedDate`, precalculado en el servidor. */
  daysSinceModified: number;
  version: string;
  isOrphan: boolean;
  hasHeavyQueries: boolean;
  healthStatus: WorkbookHealthStatus;
  /** Motivo legible del estado no-valido; vacio cuando `healthStatus === "Valid"`. */
  healthReason?: string;
  estimatedQueryCostUSD: number;
  /** Ejecuciones mensuales estimadas a partir del auto-refresh. */
  estimatedMonthlyRuns: number;
  totalScanGBPerRun: number;
  queries: WorkbookQuerySummary[];
  /** Workspaces de Log Analytics referenciados que ya no existen en la suscripcion. */
  missingWorkspaceIds: string[];
}

export interface WorkbooksSummaryMetrics {
  totalWorkbooksCount: number;
  sharedCount: number;
  privateCount: number;
  orphanCount: number;
  staleCount: number;
  autoRefreshCount: number;
  /** Auto-refresh <= 5 min sobre tablas de alto volumen. */
  aggressiveRefreshCount: number;
  heavyQueryCount: number;
  estimatedMonthlyQueryCostUSD: number;
  potentialSavingsUSD: number;
  breakdownByDataSource: Array<{
    dataSource: WorkbookDataSource;
    label: string;
    count: number;
    costUSD: number;
    percentage: number;
    color: string;
  }>;
}

export interface WorkbookRemediationAction {
  id: string;
  resourceId: string;
  title: string;
  description: string;
  category: WorkbookRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface WorkbookCostTrendPoint {
  date: string;
  estimatedCostUSD: number;
  scanGB: number;
}

export interface WorkbooksPayload {
  summary: WorkbooksSummaryMetrics;
  workbooks: WorkbookResourceItem[];
  remediations: WorkbookRemediationAction[];
  costTrend?: WorkbookCostTrendPoint[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

/** Paleta institucional en tonos de azul para las graficas del modulo. */
export const WORKBOOK_SOURCE_COLORS: Record<WorkbookDataSource, string> = {
  LogAnalytics: "#0078D4",
  ResourceGraph: "#2563EB",
  AzureMetrics: "#0284C7",
  Mixed: "#38BDF8",
  Unknown: "#94A3B8",
};

export const WORKBOOK_SOURCE_LABELS: Record<WorkbookDataSource, string> = {
  LogAnalytics: "Log Analytics (KQL)",
  ResourceGraph: "Azure Resource Graph",
  AzureMetrics: "Azure Monitor Metrics",
  Mixed: "Mixta",
  Unknown: "Sin fuente detectada",
};
