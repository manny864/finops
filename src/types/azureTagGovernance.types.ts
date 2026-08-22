export interface TagPolicyRule {
  id: string;
  tagName: string;
  isRequired: boolean;
  allowedValues?: string[];
  description: string;
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
