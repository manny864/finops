export interface TagPolicyRule {
  id: string;
  tagName: string;
  isRequired: boolean;
  allowedValues?: string[];
  /** Clave i18n de la descripcion; la politica sirve a los tres idiomas. */
  descriptionKey: string;
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
  childResourcesCount: number;
}

export interface TagGovernanceSummaryMetrics {
  overallCompliancePercentage: number;
  nonCompliantResourcesCount: number;
  nonCompliantResourceGroupsCount: number;
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
