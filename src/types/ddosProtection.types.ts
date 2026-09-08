/**
 * DDoS Protection Module — TypeScript strict types.
 *
 * Covers:
 *   - DDoS Network Protection Plans (microsoft.network/ddosProtectionPlans)
 *   - DDoS IP Protection (microsoft.network/publicIPAddresses with ddosSettings.protectionCoverage)
 *   - Virtual Networks with DDoS enabled (microsoft.network/virtualNetworks)
 *
 * Palette: Strict corporate blue tones only.
 *   - Network Protection: #0078D4 (Corporate Blue Deep)
 *   - IP Protection:      #2563EB (Cobalt Blue)
 *   - Basic / Unprotected: #38BDF8 (Sky Blue)
 *   - Orphan / Waste:      #94A3B8 (Slate)
 */

// ─── Resource-level types ────────────────────────────────────────────────

export type DdosProtectionTier = "NetworkProtection" | "IpProtection" | "Basic";

export type DdosResourceType =
  | "DDoS Plan"
  | "Protected Public IP"
  | "Protected VNet"
  | "Unprotected Public IP";

export type DdosResourceStatus = "Protected" | "UnderAttack" | "Unprotected" | "Orphan";

export interface DdosResourceDetail {
  /** Azure resource ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Resource type classification */
  resourceType: DdosResourceType;
  /** Protection tier */
  protectionTier: DdosProtectionTier;
  /** Number of VNets associated (for plans) */
  associatedVnetsCount: number;
  /** Number of IPs protected under this resource */
  protectedIpsCount: number;
  /** Public IP address string (for IP resources) */
  publicIpAddress: string | null;
  /** Whether this plan has zero VNets linked */
  isOrphan: boolean;
  /** Operational status */
  status: DdosResourceStatus;
  /** Azure resource group */
  resourceGroup: string;
  /** Azure subscription ID */
  subscriptionId: string;
  /** Resolved subscription display name */
  subscriptionName: string;
  /** Cost center / owner from tags */
  costCenterOwner: string;
  /** Resource creation date (ISO 8601) */
  creationDate: string;
  /** Azure region */
  location: string;
  /** Monthly cost in USD */
  monthlyCostUSD: number;
  /** Tags from Azure */
  tags?: Record<string, string>;
  /** Environment classification */
  environment?: "prod" | "dev" | "staging" | "qa" | "unknown";
  /** SKU / tier name */
  skuTier?: string;
  /** Linked DDoS plan ID (for VNets / IPs) */
  linkedPlanId?: string;
  /** Linked DDoS plan name (for VNets / IPs) */
  linkedPlanName?: string;
}

// ─── Summary / KPI types ─────────────────────────────────────────────────

export interface DdosTierBreakdown {
  tierName: string;
  tierLabel: string;
  costUSD: number;
  percentage: number;
  color: string;
  count: number;
}

export interface DdosSummaryMetrics {
  /** Total monthly cost across all DDoS resources */
  totalCostUSD: number;
  /** Projected end-of-month cost */
  projectedEndOfMonthCostUSD: number;
  /** Number of active DDoS Network Protection plans */
  activePlansCount: number;
  /** Total IPs with advanced mitigation (Network + IP Protection) */
  protectedIpsCount: number;
  /** IPs with only Basic protection */
  unprotectedIpsCount: number;
  /** Plans with zero VNets linked */
  orphanedPlansCount: number;
  /** Potential monthly savings from arbitrage + orphan cleanup */
  potentialSavingsUSD: number;
  /** Active attack count (UnderAttack status) */
  activeAttacksCount: number;
  /** Coverage percentage (protected / total IPs) */
  coveragePercentage: number;
  /** Tier breakdown for donut chart */
  breakdown: DdosTierBreakdown[];
}

// ─── Remediation types ───────────────────────────────────────────────────

/**
 * Lista en tiempo de ejecucion, no solo un tipo: el texto de cada recomendacion
 * se resuelve con `rem_<category>_title` / `_desc` / `_impact`, asi que el test
 * de claves necesita poder recorrer las categorias. El tipo se deriva de la
 * lista para que no puedan separarse.
 */
export const DDOS_REMEDIATION_CATEGORIES = [
  "ORPHAN_PLAN",
  "ARBITRAGE_IP_PLAN",
  "DEV_UNLINK",
  "ENABLE_IP_PROTECTION",
] as const;

export type DdosRemediationCategory = (typeof DDOS_REMEDIATION_CATEGORIES)[number];

export interface DdosRemediationAction {
  id: string;
  resourceId: string;
  resourceName: string;
  /**
   * `category` ya identifica de forma unica a cada recomendacion, asi que el
   * texto se resuelve con claves derivadas de ella —`rem_<category>_title`,
   * `_desc`, `_impact`— y no hace falta guardarlas en el payload: una lista
   * menos que mantener sincronizada. `params` trae los valores que interpolan.
   *
   * El servidor no puede armar la frase: la respuesta se cachea sin el locale
   * en la clave, asi que el segundo lector recibiria el idioma del primero.
   */
  category: DdosRemediationCategory;
  params?: Record<string, string | number>;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  actionType: "DELETE" | "RECONFIGURE" | "AUDIT" | "ENABLE";
  commandPayload: {
    cli: string;
    powershell: string;
  };
}

// ─── API Response ────────────────────────────────────────────────────────

export interface DdosProtectionResponse {
  success: boolean;
  mock: boolean;
  summary: DdosSummaryMetrics;
  resources: DdosResourceDetail[];
  remediations: DdosRemediationAction[];
}

// ─── Color constants ─────────────────────────────────────────────────────

export const DDOS_PROTECTION_COLORS: Record<DdosProtectionTier, string> = {
  NetworkProtection: "#0078D4", // Corporate Blue Deep
  IpProtection: "#2563EB",      // Cobalt Blue
  Basic: "#38BDF8",             // Sky Blue
};

export const DDOS_ORPHAN_COLOR = "#94A3B8"; // Slate for orphan/waste

export const DDOS_STATUS_COLORS: Record<DdosResourceStatus, string> = {
  Protected: "#10B981",    // Emerald green
  UnderAttack: "#EF4444",  // Red
  Unprotected: "#F59E0B",  // Amber
  Orphan: "#94A3B8",       // Slate
};