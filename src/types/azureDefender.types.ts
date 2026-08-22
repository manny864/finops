/**
 * TypeScript Contracts for Microsoft Defender for Cloud — CSPM & FinOps
 *
 * Azure expone los planes por `Microsoft.Security/pricings` con nombres tecnicos
 * (`VirtualMachines`, `SqlServers`, `Arm`…) y sin decir sobre QUE recursos se
 * aplican. Este modulo normaliza esos nombres a su denominacion comercial y los
 * cruza contra el inventario real via Resource Graph, para responder las dos
 * preguntas que la consola nativa no responde: cuanto cuesta cada plan y que
 * recursos concretos esta (o no esta) protegiendo.
 */

export type DefenderPlanCategory =
  | "Servers"
  | "Storage"
  | "Databases"
  | "Containers"
  | "AppServices"
  | "KeyVault"
  | "ResourceManager"
  | "CSPM"
  | "Other";

export type DefenderPricingTier = "Standard" | "Free";
export type DefenderSubPlan = "Plan1" | "Plan2";
export type DefenderCoverageStatus = "Full" | "Partial" | "None";
export type ResourceEnvironment = "Production" | "Development" | "Staging";

export type DefenderRemediationCategory =
  | "DOWNGRADE_SERVERS_TIER"
  | "EXCLUDE_STORAGE_BACKUP"
  | "ENABLE_DB_PROTECTION"
  | "GOVERN_AUTO_PROVISIONING";

/**
 * Precio mensual por unidad protegida, USD. Tarifas de lista de Defender for
 * Cloud; varian por region y por acuerdo comercial, asi que el tablero las
 * declara en un solo lugar en vez de esparcirlas por el codigo.
 */
export const DEFENDER_UNIT_PRICES: Record<string, number> = {
  // Defender for Servers, por VM/mes.
  Servers_Plan1: 5,
  Servers_Plan2: 15,
  // Por cuenta de almacenamiento/mes (modelo clasico por cuenta).
  Storage: 10,
  // Por instancia de servidor o base de datos/mes.
  Databases: 15,
  AppServices: 15,
  // Por vCore/mes en clusters de Kubernetes.
  Containers: 7,
  // Key Vault y ARM se facturan por transaccion/operacion; a nivel de plan se
  // dimensionan con un promedio mensual conservador por recurso.
  KeyVault: 0.5,
  ResourceManager: 4,
  // Defender CSPM, por recurso facturable/mes.
  CSPM: 5,
  Other: 0,
};

/**
 * Mapeo de los nombres tecnicos de `Microsoft.Security/pricings` a su
 * denominacion comercial. Reemplaza el `Other` generico que mostraba la version
 * anterior del tablero.
 */
export const DEFENDER_PLAN_CATALOG: Record<
  string,
  { displayName: string; category: DefenderPlanCategory; resourceTypes: string[] }
> = {
  virtualmachines: {
    displayName: "Defender for Servers",
    category: "Servers",
    resourceTypes: ["microsoft.compute/virtualmachines", "microsoft.hybridcompute/machines"],
  },
  storageaccounts: {
    displayName: "Defender for Storage",
    category: "Storage",
    resourceTypes: ["microsoft.storage/storageaccounts"],
  },
  sqlservers: {
    displayName: "Defender for Databases (SQL)",
    category: "Databases",
    resourceTypes: ["microsoft.sql/servers"],
  },
  sqlservervirtualmachines: {
    displayName: "Defender for SQL en VMs",
    category: "Databases",
    resourceTypes: ["microsoft.sqlvirtualmachine/sqlvirtualmachines"],
  },
  opensourcerelationaldatabases: {
    displayName: "Defender for Databases (Open Source)",
    category: "Databases",
    resourceTypes: [
      "microsoft.dbformysql/flexibleservers",
      "microsoft.dbforpostgresql/flexibleservers",
      "microsoft.dbformariadb/servers",
    ],
  },
  cosmosdbs: {
    displayName: "Defender for Azure Cosmos DB",
    category: "Databases",
    resourceTypes: ["microsoft.documentdb/databaseaccounts"],
  },
  appservices: {
    displayName: "Defender for App Services",
    category: "AppServices",
    resourceTypes: ["microsoft.web/sites"],
  },
  containers: {
    displayName: "Defender for Containers",
    category: "Containers",
    resourceTypes: ["microsoft.containerservice/managedclusters"],
  },
  keyvaults: {
    displayName: "Defender for Key Vault",
    category: "KeyVault",
    resourceTypes: ["microsoft.keyvault/vaults"],
  },
  arm: {
    displayName: "Defender for Resource Manager",
    category: "ResourceManager",
    resourceTypes: [],
  },
  cloudposture: {
    displayName: "Defender CSPM",
    category: "CSPM",
    resourceTypes: [],
  },
  api: {
    displayName: "Defender for APIs",
    category: "Other",
    resourceTypes: ["microsoft.apimanagement/service"],
  },
  dns: {
    displayName: "Defender for DNS (retirado)",
    category: "Other",
    resourceTypes: [],
  },
};

/** Un recurso concreto bajo el alcance de un plan. */
export interface DefenderAssociatedResource {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  location: string;
  environment: ResourceEnvironment;
  isProtected: boolean;
}

export interface DefenderPlanItem {
  id: string;
  /** Nombre tecnico tal cual lo devuelve Azure (`VirtualMachines`). */
  planKey: string;
  /** Denominacion comercial (`Defender for Servers`). */
  planDisplayName: string;
  category: DefenderPlanCategory;
  subscriptionId: string;
  subscriptionName: string;
  pricingTier: DefenderPricingTier;
  subPlan?: DefenderSubPlan;
  coveredResourcesCount: number;
  uncoveredResourcesCount: number;
  monthlyCostUSD: number;
  coverageStatus: DefenderCoverageStatus;
  /** Entorno dominante entre los recursos del plan. */
  dominantEnvironment: ResourceEnvironment;
  /** `true` si hay recursos de produccion sin proteger bajo este plan. */
  hasUnprotectedProduction: boolean;
  associatedResources: DefenderAssociatedResource[];
}

export interface DefenderSummaryMetrics {
  totalMonthlyCostUSD: number;
  /** Proyeccion a fin de mes a partir del gasto MTD. */
  projectedMonthEndCostUSD: number;
  totalProtectedResources: number;
  totalEvaluatedResources: number;
  coveragePercentage: number;
  totalUnprotectedCriticalResources: number;
  standardPlansCount: number;
  evaluatedPlansCount: number;
  potentialSavingsUSD: number;
  breakdownByPlan: Array<{ planName: string; costUSD: number; percentage: number; color: string }>;
}

export interface DefenderRemediationAction {
  id: string;
  planKey: string;
  subscriptionId: string;
  title: string;
  description: string;
  category: DefenderRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface DefenderPayload {
  summary: DefenderSummaryMetrics;
  plans: DefenderPlanItem[];
  remediations: DefenderRemediationAction[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

/** Paleta institucional en tonos de azul por categoria de plan. */
export const DEFENDER_CATEGORY_COLORS: Record<DefenderPlanCategory, string> = {
  Servers: "#0078D4",
  Databases: "#2563EB",
  Storage: "#0284C7",
  Containers: "#38BDF8",
  AppServices: "#38BDF8",
  KeyVault: "#93C5FD",
  ResourceManager: "#93C5FD",
  CSPM: "#1B2A41",
  Other: "#94A3B8",
};
