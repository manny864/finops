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

/**
 * ARM type -> clave de catalogo del rotulo legible.
 *
 * El servidor arma `typeDisplayName` / `issueDisplayName` en castellano
 * (`formatResourceType`, la clasificacion de `assembleLiveZombieAudit`) porque
 * no conoce el locale del usuario, y esas cadenas salian crudas en la tabla.
 * El token que SI viaja bien es el discriminador — `resourceType` y
 * `issueType` — asi que la pantalla resuelve el rotulo desde estos mapas y
 * deja los campos `*DisplayName` como fallback para tipos no mapeados.
 *
 * El match es por `includes` sobre el type en minusculas, igual que
 * `formatResourceType`, porque ARM devuelve el casing sin normalizar.
 */
export const ZOMBIE_TYPE_KEYS: Array<[string, string]> = [
  ["microsoft.compute/disks", "rtype_managed_disk"],
  ["microsoft.compute/virtualmachines", "rtype_vm"],
  ["microsoft.network/publicipaddresses", "rtype_public_ip"],
  ["microsoft.network/networkinterfaces", "rtype_nic"],
  ["microsoft.web/serverfarms", "rtype_app_service_plan"],
  ["microsoft.compute/snapshots", "rtype_snapshot"],
  ["microsoft.compute/restorepointcollections", "rtype_restore_point"],
  ["microsoft.network/loadbalancers", "rtype_load_balancer"],
  ["microsoft.network/virtualnetworkgateways", "rtype_vnet_gateway"],
  ["microsoft.network/applicationgateways", "rtype_app_gateway"],
  ["microsoft.sql/servers/elasticpools", "rtype_sql_elastic_pool"],
  ["microsoft.resources/subscriptions/resourcegroups", "rtype_resource_group"],
];

export function zombieTypeKey(resourceType: string): string | undefined {
  const t = (resourceType || "").toLowerCase();
  return ZOMBIE_TYPE_KEYS.find(([arm]) => t.includes(arm))?.[1];
}

export const ZOMBIE_ISSUE_KEYS: Record<ZombieIssueType, string> = {
  DEALLOCATED_VM_WITH_DISKS: "issue_deallocated_vm",
  UNATTACHED_DISK: "issue_unattached_disk",
  ORPHAN_PUBLIC_IP: "issue_orphan_public_ip",
  ORPHAN_NIC: "issue_orphan_nic",
  EMPTY_APP_SERVICE_PLAN: "issue_empty_asp",
  ORPHAN_RESTORE_POINT: "issue_orphan_restore_point",
  ORPHAN_SNAPSHOT: "issue_orphan_snapshot",
  MISSING_FINOPS_TAGS: "issue_missing_tags",
  EMPTY_RESOURCE_GROUP: "issue_empty_rg",
};

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
