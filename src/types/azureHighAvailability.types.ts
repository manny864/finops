/**
 * Contratos TypeScript — Recomendaciones de Alta Disponibilidad.
 *
 * El escaneo ARG ya vive en `haService.ts` y devuelve `issueType` en snake_case.
 * Estos tipos son la vista de dominio del módulo; el mapeo está en
 * `azureHighAvailability.service.ts`.
 */

export type HaSeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type HaIssueCategory =
  | "NO_AVAILABILITY_ZONE"
  | "NO_AVAILABILITY_SET"
  | "NO_BACKUP"
  | "NO_GEO_REDUNDANCY"
  | "SINGLE_INSTANCE_CAPACITY"
  | "BASIC_SKU_NO_SLA";

export const ISSUE_TITLES_ES: Record<HaIssueCategory, string> = {
  NO_AVAILABILITY_ZONE: "Sin Availability Zone",
  NO_AVAILABILITY_SET: "Sin Availability Set",
  NO_BACKUP: "Sin Backup configurado",
  NO_GEO_REDUNDANCY: "Sin redundancia geográfica",
  SINGLE_INSTANCE_CAPACITY: "Capacidad insuficiente (Capacity: 1)",
  BASIC_SKU_NO_SLA: "SKU Basic (sin SLA)",
};

export const SEVERITY_LABELS_ES: Record<HaSeverityLevel, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
};

/**
 * SLA que Microsoft publica para cada configuración. Se usan para proyectar el
 * minutaje de caída mensual, que es lo que la conversación con el negocio
 * necesita: "99,9%" no significa nada hasta traducirlo a 43,8 minutos.
 */
export const SLA_SINGLE_INSTANCE = 99.9;
export const SLA_AVAILABILITY_SET = 99.95;
export const SLA_ZONE_REDUNDANT = 99.99;
export const SLA_NO_SLA = 0;

/** Minutos de un mes de 30 días, para traducir el SLA a downtime. */
export const MINUTES_PER_MONTH = 30 * 24 * 60;

/**
 * Minutos de caída mensual que permite un SLA dado. Vive acá y no en el
 * servicio porque el panel la necesita para renderizar, y el servicio importa
 * el pool de MySQL: traerla desde allá metía `mysql2` en el bundle del cliente.
 */
export function downtimeMinutesPerMonth(slaPercentage: number): number {
  if (slaPercentage <= 0) return MINUTES_PER_MONTH;
  if (slaPercentage >= 100) return 0;
  return Number((((100 - slaPercentage) / 100) * MINUTES_PER_MONTH).toFixed(2));
}

export interface HaRecommendationItem {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceTypeDisplay: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  issueCategory: HaIssueCategory;
  issueTitle: string;
  severity: HaSeverityLevel;
  riskDescription: string;
  currentSlaPercentage: number;
  targetSlaPercentage: number;
  /** Delta mensual que costaría aplicar la redundancia. */
  estimatedRemediationCostUSD: number;
  /** `true` sólo si la plataforma puede aplicarlo por API sin rediseño. */
  isRemediableViaApi: boolean;
  isExempted: boolean;
  exemptionReason?: string;
}

export interface HaSummaryMetrics {
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalRecommendationsCount: number;
  totalEstimatedRemediationCostUSD: number;
  recommendations: HaRecommendationItem[];
}

export interface HaPayload {
  summary: HaSummaryMetrics;
  availableSubscriptions: Array<{ id: string; name: string }>;
  source: "live" | "mock";
  lastUpdated: string;
}

export interface HaRemediationPayload {
  recommendationId: string;
  actionType: "ENABLE_AZ" | "ATTACH_BACKUP" | "SCALE_MULTI_INSTANCE" | "UPGRADE_TO_STANDARD_SKU" | "EXEMPT";
  reason?: string;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  minWidth: number;
}

export const HA_COLUMNS: TableColumnConfig[] = [
  { id: "resource", label: "Recurso", visible: true, minWidth: 200 },
  { id: "type", label: "Tipo de Recurso", visible: true, minWidth: 170 },
  { id: "issue", label: "Problema Detectado", visible: true, minWidth: 200 },
  { id: "severity", label: "Severidad", visible: true, minWidth: 110 },
  { id: "risk", label: "Riesgo Arquitectónico y SLA", visible: true, minWidth: 280 },
  { id: "cost", label: "Costo de Remediación", visible: true, minWidth: 160 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 230 },
];

/**
 * Costos de remediación de referencia (USD/mes). Son deltas de lista, no
 * cotizaciones: el precio real depende de región y compromiso, y el drawer lo
 * dice explícitamente antes de que nadie apruebe un cambio.
 */
export const REMEDIATION_COST_HINTS: Record<HaIssueCategory, { base: number; note: string }> = {
  BASIC_SKU_NO_SLA: {
    base: 3.65,
    note: "Standard SKU tarifa ~$0.005/hora por IP estática frente a la Basic sin cargo.",
  },
  SINGLE_INSTANCE_CAPACITY: {
    base: 0,
    note: "Duplica el costo del App Service Plan: el delta es igual a la tarifa mensual de la instancia actual.",
  },
  NO_GEO_REDUNDANCY: {
    base: 0,
    note: "Una réplica geo cuesta aproximadamente lo mismo que la instancia primaria.",
  },
  NO_BACKUP: {
    base: 5,
    note: "Recovery Services cobra por instancia protegida más el almacenamiento consumido.",
  },
  NO_AVAILABILITY_ZONE: {
    base: 0,
    note: "Distribuir en zonas no tiene cargo por cómputo, pero el tráfico entre zonas sí se factura.",
  },
  NO_AVAILABILITY_SET: {
    base: 0,
    note: "Un Availability Set no tiene costo propio; requiere recrear la VM.",
  },
};

/** Paleta del módulo. Los KPIs van en azul; el color de severidad sólo en badges. */
export const HA_COLORS = {
  critical: "#0078D4",
  high: "#2563EB",
  medium: "#0284C7",
  low: "#64748B",
} as const;
