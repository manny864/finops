/**
 * TypeScript Contracts for Cost Allocation — Prorrateo de Recursos Compartidos
 *
 * Un ExpressRoute, un hub de VNet o un clúster AKS compartido no pertenecen a
 * ningún centro de costo: los usan todos. Sin una regla de reparto ese gasto
 * queda huérfano y el showback departamental miente por omisión.
 *
 * La invariante central del módulo es que los porcentajes sumen exactamente
 * 100%. Por debajo hay residuo sin asignar (una fuga silenciosa en el modelo);
 * por encima se estaría cobrando más de lo que el recurso cuesta.
 */

export type AllocationStrategy =
  | "FIXED_PERCENTAGE"
  | "DYNAMIC_AKS_NAMESPACE"
  | "DYNAMIC_LAW_INGESTION"
  | "PROPORTIONAL_DIRECT_SPEND";

export type AllocationStatus = "VALID_100" | "INCOMPLETE" | "OVER_ALLOCATED";

export const ALLOCATION_REMEDIATION_CATEGORIES = [
  "DYNAMIC_NAMESPACE_ENABLE",
  "LAW_INGESTION_SPLIT",
  "COMPLETE_100_PERCENT",
  "DETECT_UNALLOCATED_HUB",
  "FIX_OVER_ALLOCATION",
] as const;

export type AllocationRemediationCategory =
  (typeof ALLOCATION_REMEDIATION_CATEGORIES)[number];

/** Tipos de recurso que típicamente se comparten entre equipos. */
export const SHARED_RESOURCE_TYPES = [
  "ExpressRoute",
  "AKS",
  "LogAnalytics",
  "AzureFirewall",
  "VNetHub",
  "VPNGateway",
  "Other",
] as const;

export type SharedResourceType = (typeof SHARED_RESOURCE_TYPES)[number];

/**
 * Tolerancia al comparar la suma de porcentajes contra 100. Los porcentajes se
 * guardan como DECIMAL(5,2), así que dos decimales de holgura evitan marcar
 * como incompleta una regla de 33.33 + 33.33 + 33.34.
 */
export const PERCENTAGE_TOLERANCE = 0.01;

export interface AllocationTarget {
  targetCostCenterId: string;
  targetCostCenterName: string;
  percentage: number;
  allocatedAmountUSD: number;
}

export interface SharedCostRule {
  id: string;
  ruleName: string;
  sharedResourceId: string;
  sharedResourceName: string;
  resourceType: SharedResourceType;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  monthlyCostUSD: number;
  strategy: AllocationStrategy;
  targets: AllocationTarget[];
  totalAllocatedPercentage: number;
  unallocatedAmountUSD: number;
  status: AllocationStatus;
  lastUpdated: string;
}

export interface CostAllocationSummary {
  totalSharedSpendUSD: number;
  totalAllocatedSpendUSD: number;
  totalUnallocatedSpendUSD: number;
  allocationCoveragePercentage: number;
  affectedCostCentersCount: number;
  activeRulesCount: number;
  /** Reglas que no llegan al 100% o lo superan. */
  invalidRulesCount: number;
  /** Recursos compartidos detectados en Azure sin ninguna regla asociada. */
  unruledSharedResourcesCount: number;
  /** Reparto por centro de costo, para la vista de showback. */
  showbackByCostCenter: Array<{ costCenterName: string; allocatedUSD: number; percentage: number }>;
  rules: SharedCostRule[];
}

export interface AllocationRemediationAction {
  id: string;
  ruleId: string;
  /** Valores a interpolar en `rem_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  category: AllocationRemediationCategory;
  /** Monto que la acción pone bajo control; no es un ahorro. */
  estimatedSavingsOrImpactUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface CostAllocationPayload {
  summary: CostAllocationSummary;
  remediations: AllocationRemediationAction[];
  /** Recursos compartidos del inventario, para el asistente de creación. */
  availableSharedResources: Array<{
    resourceId: string;
    resourceName: string;
    resourceType: SharedResourceType;
    resourceGroup: string;
    subscriptionName: string;
    monthlyCostUSD: number;
    hasRule: boolean;
  }>;
  availableCostCenters: string[];
  source: "live" | "mock";
  lastUpdated: string;
}

/** Paleta institucional en tonos de azul. */
export const ALLOC_COLORS = {
  sharedSource: "#0078D4",
  costCenter: "#2563EB",
  dynamic: "#0284C7",
  validated: "#38BDF8",
  unallocated: "#94A3B8",
} as const;

/** Escala para repartir colores entre centros de costo en las gráficas. */
export const ALLOC_SCALE = ["#0078D4", "#2563EB", "#0284C7", "#38BDF8", "#93C5FD", "#64748B"] as const;

/**
 * CLAVES, no texto. Este mapa vive en un modulo de tipos, donde no existe `t`,
 * y lo consumen el selector de cada tarjeta de regla y el badge de la columna
 * Strategy: los dos mostraban la frase en castellano a cualquier lector.
 */
export const STRATEGY_LABEL_KEYS: Record<AllocationStrategy, string> = {
  FIXED_PERCENTAGE: "strategy_FIXED_PERCENTAGE",
  DYNAMIC_AKS_NAMESPACE: "strategy_DYNAMIC_AKS_NAMESPACE",
  DYNAMIC_LAW_INGESTION: "strategy_DYNAMIC_LAW_INGESTION",
  PROPORTIONAL_DIRECT_SPEND: "strategy_PROPORTIONAL_DIRECT_SPEND",
};
