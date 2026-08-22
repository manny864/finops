/**
 * Servicio Azure FinOps: Motor de Detección, Exención y Remediación de Recursos Zombis
 * Soporta Omni-Scan (Hard Waste vs Soft Waste), persistencia de Exenciones (Whitelist)
 * y Caché de Etiquetas Optimistas en MySQL.
 */

import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  ZombieCategory,
  ZombieIssueType,
  ZombieResourceItem,
  ZombieAuditSummaryMetrics,
  ZombieAuditPayload,
  ZombieExemptionPayload,
} from "@/types/azureZombieAudit.types";
import { resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import crypto from "crypto";

export function formatResourceType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("microsoft.compute/disks")) return "Disco Administrado";
  if (t.includes("microsoft.compute/virtualmachines")) return "Máquina Virtual";
  if (t.includes("microsoft.network/publicipaddresses")) return "Dirección IP Pública";
  if (t.includes("microsoft.network/networkinterfaces")) return "Interfaz de Red (NIC)";
  if (t.includes("microsoft.web/serverfarms")) return "App Service Plan";
  if (t.includes("microsoft.compute/snapshots")) return "Snapshot de Disco";
  if (t.includes("microsoft.compute/restorepointcollections")) return "Restore Point";
  if (t.includes("microsoft.network/loadbalancers")) return "Load Balancer";
  if (t.includes("microsoft.network/virtualnetworkgateways")) return "VNet Gateway";
  if (t.includes("microsoft.network/applicationgateways")) return "Application Gateway";
  if (t.includes("microsoft.sql/servers/elasticpools")) return "SQL Elastic Pool";
  if (t.includes("microsoft.resources/subscriptions/resourcegroups")) return "Grupo de Recursos";
  return type.split("/").pop() || type;
}

