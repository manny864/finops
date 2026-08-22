/**
 * Tipos TypeScript para el Motor de Auditoría y Remediación de Recursos Zombis en Azure
 * Soporta Omni-Scan 25 Resource Types, clasificación Hard vs Soft Waste,
 * persistencia de exenciones (whitelist) y caché de etiquetas optimistas.
 */

export type ZombieCategory = "HARD_WASTE" | "SOFT_WASTE_TAGS";

export type ZombieIssueType =
  | "DEALLOCATED_VM_WITH_DISKS"
  | "UNATTACHED_DISK"
  | "ORPHAN_PUBLIC_IP"
  | "ORPHAN_NIC"
  | "EMPTY_APP_SERVICE_PLAN"
  | "ORPHAN_RESTORE_POINT"
  | "ORPHAN_SNAPSHOT"
  | "MISSING_FINOPS_TAGS"
  | "EMPTY_RESOURCE_GROUP";

export interface ZombieResourceItem {
  id: string;
  name: string;
  resourceType: string;
  typeDisplayName: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  category: ZombieCategory;
  issueType: ZombieIssueType;
  issueDisplayName: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  monthlySavingsUSD: number;
  hasTags: boolean;
  currentTags: Record<string, string>;
  isExempted: boolean;
  exemptionReason?: string;
  exemptedAt?: string;
  expiresAt?: string | null;
}

export interface ZombieAuditSummaryMetrics {
  totalPotentialSavingsUSD: number;
  hardWasteZombiesCount: number;
  untaggedResourcesCount: number;
  exemptedResourcesCount: number;
  totalScannedResources: number;
  resources: ZombieResourceItem[];
}

export interface ZombieAuditPayload {
  metrics: ZombieAuditSummaryMetrics;
  source: "live" | "mock";
  lastUpdated: string;
}

export interface ZombieExemptionPayload {
  resourceId: string;
  resourceName?: string;
  resourceType?: string;
  reason: string;
  durationDays?: number;
}

export interface ZombieTagUpdatePayload {
  resourceIds: string[];
  tags: Record<string, string>;
}

export interface ZombieRemediationPayload {
  resourceIds: string[];
  actionType?: string;
}
