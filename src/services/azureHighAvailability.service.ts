/**
 * Recomendaciones de Alta Disponibilidad — capa de dominio.
 *
 * El escaneo de Resource Graph ya vive en `haService.ts` (una consulta KQL por
 * tipo de brecha) y no se duplica. Acá se traduce su salida al contrato del
 * módulo, se proyecta el SLA y se estima el costo de remediar.
 *
 * RBAC Azure mínimo: `Reader`. Todo read-only; las acciones que sí escriben
 * (upgrade de SKU, asociar backup) pasan por el flujo de aprobaciones.
 */

import Decimal from "decimal.js";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  downtimeMinutesPerMonth,
  REMEDIATION_COST_HINTS,
  SLA_AVAILABILITY_SET,
  SLA_NO_SLA,
  SLA_SINGLE_INSTANCE,
  SLA_ZONE_REDUNDANT,
  type HaIssueCategory,
  type HaPayload,
  type HaRecommendationItem,
  type HaSeverityLevel,
  type HaSummaryMetrics,
} from "@/types/azureHighAvailability.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_FROM_ISSUE: Record<string, HaIssueCategory> = {
  no_zone: "NO_AVAILABILITY_ZONE",
  no_availability_set: "NO_AVAILABILITY_SET",
  no_backup: "NO_BACKUP",
  no_geo_redundancy: "NO_GEO_REDUNDANCY",
  single_replica: "NO_GEO_REDUNDANCY",
  low_capacity: "SINGLE_INSTANCE_CAPACITY",
  basic_sku: "BASIC_SKU_NO_SLA",
};

export function toIssueCategory(raw: unknown): HaIssueCategory {
  return CATEGORY_FROM_ISSUE[String(raw || "").toLowerCase()] || "NO_AVAILABILITY_ZONE";
}

export function toSeverity(raw: unknown): HaSeverityLevel {
  const s = String(raw || "").toLowerCase();
  if (s === "critical") return "CRITICAL";
  if (s === "high") return "HIGH";
  if (s === "medium") return "MEDIUM";
  if (s === "low") return "LOW";
  // Una severidad desconocida cae en MEDIUM, no en LOW: subestimarla haría que
  // la brecha se pierda al final de la lista sin que nadie la mire.
  return "MEDIUM";
}

const TYPE_LABELS: Record<string, string> = {
  "microsoft.compute/virtualmachines": "Virtual Machines",
  "microsoft.sql/servers": "SQL Servers",
  "microsoft.sql/servers/databases": "SQL Databases",
  "microsoft.dbforpostgresql/flexibleservers": "Flexible Servers",
  "microsoft.dbformysql/flexibleservers": "Flexible Servers",
  "microsoft.documentdb/databaseaccounts": "Database Accounts",
  "microsoft.web/serverfarms": "Serverfarms",
  "microsoft.network/publicipaddresses": "Public IPAddresses",
  "microsoft.containerservice/managedclusters": "Managed Clusters",
  "microsoft.storage/storageaccounts": "Storage Accounts",
  "microsoft.cache/redis": "Redis Cache",
};

