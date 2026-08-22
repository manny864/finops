/**
 * TypeScript Contracts for Azure Network Watcher — FinOps de Diagnostico de Red
 *
 * El recurso Network Watcher es GRATUITO, por eso la tabla de costos por recurso
 * lo muestra en $0.00. El gasto real lo generan sus capacidades satelite:
 * Traffic Analytics (procesa los flow logs en Log Analytics), Connection Monitor
 * (cobra por prueba/mes) y el almacenamiento de los Flow Logs en la Storage
 * Account de destino. Este modulo consolida esos tres cargos y los atribuye al
 * watcher regional que los origina.
 */

/**
 * Traffic Analytics: procesamiento + ingesta del flujo enriquecido en Log
 * Analytics, USD/GB. Es el componente dominante del costo de diagnostico de red.
 */
export const TRAFFIC_ANALYTICS_USD_PER_GB = 2.3;

/** Connection Monitor: USD por prueba y por mes. */
export const CONNECTION_MONITOR_USD_PER_TEST_MONTH = 0.3;

/**
 * Flow Logs en Storage Account: blob Hot LRS, USD/GB/mes. Es barato por GB pero
 * con `retentionPolicy.days == 0` (retencion infinita) crece sin techo.
 */
export const FLOW_LOGS_STORAGE_USD_PER_GB_MONTH = 0.021;

/** Intervalo de Traffic Analytics en minutos: Azure solo admite 10 o 60. */
export type TrafficAnalyticsInterval = 10 | 60;

export type NetworkWatcherRemediationCategory =
  | "TRAFFIC_ANALYTICS_INTERVAL"
  | "STORAGE_LIFECYCLE"
  | "MONITOR_FREQUENCY"
  | "ORPHAN_PURGE";

/** Un Flow Log (NSG o VNet) vinculado a un Network Watcher. */
export interface FlowLogConfig {
  id: string;
  name: string;
  /** NSG o VNet monitoreada. */
  targetResourceId: string;
  targetResourceName: string;
  targetKind: "NSG" | "VNet" | "Unknown";
  enabled: boolean;
  storageId?: string;
  storageAccountName?: string;
  /** 0 = retencion infinita, que es el patron de fuga de la Regla 2. */
  retentionDays: number;
  trafficAnalyticsEnabled: boolean;
  trafficAnalyticsInterval?: TrafficAnalyticsInterval;
  workspaceId?: string;
  /** GB/mes procesados por Traffic Analytics para este flow log. */
  processedGBPerMonth: number;
  /** GB/mes acumulados en la Storage Account. */
  storedGBPerMonth: number;
}

/** Una prueba de conectividad de Connection Monitor. */
export interface ConnectionMonitorConfig {
  id: string;
  name: string;
  /** Cantidad de test configurations dentro del monitor: cada una se factura. */
  testsCount: number;
  /** Frecuencia mas agresiva entre sus test configurations, en segundos. */
  minFrequencySeconds: number;
  endpointsCount: number;
  /** `true` si algun endpoint apunta a un recurso que ya no existe. */
  hasUnreachableEndpoint: boolean;
  monthlyCostUSD: number;
}

export interface NetworkWatcherResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  flowLogsCount: number;
  trafficAnalyticsActiveCount: number;
  trafficAnalytics10MinCount: number;
  trafficAnalytics60MinCount: number;
  connectionMonitorsCount: number;
  packetCapturesCount: number;
  linkedStorageAccountId?: string;
  linkedStorageAccountName?: string;
  /** Menor retencion configurada entre sus flow logs; 0 = infinita. */
  storageRetentionDays: number;
  estimatedTrafficAnalyticsCostUSD: number;
  estimatedConnectionMonitorCostUSD: number;
  estimatedStorageCostUSD: number;
  estimatedPacketCaptureCostUSD: number;
  totalEstimatedRealCostUSD: number;
  /** Inferido del nombre del RG / suscripcion; gobierna la Regla 1. */
  isDevOrTest: boolean;
  isWasteful: boolean;
  /** Motivo legible de `isWasteful`; vacio cuando el watcher esta sano. */
  wasteReason?: string;
  flowLogs: FlowLogConfig[];
  connectionMonitors: ConnectionMonitorConfig[];
}

export interface NetworkWatcherSummaryMetrics {
  totalRealCostUSD: number;
  totalWatchersCount: number;
  totalFlowLogsCount: number;
  totalConnectionMonitorsCount: number;
  trafficAnalytics10MinCount: number;
  trafficAnalytics60MinCount: number;
  totalProcessedGBPerMonth: number;
  potentialSavingsUSD: number;
  breakdownByService: Array<{ serviceName: string; costUSD: number; percentage: number; color: string }>;
}

export interface NetworkWatcherRemediationAction {
  id: string;
  resourceId: string;
  title: string;
  description: string;
  category: NetworkWatcherRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface NetworkIngestTrendPoint {
  date: string;
  processedGB: number;
  costUSD: number;
}

export interface NetworkWatcherPayload {
  summary: NetworkWatcherSummaryMetrics;
  watchers: NetworkWatcherResource[];
  remediations: NetworkWatcherRemediationAction[];
  ingestTrend?: NetworkIngestTrendPoint[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

/** Paleta institucional en tonos de azul para el desglose de costos. */
export const NETWORK_SERVICE_COLORS: Record<string, string> = {
  "Traffic Analytics": "#0078D4",
  "Connection Monitor": "#2563EB",
  "Flow Logs (Storage)": "#0284C7",
  "Packet Captures": "#38BDF8",
  "Sin Trafico": "#94A3B8",
};
