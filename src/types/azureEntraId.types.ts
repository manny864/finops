/**
 * TypeScript Contracts for Microsoft Entra ID — Gobernanza de Identidades y FinOps
 *
 * Entra ID mezcla dos modelos de facturacion que nunca aparecen juntos en una
 * sola vista de Azure:
 *  - Recursos ARM medidos: Entra Domain Services (por hora de instancia) y
 *    External ID (por MAU sobre el umbral gratuito). Salen en Cost Management.
 *  - Licencias por usuario: P1, P2, Governance y Workload ID. NO salen en Cost
 *    Management — se facturan por el acuerdo de licenciamiento, y su desperdicio
 *    solo se ve cruzando `subscribedSkus` contra la actividad de logon.
 * El segundo suele ser el mas grande y el mas invisible.
 */

/** Entra Domain Services: USD por mes segun SKU. */
export const EDS_SKU_MONTHLY_USD: Record<string, number> = {
  Standard: 110,
  Enterprise: 290,
  Premium: 580,
};

/** Precio de lista mensual por licencia, USD. Coincide con m365SkuCatalog. */
export const ENTRA_LICENSE_USD: Record<string, number> = {
  AAD_PREMIUM: 6,
  AAD_PREMIUM_P2: 9,
  ENTRA_ID_GOVERNANCE: 7,
  WORKLOAD_IDENTITIES: 3,
};

/** SKU part numbers de Entra que este modulo audita por inactividad. */
export const AUDITED_ENTRA_SKUS = [
  "AAD_PREMIUM",
  "AAD_PREMIUM_P2",
  "ENTRA_ID_GOVERNANCE",
  "WORKLOAD_IDENTITIES",
] as const;

/** Dias sin logon a partir de los cuales la licencia se considera desperdiciada. */
export const ENTRA_WASTE_REASON_KEYS = [
  "waste_DISABLED_WITH_LICENSE",
  "waste_NEVER_SIGNED_IN",
  "waste_NO_LOGON_DAYS",
  "waste_NO_AUTH_DAYS",
  "waste_NONPROD_SKU",
] as const;

export type EntraWasteReasonKey = (typeof ENTRA_WASTE_REASON_KEYS)[number];

export const INACTIVE_USER_DAYS = 90;

/** MAU incluidos sin cargo en Entra External ID antes de facturar. */
export const EXTERNAL_ID_FREE_MAU = 50_000;

/** USD por MAU facturable en External ID (tramo P1). */
export const EXTERNAL_ID_USD_PER_MAU = 0.00325;

export type EntraResourceType =
  | "DomainServices"
  | "UserLicense"
  | "ServicePrincipal"
  | "ExternalID_Tenant";

export type EntraActivityStatus = "Active" | "Inactive" | "Disabled" | "Unknown";

// RECLAIM_USER_LICENSE cubria dos recomendaciones distintas --revocar licencias
// asignadas y ajustar las compradas sin asignar-- asi que no servia para derivar
// el texto de ninguna. Se parte en dos.
export const ENTRA_REMEDIATION_CATEGORIES = [
  "RECLAIM_USER_LICENSE",
  "ADJUST_PREPAID_UNITS",
  "DOWNGRADE_DOMAIN_SERVICES",
  "PURGE_WORKLOAD_LICENSE",
  "MFA_FRAUD_PREVENTION",
] as const;

export type EntraRemediationCategory = (typeof ENTRA_REMEDIATION_CATEGORIES)[number];

export interface EntraIdResourceItem {
  id: string;
  name: string;
  displayName: string;
  resourceType: EntraResourceType;
  /** UPN o appId, segun el tipo. Vacio para recursos ARM. */
  principalIdentifier?: string;
  location: string;
  /** `tenant` para lo que no vive en una suscripcion. */
  subscriptionId: string;
  subscriptionName: string;
  skuTier: string;
  assignedLicenses: string[];
  lastSignInDate?: string;
  /** `null` cuando nunca se registro un logon; distinto de "0 dias". */
  inactiveDays?: number | null;
  isAccountEnabled: boolean;
  activityStatus: EntraActivityStatus;
  monthlyCostUSD: number;
  potentialSavingsUSD: number;
  isWasteful: boolean;
  /**
   * Motivo del desperdicio como clave + valores, no como frase: el payload se
   * cachea sin el locale, asi que armarlo en el servidor lo congela en el
   * idioma del primer lector.
   */
  wasteReason?: { key: EntraWasteReasonKey; params?: Record<string, string | number> };
}

/** Estado de un SKU comprado frente a lo realmente asignado. */
export interface EntraLicenseSkuSummary {
  skuPartNumber: string;
  displayName: string;
  prepaidUnits: number;
  consumedUnits: number;
  /** Compradas y sin asignar: se pagan igual. */
  unassignedUnits: number;
  /** Asignadas a cuentas inactivas o deshabilitadas. */
  inactiveAssignedUnits: number;
  unitPriceUSD: number;
  /** Costo de las unidades sin asignar + las asignadas a cuentas inactivas. */
  wastedMonthlyUSD: number;
}

export interface EntraIdSummaryMetrics {
  /** Domain Services + External ID: lo que sale en Cost Management. */
  totalArmCostUSD: number;
  /** Licencias sin asignar o en cuentas inactivas: no sale en Cost Management. */
  totalLicenseWasteUSD: number;
  /** Gasto total facturado por licencias (unidades COMPRADAS x precio), no las asignadas. */
  totalLicenseSpendUSD: number;
  totalUsersCount: number;
  guestUsersCount: number;
  inactiveUsersCount: number;
  disabledWithLicenseCount: number;
  servicePrincipalsCount: number;
  inactiveServicePrincipalsCount: number;
  domainServicesCount: number;
  workloadIdentitiesCount: number;
  potentialSavingsUSD: number;
  breakdownByCostType: Array<{ typeName: string; costUSD: number; percentage: number; color: string }>;
  licenseSkus: EntraLicenseSkuSummary[];
  /** `false` cuando Graph no expone signInActivity (requiere Entra ID P1). */
  signInActivityAvailable: boolean;
}

export interface EntraIdRemediationAction {
  id: string;
  targetId: string;
  targetName: string;
  /** Valores a interpolar en `rem_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  category: EntraRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  /** UPNs afectados, para el drawer de reclamo de licencias. */
  affectedPrincipals?: string[];
}

export interface EntraIdPayload {
  summary: EntraIdSummaryMetrics;
  resources: EntraIdResourceItem[];
  remediations: EntraIdRemediationAction[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
  /** Capacidades de Graph no disponibles, para que la UI degrade con gracia. */
  unavailableCapabilities?: string[];
}

/** Paleta institucional en tonos de azul por tipo de costo. */
export const ENTRA_COST_COLORS: Record<string, string> = {
  "Entra Domain Services": "#0078D4",
  "Workload Identities": "#2563EB",
  "External ID (MAU)": "#0284C7",
  "Licencias asignadas": "#38BDF8",
  "Licencias desperdiciadas": "#94A3B8",
};
