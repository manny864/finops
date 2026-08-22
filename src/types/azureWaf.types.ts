/**
 * TypeScript Contracts for Azure WAF — Seguridad Perimetral y Economia Unitaria
 *
 * Dos plataformas con economias distintas, y la diferencia importa para las
 * recomendaciones:
 *  - Application Gateway WAF_v2: cobra una instancia fija por hora MAS Capacity
 *    Units consumidas. Procesar menos trafico si reduce la factura, porque las
 *    CU escalan con el trabajo de inspeccion.
 *  - Front Door Premium: cobra una base mensual plana MAS un cargo por millon de
 *    solicitudes que la solicitud paga igual, se bloquee o se permita. Filtrar
 *    antes ahorra mucho menos aca.
 */

/** Application Gateway WAF_v2: instancia fija, USD por hora. */
export const APPGW_WAF_FIXED_USD_HOUR = 0.36;

/** Application Gateway WAF_v2: USD por Capacity Unit y hora. */
export const APPGW_WAF_CU_USD_HOUR = 0.0144;

/** Front Door Premium: base mensual, USD. Incluye el motor de WAF. */
export const AFD_PREMIUM_BASE_USD_MONTH = 330;

/** Front Door: managed ruleset, USD por mes. */
export const AFD_MANAGED_RULESET_USD_MONTH = 20;

/** Front Door: USD por millon de solicitudes evaluadas por el WAF. */
export const AFD_WAF_USD_PER_MILLION_REQUESTS = 1.0;

/** Front Door: USD por regla personalizada y por mes. */
export const AFD_CUSTOM_RULE_USD_MONTH = 1.0;

export const HOURS_PER_MONTH = 730;

/**
 * Proporcion de Capacity Units que un geo-filtro temprano puede evitar en
 * Application Gateway. Un rechazo por regla personalizada de alta prioridad se
 * resuelve antes de ejecutar la matriz CRS completa, que es lo caro.
 *
 * ponytail: heuristica declarada; medir con la metrica CapacityUnits real antes
 * de prometerle el numero a un cliente.
 */
export const GEO_FILTER_CU_SAVING_RATIO = 0.3;

export type WafHostPlatform = "FrontDoor" | "ApplicationGateway";
export type WafMode = "Prevention" | "Detection";
export type WafState = "Enabled" | "Disabled";
export type WafThreatSeverity = "High" | "Medium" | "Low";

export type WafRemediationCategory =
  | "ENABLE_PREVENTION"
  | "GEO_FILTER_RULE"
  | "RATE_LIMITING"
  | "PURGE_ORPHAN_POLICY";

export interface WafPolicyResourceItem {
  id: string;
  name: string;
  hostPlatform: WafHostPlatform;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  mode: WafMode;
  state: WafState;
  managedRuleSet: string;
  customRulesCount: number;
  /** `true` si alguna regla personalizada ya filtra por geografia. */
  hasGeoFilterRule: boolean;
  /** `true` si alguna regla personalizada aplica rate limiting. */
  hasRateLimitRule: boolean;
  associatedEndpoints: string[];
  totalRequestsMTD: number;
  blockedRequestsCount: number;
  detectedRequestsCount: number;
  /** GB inspeccionados en el mes, para la economia unitaria. */
  throughputGB: number;
  /** Capacity Units promedio consumidas (solo Application Gateway). */
  avgCapacityUnits: number;
  monthlyCostUSD: number;
  isOrphan: boolean;
  /** `true` si esta en Detection sobre un endpoint productivo. */
  needsPreventionMode: boolean;
  isProduction: boolean;
}

export interface WafThreatCategory {
  categoryName: string;
  severity: WafThreatSeverity;
  attemptsCount: number;
  /** Ejemplos de payload bloqueado, ya neutralizados para render seguro. */
  payloadExamples: string[];
  /** Prefijo de regla OWASP CRS que agrupa esta categoria. */
  crsRulePrefix?: string;
}

export interface WafOriginMetric {
  identifier: string;
  countryCode?: string;
  countryName?: string;
  blockedCount: number;
  percentage: number;
}

export interface WafSummaryMetrics {
  totalMonthlyCostUSD: number;
  totalProtectedApps: number;
  totalRequestsMTD: number;
  totalBlockedRequests: number;
  totalDetectedRequests: number;
  blockRatePercentage: number;
  /**
   * Tasa estimada de falsos positivos. Se aproxima con la proporcion de
   * bloqueos que provienen de reglas de baja severidad — no es una medicion,
   * y la UI lo declara.
   */
  falsePositiveRatePercentage: number;
  costPerAppUSD: number;
  costPerMillionRequestsUSD: number;
  costPerGbUSD: number;
  totalThroughputGB: number;
  policiesInDetectionCount: number;
  orphanPoliciesCount: number;
  threatsBreakdown: WafThreatCategory[];
  topIps: WafOriginMetric[];
  topCountries: WafOriginMetric[];
  potentialSavingsUSD: number;
}

export interface WafRemediationAction {
  id: string;
  policyId: string;
  policyName: string;
  title: string;
  description: string;
  category: WafRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface WafPayload {
  summary: WafSummaryMetrics;
  policies: WafPolicyResourceItem[];
  remediations: WafRemediationAction[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
  /** `true` si no se pudo consultar Log Analytics: la UI no debe inventar amenazas. */
  telemetryUnavailable?: boolean;
}

/**
 * Paleta institucional en tonos de azul. Reemplaza las barras rojas y naranjas
 * del tablero anterior: el rojo en un panel de seguridad se lee como alarma
 * activa, cuando lo que muestran esas barras es trafico ya mitigado.
 */
export const WAF_COLORS = {
  blocked: "#0078D4",
  allowed: "#2563EB",
  countries: "#0284C7",
  customRules: "#38BDF8",
  detection: "#94A3B8",
} as const;

/** Escala armonica para las barras de Top Paises. */
export const WAF_COUNTRY_SCALE = ["#0078D4", "#2563EB", "#0284C7", "#38BDF8", "#93C5FD"] as const;
