/**
 * Contratos TypeScript — Políticas (Auto-Block) / Azure Policy.
 *
 * El cumplimiento se lee de `policyresources` (Policy Insights), no se estima.
 * La implementación anterior derivaba el cumplimiento de una heurística fija
 * (`Math.floor(total * 0.25)` recursos no conformes) y presentaba ese número
 * como real: un tenant sin ninguna política asignada igual veía "75% conforme".
 */

export type PolicyEffectType = "Deny" | "Audit" | "Modify" | "DeployIfNotExists" | "Disabled";

export type PolicyScopeType = "ManagementGroup" | "Subscription" | "ResourceGroup";

export type InitiativeStatus = "HEALTHY" | "NEEDS_ATTENTION" | "CRITICAL";

/** Umbrales de salud de una iniciativa, en porcentaje de cumplimiento. */
export const INITIATIVE_HEALTHY_THRESHOLD = 80;
export const INITIATIVE_CRITICAL_THRESHOLD = 70;

/** Efectos sobre los que tiene sentido disparar una tarea de remediación. */
export const REMEDIABLE_EFFECTS: PolicyEffectType[] = ["Modify", "DeployIfNotExists"];

export interface PolicyAssignmentItem {
  id: string;
  name: string;
  /** En vivo lo nombra Azure; en el dataset demo viene por clave i18n. */
  displayName: string;
  displayNameKey?: string;
  description: string;
  descriptionKey?: string;
  scopeId: string;
  scopeDisplayName: string;
  scopeType: PolicyScopeType;
  policyDefinitionId: string;
  effect: PolicyEffectType;
  nonCompliantResourcesCount: number;
  compliantResourcesCount: number;
  /** `false` cuando enforcementMode es DoNotEnforce (evalúa pero no bloquea). */
  isEnforced: boolean;
  createdAt?: string;
}

export interface InitiativeComplianceItem {
  id: string;
  name: string;
  displayName: string;
  category: string;
  totalPoliciesCount: number;
  totalEvaluatedResources: number;
  compliancePercentage: number;
  status: InitiativeStatus;
}

export interface CategoryComplianceItem {
  categoryKey: string;
  categoryDisplayName: string;
  totalResources: number;
  compliantResources: number;
  compliancePercentage: number;
}

export interface AutoBlockSummaryMetrics {
  overallCompliancePercentage: number;
  totalCompliantCount: number;
  totalNonCompliantCount: number;
  activeAssignmentsCount: number;
  initiatives: InitiativeComplianceItem[];
  categoryCompliance: CategoryComplianceItem[];
  activeAssignments: PolicyAssignmentItem[];
}

export interface NonCompliantResourceItem {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionName: string;
  violatedPolicyName: string;
  /** Solo en demo: clave i18n del nombre de la politica incumplida. */
  violatedPolicyNameKey?: string;
  policyEffect: PolicyEffectType;
  /** Motivo textual que devuelve Policy Insights, si viene. */
  /** Clave i18n del porque figura como no conforme. */
  reasonKey: string;
}

export interface PolicyScopeOption {
  id: string;
  displayName: string;
  type: PolicyScopeType;
}

export interface PolicyDefinitionTemplate {
  definitionId: string;
  displayNameKey: string;
  descriptionKey: string;
  category: string;
  effect: PolicyEffectType;
  /** Clave del ahorro o riesgo evitado que justifica desplegarla. */
  rationaleKey: string;
}

export interface AutoBlockPayload {
  summary: AutoBlockSummaryMetrics;
  nonCompliantResources: NonCompliantResourceItem[];
  availableScopes: PolicyScopeOption[];
  definitionTemplates: PolicyDefinitionTemplate[];
  source: "live" | "mock";
  lastUpdated: string;
}

export interface DeployPolicyPayload {
  definitionId: string;
  scopeId: string;
  parameters?: Record<string, unknown>;
  effect?: PolicyEffectType;
}

export interface RemediationTaskPayload {
  policyAssignmentId: string;
  scopeId: string;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  minWidth: number;
}

