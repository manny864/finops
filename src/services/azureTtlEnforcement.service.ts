/**
 * Servicio Azure FinOps: Motor de Ciclo de Vida y Gobernanza TTL (Time-To-Live Enforcement)
 * Control de entornos efímeros, sandboxes, expiración basada en tags ExpireOn,
 * políticas en MySQL, histórico de eliminaciones y caché optimista.
 */

import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  TtlPolicyItem,
  UntaggedTtlResourceItem,
  TtlTrackedResourceItem,
  TtlDeletionRecord,
  TtlSummaryMetrics,
} from "@/types/azureTtlEnforcement.types";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";

export function formatRelativeTime(targetDate: Date, now = new Date()): { status: "CRITICAL" | "WARNING" | "ACTIVE"; key: TtlTrackedResourceItem["relativeTimeKey"]; value: number; daysDiff: number } {
  const diffMs = targetDate.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    const absDays = Math.abs(diffDays);
    const absHours = Math.abs(diffHours);
    if (absDays === 0) {
      return { status: "CRITICAL", key: "relExpiredHours", value: absHours, daysDiff: diffDays };
    }
    return { status: "CRITICAL", key: "relExpiredDays", value: absDays, daysDiff: diffDays };
  }

  if (diffDays <= 3) {
    if (diffDays === 0) {
      return { status: "WARNING", key: "relDueHours", value: Math.max(1, diffHours), daysDiff: diffDays };
    }
    return { status: "WARNING", key: "relDueDays", value: diffDays, daysDiff: diffDays };
  }

  return { status: "ACTIVE", key: "relDueDays", value: diffDays, daysDiff: diffDays };
}