export function toResourceTypeDisplay(type: unknown): string {
  const original = String(type || "").trim();
  if (!original) return "Otros";
  const known = TYPE_LABELS[original.toLowerCase()];
  if (known) return known;
  const last = original.split("/").pop() || original;
  return last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Extrae el resource group del ARM ID; ARG no siempre lo proyecta. */
export function extractResourceGroup(resourceId: unknown): string {
  const m = String(resourceId || "").match(/\/resourceGroups\/([^/]+)/i);
  return m ? m[1] : "";
}

export function extractSubscriptionId(resourceId: unknown): string {
  const m = String(resourceId || "").match(/\/subscriptions\/([^/]+)/i);
  return m ? m[1] : "";
}

/** La región no siempre viene proyectada; se acepta vacía en vez de inventarla. */
export function extractLocation(row: Record<string, unknown>): string {
  return String(row.location || row.region || "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// SLA y costo
// ─────────────────────────────────────────────────────────────────────────────

/** SLA vigente y alcanzable para cada tipo de brecha. */
export function slaForCategory(category: HaIssueCategory): { current: number; target: number } {
  switch (category) {
    case "BASIC_SKU_NO_SLA":
      // La Basic SKU literalmente no tiene SLA publicado: no es 99.9%, es nada.
      return { current: SLA_NO_SLA, target: SLA_ZONE_REDUNDANT };
    case "NO_AVAILABILITY_ZONE":
      return { current: SLA_SINGLE_INSTANCE, target: SLA_ZONE_REDUNDANT };
    case "NO_AVAILABILITY_SET":
      return { current: SLA_SINGLE_INSTANCE, target: SLA_AVAILABILITY_SET };
    case "SINGLE_INSTANCE_CAPACITY":
      return { current: SLA_SINGLE_INSTANCE, target: SLA_ZONE_REDUNDANT };
    case "NO_GEO_REDUNDANCY":
      return { current: SLA_SINGLE_INSTANCE, target: SLA_ZONE_REDUNDANT };
    case "NO_BACKUP":
      // Un backup no cambia el SLA de disponibilidad: cambia el RPO. Se deja el
      // SLA igual en vez de inflar la mejora prometida.
      return { current: SLA_SINGLE_INSTANCE, target: SLA_SINGLE_INSTANCE };
  }
}

/**
 * Delta mensual estimado de aplicar la redundancia. Para las categorías cuyo
 * costo es proporcional al recurso (duplicar instancia, réplica geo) se usa el
 * gasto actual; para las de tarifa fija, la constante de referencia.
 */
export function estimateRemediationCost(category: HaIssueCategory, currentMonthlySpendUSD = 0): number {
  const hint = REMEDIATION_COST_HINTS[category];
  if (category === "SINGLE_INSTANCE_CAPACITY" || category === "NO_GEO_REDUNDANCY") {
    // Duplicar la instancia cuesta lo mismo que la instancia. Si no se conoce
    // el gasto, se devuelve 0 y la UI lo muestra como "a determinar" en vez de
    // inventar una cifra que alguien podría llevar a un comité de costos.
    return new Decimal(Math.max(0, currentMonthlySpendUSD)).toDecimalPlaces(2).toNumber();
  }
  return hint.base;
}

/** Sólo estas categorías se pueden aplicar por API sin rediseñar la arquitectura. */
export function isRemediableViaApi(category: HaIssueCategory): boolean {
  // Cambiar la SKU de una IP pública y asociar una política de backup son
  // operaciones idempotentes de ARM. Zonas y Availability Sets exigen recrear
  // el recurso, y la geo-redundancia exige decidir región secundaria: eso es
  // rediseño, no un botón.
  return category === "BASIC_SKU_NO_SLA" || category === "NO_BACKUP";
}

/** Re-export por conveniencia: la implementación vive en el archivo de tipos. */
export { downtimeMinutesPerMonth };

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado
// ─────────────────────────────────────────────────────────────────────────────

/** Fila cruda que devuelve `haService.evaluateHALive`. */
export interface RawHaItem {
  resourceId?: unknown;
  resourceName?: unknown;
  resourceType?: unknown;
  issueType?: unknown;
  severity?: unknown;
  estimatedRisk?: unknown;
  riskKey?: unknown;
  location?: unknown;
}

export function mapHaItem(
  row: RawHaItem,
  options: {
    subscriptionNames?: Map<string, string>;
    exemptions?: Map<string, string>;
    spendByResource?: Map<string, number>;
  } = {}
): HaRecommendationItem {
  const resourceId = String(row.resourceId || "");
  const category = toIssueCategory(row.issueType);
  const sla = slaForCategory(category);
  const subId = extractSubscriptionId(resourceId);
  const id = `${resourceId}::${category}`.toLowerCase();
  const exemptionReason = options.exemptions?.get(id);
  const spend = options.spendByResource?.get(resourceId.toLowerCase()) || 0;

  return {
    id,
    resourceId,
    resourceName: String(row.resourceName || "").trim() || resourceId.split("/").pop() || "—",
    resourceType: String(row.resourceType || ""),
    resourceTypeDisplay: toResourceTypeDisplay(row.resourceType),
    location: extractLocation(row as Record<string, unknown>),
    resourceGroup: extractResourceGroup(resourceId),
    subscriptionId: subId,
    subscriptionName: options.subscriptionNames?.get(subId.toLowerCase()) || subId,
    issueCategory: category,
    issueTitleKey: `issue_${category}`,
    severity: toSeverity(row.severity),
    // Vacio en vez del titulo del problema: el panel decide el respaldo, que
    // ahora depende del idioma.
    riskDescription: String(row.estimatedRisk || "").trim(),
    ...(row.riskKey ? { riskKey: String(row.riskKey) } : {}),
    currentSlaPercentage: sla.current,
    targetSlaPercentage: sla.target,
    estimatedRemediationCostUSD: estimateRemediationCost(category, spend),
    isRemediableViaApi: isRemediableViaApi(category),
    isExempted: Boolean(exemptionReason),
    exemptionReason,
  };
}

const SEVERITY_ORDER: Record<HaSeverityLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function buildHaSummary(items: HaRecommendationItem[]): HaSummaryMetrics {
  // Las exenciones no cuentan en los KPIs: son brechas que el tenant decidió
  // aceptar, y dejarlas sumando haría que el tablero nunca baje a cero.
  const active = items.filter((i) => !i.isExempted);
  const sorted = [...items].sort((a, b) => {
    if (a.isExempted !== b.isExempted) return a.isExempted ? 1 : -1;
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return s !== 0 ? s : a.resourceName.localeCompare(b.resourceName);
  });

  return {
    criticalCount: active.filter((i) => i.severity === "CRITICAL").length,
    highCount: active.filter((i) => i.severity === "HIGH").length,
    mediumCount: active.filter((i) => i.severity === "MEDIUM").length,
    lowCount: active.filter((i) => i.severity === "LOW").length,
    totalRecommendationsCount: active.length,
    totalEstimatedRemediationCostUSD: active
      .reduce((a, i) => a.plus(i.estimatedRemediationCostUSD), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber(),
    recommendations: sorted,
  };
}

export function assembleLiveHa(input: {
  items: HaRecommendationItem[];
  availableSubscriptions: Array<{ id: string; name: string }>;
}): HaPayload {
  try {
    return {
      summary: buildHaSummary(input.items),
      availableSubscriptions: input.availableSubscriptions,
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[azureHighAvailability] assembleLiveHa:", errorMessage(error));
    return {
      summary: buildHaSummary([]),
      availableSubscriptions: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exenciones (MySQL)
// ─────────────────────────────────────────────────────────────────────────────

export async function getHaExemptions(tenantId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows]: any = await pool.query(
      `SELECT recommendation_id, exemption_reason FROM HaExemptions
       WHERE tenant_id = ? AND (expires_at IS NULL OR expires_at > NOW())`,
      [tenantId]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (rows as any[]) || []) {
      out.set(String(r.recommendation_id).toLowerCase(), String(r.exemption_reason || ""));
    }
  } catch (e) {
    console.warn("[azureHighAvailability] lectura de HaExemptions falló:", errorMessage(e));
  }
  return out;
}

export async function saveHaExemption(
  tenantId: string,
  payload: {
    recommendationId: string;
    resourceId: string;
    resourceName: string;
    issueCategory: string;
    reason: string;
    durationDays?: number;
  },
  user: string
): Promise<void> {
  let expiresAt: Date | null = null;
  if (payload.durationDays && payload.durationDays > 0) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + payload.durationDays);
  }
  await pool.query(
    `INSERT INTO HaExemptions
      (id, tenant_id, recommendation_id, resource_id, resource_name, issue_category, exemption_reason, exempted_by, exempted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
      exemption_reason = VALUES(exemption_reason),
      exempted_by = VALUES(exempted_by),
      exempted_at = NOW(),
      expires_at = VALUES(expires_at)`,
    [
      crypto.randomUUID(),
      tenantId,
      payload.recommendationId,
      payload.resourceId,
      payload.resourceName,
      payload.issueCategory,
      payload.reason || "Carga no productiva (dev/test)",
      user || "admin",
      expiresAt,
    ]
  );
}

export async function deleteHaExemption(tenantId: string, recommendationId: string): Promise<void> {
  await pool.query(`DELETE FROM HaExemptions WHERE tenant_id = ? AND recommendation_id = ?`, [
    tenantId,
    recommendationId,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset demo
// ─────────────────────────────────────────────────────────────────────────────

function tierOf(tenantId: string): "Professional" | "Business" | "Enterprise" {
  if (tenantId.includes("4444") || tenantId.includes("enterprise")) return "Enterprise";
  if (tenantId.includes("2222") || tenantId.includes("business")) return "Business";
  return "Professional";
}

const DEMO_SUBS = [
  { id: "ec03e8ce-ceee-4638-b303-64ae431d5b1e", name: "CSCS-LandingZone" },
  { id: "7b1f9a22-4c31-4d55-b0aa-9e2d6f118c40", name: "CSCS-Produccion" },
  { id: "2ad4c7e1-88b6-4f0e-9c33-1de0b7a5f962", name: "CSCS-Testing-CL" },
];

interface DemoHaSeed {
  name: string;
  type: string;
  rg: string;
  sub: number;
  location: string;
  issue: string;
  severity: string;
  riskKey: string;
  spend?: number;
  exemptedKey?: string;
}

const DEMO_ITEMS: DemoHaSeed[] = [
  { name: "vm-payments-01", type: "microsoft.compute/virtualmachines", rg: "rg-prod", sub: 1, location: "eastus", issue: "no_zone", severity: "critical", riskKey: "mockRisk_vm_payments_01" },
  { name: "vm-payments-02", type: "microsoft.compute/virtualmachines", rg: "rg-prod", sub: 1, location: "eastus", issue: "no_zone", severity: "critical", riskKey: "mockRisk_vm_payments_02" },
  { name: "vm-db-prod-01", type: "microsoft.compute/virtualmachines", rg: "rg-prod", sub: 1, location: "eastus", issue: "no_backup", severity: "critical", riskKey: "mockRisk_vm_db_prod_01" },
  { name: "sql-finance", type: "microsoft.sql/servers", rg: "rg-data", sub: 1, location: "eastus", issue: "no_geo_redundancy", severity: "critical", riskKey: "mockRisk_sql_finance", spend: 480 },
  { name: "vm-api-app-01", type: "microsoft.compute/virtualmachines", rg: "rg-prod", sub: 1, location: "eastus", issue: "no_availability_set", severity: "high", riskKey: "mockRisk_vm_api_app_01" },
  { name: "aks-prod-east", type: "microsoft.containerservice/managedclusters", rg: "rg-prod", sub: 1, location: "eastus", issue: "no_zone", severity: "high", riskKey: "mockRisk_aks_prod_east" },
  { name: "asp-portal-prod", type: "microsoft.web/serverfarms", rg: "rg-web", sub: 0, location: "eastus", issue: "low_capacity", severity: "high", riskKey: "mockRisk_asp_portal_prod", spend: 146 },
  { name: "cosmos-orders", type: "microsoft.documentdb/databaseaccounts", rg: "rg-data", sub: 1, location: "eastus", issue: "no_geo_redundancy", severity: "high", riskKey: "mockRisk_cosmos_orders", spend: 310 },
  { name: "pg-events", type: "microsoft.dbforpostgresql/flexibleservers", rg: "rg-data", sub: 1, location: "westeurope", issue: "no_geo_redundancy", severity: "high", riskKey: "mockRisk_pg_events", spend: 220 },
  { name: "pip-lb-front", type: "microsoft.network/publicipaddresses", rg: "rg-network", sub: 0, location: "eastus", issue: "basic_sku", severity: "medium", riskKey: "mockRisk_pip_lb_front" },
  { name: "pip-vpn-gw", type: "microsoft.network/publicipaddresses", rg: "rg-network", sub: 0, location: "eastus", issue: "basic_sku", severity: "medium", riskKey: "mockRisk_pip_vpn_gw" },
  { name: "sql-app-prod", type: "microsoft.sql/servers", rg: "rg-prod", sub: 1, location: "eastus", issue: "no_geo_redundancy", severity: "medium", riskKey: "mockRisk_sql_app_prod", spend: 190 },
  { name: "asp-api-prod", type: "microsoft.web/serverfarms", rg: "rg-prod", sub: 1, location: "eastus", issue: "low_capacity", severity: "medium", riskKey: "mockRisk_asp_api_prod", spend: 73 },
  { name: "mysql-cms", type: "microsoft.dbformysql/flexibleservers", rg: "rg-data", sub: 2, location: "brazilsouth", issue: "no_geo_redundancy", severity: "medium", riskKey: "mockRisk_mysql_cms", spend: 95 },
  { name: "sapaymentlogs", type: "microsoft.storage/storageaccounts", rg: "rg-prod", sub: 1, location: "eastus", issue: "single_replica", severity: "low", riskKey: "mockRisk_sapaymentlogs", spend: 42 },
  { name: "saarchive01", type: "microsoft.storage/storageaccounts", rg: "rg-archive", sub: 0, location: "eastus", issue: "single_replica", severity: "low", riskKey: "mockRisk_saarchive01", spend: 18 },
  { name: "vm-test-bench", type: "microsoft.compute/virtualmachines", rg: "rg-test", sub: 2, location: "brazilsouth", issue: "no_availability_set", severity: "low", riskKey: "mockRisk_vm_test_bench", exemptedKey: "mockExempt_vm_test_bench" },
  { name: "sadevstatic", type: "microsoft.storage/storageaccounts", rg: "rg-dev", sub: 2, location: "brazilsouth", issue: "single_replica", severity: "low", riskKey: "mockRisk_sadevstatic", exemptedKey: "mockExempt_sadevstatic" },
];

const TIER_ITEM_COUNT: Record<string, number> = { Professional: 8, Business: 13, Enterprise: 18 };

export function getMockHaPayload(tenantId: string): HaPayload {
  const seeds = DEMO_ITEMS.slice(0, TIER_ITEM_COUNT[tierOf(tenantId)]);
  const subNames = new Map(DEMO_SUBS.map((s) => [s.id.toLowerCase(), s.name]));
  const spend = new Map<string, number>();
  const exemptions = new Map<string, string>();

  const rows: RawHaItem[] = seeds.map((s) => {
    const sub = DEMO_SUBS[s.sub];
    const resourceId = `/subscriptions/${sub.id}/resourceGroups/${s.rg}/providers/${s.type}/${s.name}`;
    if (s.spend) spend.set(resourceId.toLowerCase(), s.spend);
    if (s.exemptedKey) {
      exemptions.set(`${resourceId}::${toIssueCategory(s.issue)}`.toLowerCase(), s.exemptedKey);
    }
    return {
      resourceId,
      resourceName: s.name,
      resourceType: s.type,
      issueType: s.issue,
      severity: s.severity,
      riskKey: s.riskKey,
      location: s.location,
    };
  });

  const items = rows.map((r) => mapHaItem(r, { subscriptionNames: subNames, exemptions, spendByResource: spend }));

  return {
    summary: buildHaSummary(items),
    availableSubscriptions: DEMO_SUBS.filter((_, i) => seeds.some((s) => s.sub === i)),
    source: "mock",
    lastUpdated: "2026-08-22T09:00:00.000Z",
  };
}