export const POLICY_COLUMNS: TableColumnConfig[] = [
  { id: "policy", label: "Nombre de la Política", visible: true, minWidth: 240 },
  { id: "effect", label: "Efecto", visible: true, minWidth: 130 },
  { id: "scope", label: "Alcance / Scope", visible: true, minWidth: 180 },
  { id: "nonCompliant", label: "Recursos No Conformes", visible: true, minWidth: 170 },
  { id: "description", label: "Descripción", visible: true, minWidth: 260 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 210 },
];

export const NON_COMPLIANT_COLUMNS: TableColumnConfig[] = [
  { id: "resource", label: "Recurso", visible: true, minWidth: 200 },
  { id: "type", label: "Tipo", visible: true, minWidth: 180 },
  { id: "subscription", label: "Suscripción", visible: true, minWidth: 160 },
  { id: "policy", label: "Política Incumplida", visible: true, minWidth: 220 },
  { id: "effect", label: "Efecto", visible: true, minWidth: 120 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 140 },
];

/**
 * Plantillas ofrecidas en el asistente. Son definiciones built-in reales de
 * Azure: los GUID son los IDs oficiales, no placeholders.
 */
export const BUILT_IN_TEMPLATES: PolicyDefinitionTemplate[] = [
  {
    definitionId: "/providers/Microsoft.Authorization/policyDefinitions/cccc23c7-8427-4f53-ad12-b6a63eb452b3",
    displayNameKey: "tpl_vmSkus_name",
    descriptionKey: "tpl_vmSkus_desc",
    category: "Compute",
    effect: "Deny",
    rationaleKey: "tpl_vmSkus_rationale",
  },
  {
    definitionId: "/providers/Microsoft.Authorization/policyDefinitions/83a86a26-fd1f-447c-b59d-e51f44264114",
    displayNameKey: "tpl_noPublicIp_name",
    descriptionKey: "tpl_noPublicIp_desc",
    category: "Network",
    effect: "Deny",
    rationaleKey: "tpl_noPublicIp_rationale",
  },
  {
    definitionId: "/providers/Microsoft.Authorization/policyDefinitions/cd3aa116-8754-49c9-a813-ad46512ece54",
    displayNameKey: "tpl_inheritTag_name",
    descriptionKey: "tpl_inheritTag_desc",
    category: "Tags",
    effect: "Modify",
    rationaleKey: "tpl_inheritTag_rationale",
  },
  {
    definitionId: "/providers/Microsoft.Authorization/policyDefinitions/1e30110a-5ceb-460c-a204-c1c3969c6d62",
    displayNameKey: "tpl_requireCostCenter_name",
    descriptionKey: "tpl_requireCostCenter_desc",
    category: "Tags",
    effect: "Deny",
    rationaleKey: "tpl_requireCostCenter_rationale",
  },
  {
    definitionId: "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c",
    displayNameKey: "tpl_allowedRegions_name",
    descriptionKey: "tpl_allowedRegions_desc",
    category: "General",
    effect: "Deny",
    rationaleKey: "tpl_allowedRegions_rationale",
  },
  {
    definitionId: "/providers/Microsoft.Authorization/policyDefinitions/0015ea4d-51ff-4ce3-8d8c-f3f8f0179a56",
    displayNameKey: "tpl_auditHttps_name",
    descriptionKey: "tpl_auditHttps_desc",
    category: "Storage",
    effect: "Audit",
    rationaleKey: "tpl_auditHttps_rationale",
  },
];

export const EFFECT_LABELS: Record<PolicyEffectType, string> = {
  Deny: "Deny",
  Audit: "Audit",
  Modify: "Modify",
  DeployIfNotExists: "DeployIfNotExists",
  Disabled: "Disabled",
};

/** Paleta del módulo: escala de azules, sin rojos ni verdes planos. */
export const AUTOBLOCK_COLORS = {
  compliant: "#0078D4",
  nonCompliant: "#94A3B8",
  category: "#2563EB",
  gap: "#0284C7",
} as const;
