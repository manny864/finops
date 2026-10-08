import type { TagNormalizationResult } from "@/lib/tagValueNormalizer";

export interface TagPolicyRule {
  id: string;
  tagName: string;
  isRequired: boolean;
  /** Sin valores (o vacío) = valor libre: sólo se exige presencia. */
  allowedValues?: string[];
  /**
   * Clave i18n de la descripcion; la politica sirve a los tres idiomas. Las
   * políticas propias del tenant la toman de la por defecto del mismo nombre.
   */
  descriptionKey?: string;
}

/** Un tag presente cuyo valor no está entre los permitidos de su política. */
export interface InvalidTagValue {
  /** Nombre de la política ("Environment"). */
  tagName: string;
  /** Clave tal como está escrita en el recurso ("environment"): la que se corrige. */
  tagKey: string;
  value: string;
  /** Canónico sugerido por el normalizador determinista (sin IA). */
  suggestion: TagNormalizationResult;
}

export interface ResourceTagAuditItem {
  id: string;
  resourceName: string;
  resourceType: string;
  resourceTypeDisplay: string;
  subscriptionId: string;
  subscriptionName: string;
  resourceGroup: string;
  location: string;
  complianceStatus: "COMPLIANT" | "NON_COMPLIANT";
  currentTags: Record<string, string>;
  missingTags: string[];
  /** Valores no permitidos: distinto de faltante (el tag está, pero mal escrito o fuera de la lista). */
  invalidTags?: InvalidTagValue[];
}

export interface ResourceGroupTagAuditItem {
  id: string;
  resourceGroupName: string;
  subscriptionId: string;
  subscriptionName: string;
  location: string;
  complianceStatus: "COMPLIANT" | "NON_COMPLIANT";
  currentTags: Record<string, string>;
  missingTags: string[];
  invalidTags?: InvalidTagValue[];
  childResourcesCount: number;
}

export interface TagGovernanceSummaryMetrics {
  overallCompliancePercentage: number;
  nonCompliantResourcesCount: number;
  nonCompliantResourceGroupsCount: number;
  /** Recursos con al menos un valor no permitido (también cuentan como no conformes). */
  invalidValueResourcesCount?: number;
  invalidValueResourceGroupsCount?: number;
  totalScannedResources: number;
  totalScannedResourceGroups: number;
  mostFrequentMissingTag: string;
  mandatoryPolicies: TagPolicyRule[];
  resources: ResourceTagAuditItem[];
  resourceGroups: ResourceGroupTagAuditItem[];
}

export interface TagUpdatePayload {
  resourceIds: string[];
  tags: Record<string, string>;
  propagateToChildren?: boolean;
}

/**
 * normalize: valores no permitidos que el normalizador no resolvió.
 * fill: etiqueta libre (CostCenter, Department) faltante que no se puede heredar del grupo.
 */
export type TagAiMode = "normalize" | "fill";

// Por qué no hay sugerencias con IA. Los seis primeros los decide el gate.
export const TAG_AI_UNAVAILABLE_REASONS = [
  "global_disabled",
  "feature_disabled",
  "tenant_disabled",
  "tier",
  "quota",
  "rate_limited",
  "not_configured",
  "error",
  "validation",
  "dlp_tags",
  "dlp_names",
  "nothing_to_resolve",
  "no_vocabulary",
] as const;
export type TagAiUnavailableReason = (typeof TAG_AI_UNAVAILABLE_REASONS)[number];

export interface TagAiSuggestion {
  /** normalize: el valor no conforme. fill: el id del recurso. */
  target: string;
  /** Uno de los permitidos (o de los que el tenant ya usa); null = la IA no supo, nunca inventa. */
  suggestion: string | null;
  confidence: number;
}

export type TagAiSuggestionResult =
  | { aiAvailable: true; mode: TagAiMode; tagName: string; suggestions: TagAiSuggestion[] }
  | { aiAvailable: false; reason: TagAiUnavailableReason };

export interface TableColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
}

export const DEFAULT_RESOURCE_COLUMNS: TableColumnConfig[] = [
  { id: "resource", label: "Recurso", visible: true, width: 260, minWidth: 160, maxWidth: 450 },
  { id: "type", label: "Tipo", visible: true, width: 180, minWidth: 120, maxWidth: 280 },
  { id: "subscription", label: "Suscripción", visible: true, width: 170, minWidth: 130, maxWidth: 280 },
  { id: "resourceGroup", label: "Grupo de Recursos", visible: true, width: 180, minWidth: 130, maxWidth: 280 },
  { id: "status", label: "Estado de Cumplimiento", visible: true, width: 160, minWidth: 130, maxWidth: 220 },
  { id: "missingTags", label: "Etiquetas Faltantes", visible: true, width: 220, minWidth: 150, maxWidth: 350 },
  { id: "actions", label: "Acciones", visible: true, width: 240, minWidth: 200, maxWidth: 350 },
];

export const DEFAULT_RG_COLUMNS: TableColumnConfig[] = [
  { id: "resourceGroup", label: "Grupo de Recursos", visible: true, width: 260, minWidth: 160, maxWidth: 450 },
  { id: "subscription", label: "Suscripción", visible: true, width: 180, minWidth: 130, maxWidth: 280 },
  { id: "location", label: "Región", visible: true, width: 140, minWidth: 100, maxWidth: 200 },
  { id: "status", label: "Estado de Cumplimiento", visible: true, width: 160, minWidth: 130, maxWidth: 220 },
  { id: "missingTags", label: "Etiquetas Faltantes", visible: true, width: 220, minWidth: 150, maxWidth: 350 },
  { id: "childCount", label: "Recursos Contenidos", visible: true, width: 150, minWidth: 120, maxWidth: 220 },
  { id: "actions", label: "Acciones", visible: true, width: 240, minWidth: 200, maxWidth: 350 },
];