export function computeZombieSummaryMetrics(
  resources: ZombieResourceItem[]
): ZombieAuditSummaryMetrics {
  const activeResources = resources.filter((r) => !r.isExempted);
  const hardWasteActive = activeResources.filter((r) => r.category === "HARD_WASTE");
  const untaggedActive = activeResources.filter((r) => !r.hasTags);
  const exempted = resources.filter((r) => r.isExempted);

  const totalPotentialSavingsUSD = Number(
    hardWasteActive.reduce((sum, r) => sum + r.monthlySavingsUSD, 0).toFixed(2)
  );

  return {
    totalPotentialSavingsUSD,
    hardWasteZombiesCount: hardWasteActive.length,
    untaggedResourcesCount: untaggedActive.length,
    exemptedResourcesCount: exempted.length,
    totalScannedResources: resources.length,
    resources,
  };
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockZombieAuditPayload(tenantId: string): ZombieAuditPayload {
  const isEnterprise = tenantId.includes("4444");

  const resources: ZombieResourceItem[] = [
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-analytics-prod/providers/Microsoft.Compute/disks/disk-temp-unattached-01",
      name: "disk-temp-unattached-01",
      resourceType: "microsoft.compute/disks",
      typeDisplayName: "Disco Administrado",
      location: "westus2",
      resourceGroup: "rg-analytics-prod",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-Production-LandingZone",
      category: "HARD_WASTE",
      issueType: "UNATTACHED_DISK",
      issueDisplayName: "Disco Huérfano (Unattached)",
      severity: "HIGH",
      monthlySavingsUSD: 19.05,
      hasTags: false,
      currentTags: {},
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-core-apps/providers/Microsoft.Compute/virtualMachines/vm-batch-worker-deallocated",
      name: "vm-batch-worker-deallocated",
      resourceType: "microsoft.compute/virtualmachines",
      typeDisplayName: "Máquina Virtual",
      location: "eastus",
      resourceGroup: "rg-core-apps",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-Production-LandingZone",
      category: "HARD_WASTE",
      issueType: "DEALLOCATED_VM_WITH_DISKS",
      issueDisplayName: "VM Apagada con Discos Activos",
      severity: "CRITICAL",
      monthlySavingsUSD: 38.5,
      hasTags: false,
      currentTags: { Environment: "Staging" },
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-networking-hub/providers/Microsoft.Network/publicIPAddresses/pip-legacy-gateway",
      name: "pip-legacy-gateway",
      resourceType: "microsoft.network/publicipaddresses",
      typeDisplayName: "Dirección IP Pública",
      location: "westus2",
      resourceGroup: "rg-networking-hub",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-Production-LandingZone",
      category: "HARD_WASTE",
      issueType: "ORPHAN_PUBLIC_IP",
      issueDisplayName: "IP Pública Huérfana",
      severity: "MEDIUM",
      monthlySavingsUSD: 4.25,
      hasTags: false,
      currentTags: {},
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-web-frontend/providers/Microsoft.Web/serverfarms/asp-empty-dev",
      name: "asp-empty-dev",
      resourceType: "microsoft.web/serverfarms",
      typeDisplayName: "App Service Plan",
      location: "eastus",
      resourceGroup: "rg-web-frontend",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-Production-LandingZone",
      category: "HARD_WASTE",
      issueType: "EMPTY_APP_SERVICE_PLAN",
      issueDisplayName: "App Service Plan Vacío (0 Apps)",
      severity: "HIGH",
      monthlySavingsUSD: 73.0,
      hasTags: true,
      currentTags: { Environment: "Dev", CostCenter: "Eng-Frontend", Owner: "DevTeam" },
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-data-warehouse/providers/Microsoft.Compute/snapshots/snap-backup-20251101",
      name: "snap-backup-20251101",
      resourceType: "microsoft.compute/snapshots",
      typeDisplayName: "Snapshot de Disco",
      location: "centralus",
      resourceGroup: "rg-data-warehouse",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      category: "HARD_WASTE",
      issueType: "ORPHAN_SNAPSHOT",
      issueDisplayName: "Snapshot Antiguo sin Uso (>90d)",
      severity: "LOW",
      monthlySavingsUSD: 12.8,
      hasTags: false,
      currentTags: {},
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-networking-hub/providers/Microsoft.Network/networkInterfaces/nic-orphaned-v1",
      name: "nic-orphaned-v1",
      resourceType: "microsoft.network/networkinterfaces",
      typeDisplayName: "Interfaz de Red (NIC)",
      location: "westus2",
      resourceGroup: "rg-networking-hub",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-Production-LandingZone",
      category: "SOFT_WASTE_TAGS",
      issueType: "ORPHAN_NIC",
      issueDisplayName: "NIC Huérfana sin VM Asociada",
      severity: "LOW",
      monthlySavingsUSD: 0,
      hasTags: false,
      currentTags: {},
      isExempted: false,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-dr-recovery/providers/Microsoft.Compute/disks/disk-dr-replica-standby",
      name: "disk-dr-replica-standby",
      resourceType: "microsoft.compute/disks",
      typeDisplayName: "Disco Administrado",
      location: "eastus2",
      resourceGroup: "rg-dr-recovery",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      category: "HARD_WASTE",
      issueType: "UNATTACHED_DISK",
      issueDisplayName: "Disco Huérfano (Eximido DR)",
      severity: "MEDIUM",
      monthlySavingsUSD: 24.5,
      hasTags: true,
      currentTags: { Environment: "DR", CostCenter: "SecOps", Owner: "CloudArch" },
      isExempted: true,
      exemptionReason: "Disco de réplica fría para Contingencia y Disaster Recovery (DR)",
      exemptedAt: "2026-08-01T10:00:00Z",
    },
  ];

  if (isEnterprise) {
    resources.push({
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-ai-services/providers/Microsoft.Compute/virtualMachines/vm-ml-training-stopped",
      name: "vm-ml-training-stopped",
      resourceType: "microsoft.compute/virtualmachines",
      typeDisplayName: "Máquina Virtual",
      location: "westus3",
      resourceGroup: "rg-ai-services",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      category: "HARD_WASTE",
      issueType: "DEALLOCATED_VM_WITH_DISKS",
      issueDisplayName: "VM GPU Apagada con Almacenamiento Premium",
      severity: "CRITICAL",
      monthlySavingsUSD: 145.0,
      hasTags: true,
      currentTags: { CostCenter: "AI-Research" },
      isExempted: false,
    });
  }

  const metrics = computeZombieSummaryMetrics(resources);

  return {
    metrics,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Consulta de Exenciones desde la base de datos MySQL
 */
export async function getZombieExemptions(tenantId: string): Promise<Map<string, { reason: string; exemptedAt: string; expiresAt?: string | null }>> {
  const map = new Map<string, { reason: string; exemptedAt: string; expiresAt?: string | null }>();
  try {
    const [rows]: any = await pool.query(
      `SELECT resource_id, exemption_reason, exempted_at, expires_at
       FROM ZombieExemptions
       WHERE tenant_id = ?
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [tenantId]
    );

    for (const r of rows || []) {
      if (r.resource_id) {
        map.set(r.resource_id.toLowerCase(), {
          reason: r.exemption_reason || "Eximida por el usuario",
          exemptedAt: r.exempted_at ? new Date(r.exempted_at).toISOString() : new Date().toISOString(),
          expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        });
      }
    }
  } catch (err) {
    console.warn("[ZombieAudit] Error leyendo ZombieExemptions:", errorMessage(err));
  }
  return map;
}

/**
 * Consulta de Etiquetas Cacheadas Optimistamente
 */
export async function getLocalTagsCache(tenantId: string): Promise<Map<string, Record<string, string>>> {
  const map = new Map<string, Record<string, string>>();
  try {
    const [rows]: any = await pool.query(
      `SELECT resource_id, tags_json
       FROM LocalResourceTagsCache
       WHERE tenant_id = ?`,
      [tenantId]
    );

    for (const r of rows || []) {
      if (r.resource_id) {
        try {
          const tags = typeof r.tags_json === "string" ? JSON.parse(r.tags_json) : r.tags_json;
          map.set(r.resource_id.toLowerCase(), tags || {});
        } catch {}
      }
    }
  } catch (err) {
    console.warn("[ZombieAudit] Error leyendo LocalResourceTagsCache:", errorMessage(err));
  }
  return map;
}

/**
 * Guarda o actualiza una exención en MySQL
 */
export async function saveZombieExemption(
  tenantId: string,
  payload: ZombieExemptionPayload,
  user: string
): Promise<void> {
  const id = crypto.randomUUID();
  let expiresAtSql: Date | null = null;
  if (payload.durationDays && payload.durationDays > 0) {
    expiresAtSql = new Date();
    expiresAtSql.setDate(expiresAtSql.getDate() + payload.durationDays);
  }

  await pool.query(
    `INSERT INTO ZombieExemptions
      (id, tenant_id, resource_id, resource_name, resource_type, exemption_reason, exempted_by, exempted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
      exemption_reason = VALUES(exemption_reason),
      exempted_by = VALUES(exempted_by),
      exempted_at = NOW(),
      expires_at = VALUES(expires_at)`,
    [
      id,
      tenantId,
      payload.resourceId,
      payload.resourceName || payload.resourceId.split("/").pop() || "resource",
      payload.resourceType || "unknown",
      payload.reason || "Eximido por el usuario",
      user || "admin",
      expiresAtSql,
    ]
  );
}

/**
 * Elimina una exención en MySQL
 */
export async function deleteZombieExemption(tenantId: string, resourceId: string): Promise<void> {
  await pool.query(
    `DELETE FROM ZombieExemptions WHERE tenant_id = ? AND resource_id = ?`,
    [tenantId, resourceId]
  );
}

/**
 * Guarda etiquetas en la caché optimista de MySQL
 */
export async function saveLocalResourceTags(
  tenantId: string,
  resourceIds: string[],
  tags: Record<string, string>
): Promise<void> {
  for (const resId of resourceIds) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO LocalResourceTagsCache
        (id, tenant_id, resource_id, tags_json, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
        tags_json = VALUES(tags_json),
        updated_at = NOW()`,
      [id, tenantId, resId, JSON.stringify(tags)]
    );
  }
}

/**
 * Ensambla los recursos auditados en vivo combinando ARG, Exenciones y Tags locales.
 */
export function assembleLiveZombieAudit(input: {
  rawItems: any[];
  exemptions: Map<string, { reason: string; exemptedAt: string; expiresAt?: string | null }>;
  localTags: Map<string, Record<string, string>>;
}): ZombieAuditPayload {
  const { rawItems, exemptions, localTags } = input;

  const REQUIRED_TAGS = ["Environment", "CostCenter", "Owner"];

  const resources: ZombieResourceItem[] = rawItems.map((item) => {
    const resId = item.id || item.resourceId || "";
    const lowerId = resId.toLowerCase();
    const cachedTagRecord = localTags.get(lowerId);

    const mergedTags: Record<string, string> = {
      ...(item.tags || {}),
      ...(cachedTagRecord || {}),
    };

    const hasRequiredTags = REQUIRED_TAGS.every((tagKey) => {
      const val = mergedTags[tagKey] || mergedTags[tagKey.toLowerCase()];
      return typeof val === "string" && val.trim().length > 0;
    });

    const exInfo = exemptions.get(lowerId);
    const isExempted = Boolean(exInfo);

    let category: ZombieCategory = "HARD_WASTE";
    let issueType: ZombieIssueType = "UNATTACHED_DISK";
    let issueDisplayName = "Recurso Zombi";
    let severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";

    const typeLower = (item.type || item.resourceType || "").toLowerCase();

    if (typeLower.includes("microsoft.compute/disks")) {
      issueType = "UNATTACHED_DISK";
      issueDisplayName = "Disco Huérfano (Unattached)";
      severity = "HIGH";
    } else if (typeLower.includes("microsoft.compute/virtualmachines")) {
      issueType = "DEALLOCATED_VM_WITH_DISKS";
      issueDisplayName = "VM Apagada con Discos Activos";
      severity = "CRITICAL";
    } else if (typeLower.includes("microsoft.network/publicipaddresses")) {
      issueType = "ORPHAN_PUBLIC_IP";
      issueDisplayName = "IP Pública Huérfana";
      severity = "MEDIUM";
    } else if (typeLower.includes("microsoft.network/networkinterfaces")) {
      issueType = "ORPHAN_NIC";
      issueDisplayName = "NIC Huérfana sin VM";
      severity = "LOW";
    } else if (typeLower.includes("microsoft.web/serverfarms")) {
      issueType = "EMPTY_APP_SERVICE_PLAN";
      issueDisplayName = "App Service Plan Vacío";
      severity = "HIGH";
    } else if (typeLower.includes("microsoft.compute/snapshots")) {
      issueType = "ORPHAN_SNAPSHOT";
      issueDisplayName = "Snapshot Huérfano / Antiguo";
      severity = "LOW";
    } else if (item.isHygiene || !hasRequiredTags) {
      category = "SOFT_WASTE_TAGS";
      issueType = "MISSING_FINOPS_TAGS";
      issueDisplayName = "Sin Etiquetas FinOps Mínimas";
      severity = "LOW";
    }

    const monthlyCost = Number(item.monthlyCost || item.estimatedMonthlyCost || 0);

    return {
      id: resId,
      name: item.name || resId.split("/").pop() || "resource",
      resourceType: item.type || item.resourceType || "unknown",
      typeDisplayName: formatResourceType(item.type || item.resourceType || "unknown"),
      location: item.location || "global",
      resourceGroup: item.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "default-rg",
      subscriptionId: item.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "default-sub",
      subscriptionName: resolveSubscriptionName(item.subscriptionName || item.subscriptionId, new Map()),
      category,
      issueType,
      issueDisplayName,
      severity,
      monthlySavingsUSD: monthlyCost,
      hasTags: hasRequiredTags,
      currentTags: mergedTags,
      isExempted,
      exemptionReason: exInfo?.reason,
      exemptedAt: exInfo?.exemptedAt,
      expiresAt: exInfo?.expiresAt,
    };
  });

  const metrics = computeZombieSummaryMetrics(resources);

  return {
    metrics,
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}