export function formatDateIsoToLocal(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function computeTtlSummaryMetrics(
  policies: TtlPolicyItem[],
  untagged: UntaggedTtlResourceItem[],
  tracked: TtlTrackedResourceItem[],
  history: TtlDeletionRecord[]
): TtlSummaryMetrics {
  const activeTracked = tracked.filter((r) => !r.isExempted);
  const expiredResourcesCount = activeTracked.filter((r) => r.status === "CRITICAL").length;
  const warningResourcesCount = activeTracked.filter((r) => r.status === "WARNING").length;

  const potentialSavingsMonthlyUSD = Number(
    activeTracked
      .filter((r) => r.status === "CRITICAL")
      .reduce((sum, r) => sum + (r.monthlySavingsUSD || 0), 0)
      .toFixed(2)
  );

  const activePoliciesCount = policies.filter((p) => p.isEnabled).length;

  return {
    expiredResourcesCount,
    warningResourcesCount,
    potentialSavingsMonthlyUSD,
    activePoliciesCount,
    policies,
    untaggedResources: untagged,
    trackedResources: tracked,
    deletionHistory: history,
  };
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockTtlSummaryMetrics(tenantId: string): TtlSummaryMetrics {
  const isEnterprise = tenantId.includes("4444") || tenantId.includes("enterprise");
  const now = new Date();

  const dMinus5 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const dMinus2 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const dPlus1 = new Date(now.getTime() + 1.5 * 24 * 60 * 60 * 1000).toISOString();
  const dPlus2 = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const dPlus10 = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const dPlus20 = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString();

  const policies: TtlPolicyItem[] = [
    {
      id: "pol-1",
      name: "VMs de Testing & Sandbox",
      nameKey: "pol_VIRTUALMACHINES_name",
      targetResourceType: "VIRTUALMACHINES",
      maxLifespanDays: 14,
      description: "Máquinas virtuales efímeras creadas para pruebas de integración",
      descriptionKey: "pol_VIRTUALMACHINES_desc",
      isEnabled: true,
      notifyDaysBefore: 3,
      createdAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "pol-2",
      name: "Clústeres AKS Efímeros",
      nameKey: "pol_MANAGEDCLUSTERS_name",
      targetResourceType: "MANAGEDCLUSTERS",
      maxLifespanDays: 30,
      description: "Ambientes de Kubernetes de desarrollo y staging temporal",
      descriptionKey: "pol_MANAGEDCLUSTERS_desc",
      isEnabled: true,
      notifyDaysBefore: 5,
      createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "pol-3",
      name: "Bases de Datos Flexibles",
      nameKey: "pol_FLEXIBLESERVERS_name",
      targetResourceType: "FLEXIBLESERVERS",
      maxLifespanDays: 7,
      description: "Instancias PostgreSQL / MySQL para migración y smoke testing",
      descriptionKey: "pol_FLEXIBLESERVERS_desc",
      isEnabled: true,
      notifyDaysBefore: 2,
      createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  if (isEnterprise) {
    policies.push({
      id: "pol-4",
      name: "Grupos de Recursos Sandbox",
      nameKey: "pol_RESOURCEGROUPS_name",
      targetResourceType: "RESOURCEGROUPS",
      maxLifespanDays: 45,
      description: "Resource Groups asignados a laboratorios de arquitectura",
      descriptionKey: "pol_RESOURCEGROUPS_desc",
      isEnabled: true,
      notifyDaysBefore: 7,
      createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  const trackedResources: TtlTrackedResourceItem[] = [
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-qa-sandboxes/providers/Microsoft.Compute/virtualMachines/vm-qa-loadtest-01",
      name: "vm-qa-loadtest-01",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroup: "rg-qa-sandboxes",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      expirationDateIso: dMinus5,
      formattedExpirationDate: formatDateIsoToLocal(dMinus5),
      relativeTimeKey: "relExpiredDays",
      relativeTimeValue: 5,
      status: "CRITICAL",
      monthlySavingsUSD: 185.5,
      isExempted: false,
      daysUntilExpiry: -5,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-qa-sandboxes/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-ephemeral-test",
      name: "pg-ephemeral-test",
      resourceType: "microsoft.dbforpostgresql/flexibleservers",
      resourceGroup: "rg-qa-sandboxes",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      expirationDateIso: dMinus2,
      formattedExpirationDate: formatDateIsoToLocal(dMinus2),
      relativeTimeKey: "relExpiredDays",
      relativeTimeValue: 2,
      status: "CRITICAL",
      monthlySavingsUSD: 142.0,
      isExempted: false,
      daysUntilExpiry: -2,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-temp/providers/Microsoft.ContainerService/managedClusters/aks-sandbox-perf",
      name: "aks-sandbox-perf",
      resourceType: "microsoft.containerservice/managedclusters",
      resourceGroup: "rg-analytics-temp",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      expirationDateIso: dPlus1,
      formattedExpirationDate: formatDateIsoToLocal(dPlus1),
      relativeTimeKey: "relDueDays",
      relativeTimeValue: 1,
      status: "WARNING",
      monthlySavingsUSD: 290.0,
      isExempted: false,
      daysUntilExpiry: 1,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-analytics-temp/providers/Microsoft.Compute/virtualMachines/vm-etl-benchmark",
      name: "vm-etl-benchmark",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroup: "rg-analytics-temp",
      subscriptionId: "demo-sub-02",
      subscriptionName: "CSCS-DataPlatform-Analytics",
      expirationDateIso: dPlus2,
      formattedExpirationDate: formatDateIsoToLocal(dPlus2),
      relativeTimeKey: "relDueDays",
      relativeTimeValue: 2,
      status: "WARNING",
      monthlySavingsUSD: 120.0,
      isExempted: false,
      daysUntilExpiry: 2,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-core-dev/providers/Microsoft.Cache/redis/redis-dev-session",
      name: "redis-dev-session",
      resourceType: "microsoft.cache/redis",
      resourceGroup: "rg-core-dev",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      expirationDateIso: dPlus10,
      formattedExpirationDate: formatDateIsoToLocal(dPlus10),
      relativeTimeKey: "relDueDays",
      relativeTimeValue: 10,
      status: "ACTIVE",
      monthlySavingsUSD: 65.0,
      isExempted: false,
      daysUntilExpiry: 10,
    },
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-core-dev/providers/Microsoft.Compute/virtualMachines/vm-seed-database",
      name: "vm-seed-database",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroup: "rg-core-dev",
      subscriptionId: "demo-sub-01",
      subscriptionName: "CSCS-LandingZone-Production",
      expirationDateIso: dPlus20,
      formattedExpirationDate: formatDateIsoToLocal(dPlus20),
      relativeTimeKey: "relDueDays",
      relativeTimeValue: 20,
      status: "ACTIVE",
      monthlySavingsUSD: 110.0,
      isExempted: true,
      exemptionReason: "VM de semillas persistentes requerida para pipelines CI/CD",
      daysUntilExpiry: 20,
    },
  ];

  const untaggedResources: UntaggedTtlResourceItem[] = [
    {
      id: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-experiments/providers/Microsoft.Compute/virtualMachines/vm-experiment-gpu",
      name: "vm-experiment-gpu",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroup: "rg-dev-experiments",
      subscriptionId: "demo-sub-01",
      suggestedExpiryDate: formatDateIsoToLocal(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()),
      monthlyCostUSD: 310.0,
    },
    {
      id: "/subscriptions/demo-sub-02/resourceGroups/rg-poc-datalake/providers/Microsoft.ContainerService/managedClusters/aks-poc-cluster",
      name: "aks-poc-cluster",
      resourceType: "microsoft.containerservice/managedclusters",
      resourceGroup: "rg-poc-datalake",
      subscriptionId: "demo-sub-02",
      suggestedExpiryDate: formatDateIsoToLocal(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()),
      monthlyCostUSD: 240.0,
    },
  ];

  const deletionHistory: TtlDeletionRecord[] = [
    {
      id: "del-1",
      resourceName: "vm-loadtest-old",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroup: "rg-qa-sandboxes",
      expiredAtDate: formatDateIsoToLocal(new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString()),
      deletedBy: "system-ttl-cron@cscloudsolutions.com",
      deletedAtDate: formatDateIsoToLocal(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()),
      reclaimedMonthlyCostUSD: 185.0,
    },
    {
      id: "del-2",
      resourceName: "pg-temp-migration-01",
      resourceType: "microsoft.dbforpostgresql/flexibleservers",
      resourceGroup: "rg-analytics-temp",
      expiredAtDate: formatDateIsoToLocal(new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000).toISOString()),
      deletedBy: "admin@cscloudsolutions.com.ar",
      deletedAtDate: formatDateIsoToLocal(new Date(now.getTime() - 24 * 24 * 60 * 60 * 1000).toISOString()),
      reclaimedMonthlyCostUSD: 142.0,
    },
  ];

  return computeTtlSummaryMetrics(policies, untaggedResources, trackedResources, deletionHistory);
}

/**
 * Ensambla los datos en vivo combinando ARG, MySQL Policies y MySQL Deletion History.
 */
export async function assembleLiveTtlSummary(input: {
  tenantId: string;
  rawExpiredItems: any[];
  rawUntaggedItems: any[];
  policies: TtlPolicyItem[];
  deletionHistory: TtlDeletionRecord[];
  exemptions: Map<string, { reason: string }>;
  subNameMap: Map<string, string>;
}): Promise<TtlSummaryMetrics> {
  const {
    rawExpiredItems = [],
    rawUntaggedItems = [],
    policies = [],
    deletionHistory = [],
    exemptions,
    subNameMap,
  } = input;

  const now = new Date();

  const trackedResources: TtlTrackedResourceItem[] = rawExpiredItems.map((r) => {
    const resId = r.id || r.resourceId || "";
    const lowerId = resId.toLowerCase();
    const isExempted = exemptions.has(lowerId);
    const subId = r.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";

    const expIso = r.expirationDate || r.expireOn || r.tags?.ExpireOn || r.tags?.TTL || new Date().toISOString();
    const expDate = new Date(expIso);
    const validExpDate = isNaN(expDate.getTime()) ? now : expDate;

    const { status, key: relKey, value: relValue, daysDiff } = formatRelativeTime(validExpDate, now);

    return {
      id: resId,
      name: r.name || r.resourceName || resId.split("/").pop() || "resource",
      resourceType: r.type || r.resourceType || "unknown",
      resourceGroup: r.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      expirationDateIso: validExpDate.toISOString(),
      formattedExpirationDate: formatDateIsoToLocal(validExpDate.toISOString()),
      relativeTimeKey: relKey,
      relativeTimeValue: relValue,
      status,
      monthlySavingsUSD: Number(r.monthlyCost || r.monthlyCostUSD || 85.0),
      isExempted,
      exemptionReason: exemptions.get(lowerId)?.reason,
      daysUntilExpiry: daysDiff,
    };
  });

  const untaggedResources: UntaggedTtlResourceItem[] = rawUntaggedItems.map((r) => {
    const resId = r.id || "";
    const subId = r.subscriptionId || (resId.split("/subscriptions/")[1] || "").split("/")[0] || "";
    const suggestedIso = r.suggestedExpiration || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    return {
      id: resId,
      name: r.name || resId.split("/").pop() || "unlabeled-resource",
      resourceType: r.type || "unknown",
      resourceGroup: r.resourceGroup || (resId.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      suggestedExpiryDate: formatDateIsoToLocal(suggestedIso),
      monthlyCostUSD: Number(r.monthlyCost || 75.0),
    };
  });

  return computeTtlSummaryMetrics(policies, untaggedResources, trackedResources, deletionHistory);
}
