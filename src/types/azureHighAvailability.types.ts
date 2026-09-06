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
  /** Clave i18n del titulo del problema: el payload sirve a los tres idiomas. */
  issueTitleKey: string;
  severity: HaSeverityLevel;
  /** Texto libre de Azure Advisor. Vacio si Azure no reporto nada. */
  riskDescription: string;
  /** Solo en el dataset demo: clave i18n de la prosa de riesgo. */
  riskKey?: string;
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
export const REMEDIATION_COST_HINTS: Record<HaIssueCategory, { base: number; noteKey: string }> = {
  BASIC_SKU_NO_SLA: {
    base: 3.65,
    noteKey: "costNote_BASIC_SKU_NO_SLA",
  },
  SINGLE_INSTANCE_CAPACITY: {
    base: 0,
    noteKey: "costNote_SINGLE_INSTANCE_CAPACITY",
  },
  NO_GEO_REDUNDANCY: {
    base: 0,
    noteKey: "costNote_NO_GEO_REDUNDANCY",
  },
  NO_BACKUP: {
    base: 5,
    noteKey: "costNote_NO_BACKUP",
  },
  NO_AVAILABILITY_ZONE: {
    base: 0,
    noteKey: "costNote_NO_AVAILABILITY_ZONE",
  },
  NO_AVAILABILITY_SET: {
    base: 0,
    noteKey: "costNote_NO_AVAILABILITY_SET",
  },
};

/** Paleta del módulo. Los KPIs van en azul; el color de severidad sólo en badges. */
export const HA_COLORS = {
  critical: "#0078D4",
  high: "#2563EB",
  medium: "#0284C7",
  low: "#64748B",
} as const;
