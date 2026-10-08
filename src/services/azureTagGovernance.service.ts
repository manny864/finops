import { TokenCredential } from "@azure/identity";
import { getResourceGraphClient } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { errorMessage } from "@/lib/apiErrors";
import { findInvalidTagValues, parseAllowedValues, type TagValueAlias } from "@/lib/tagValueNormalizer";
import {
  TagPolicyRule,
  ResourceTagAuditItem,
  ResourceGroupTagAuditItem,
  TagGovernanceSummaryMetrics,
} from "@/types/azureTagGovernance.types";

export const DEFAULT_MANDATORY_TAG_POLICIES: TagPolicyRule[] = [
  {
    id: "policy-env",
    tagName: "Environment",
    isRequired: true,
    allowedValues: ["prod", "stg", "dev", "qa", "sandbox"],
    descriptionKey: "policyEnvironmentDesc",
  },
  {
    id: "policy-role",
    tagName: "Role",
    isRequired: true,
    allowedValues: ["database", "api", "frontend", "backup", "orchestrator", "network", "storage", "worker"],
    descriptionKey: "policyRoleDesc",
  },
  {
    id: "policy-costcenter",
    tagName: "CostCenter",
    isRequired: true,
    descriptionKey: "policyCostCenterDesc",
  },
  {
    id: "policy-dept",
    tagName: "Department",
    isRequired: true,
    descriptionKey: "policyDepartmentDesc",
  },
];

/**
 * Normaliza y formatea el tipo de recurso para visualización limpia
 */
export function formatResourceTypeDisplay(type: string): string {
  if (!type) return "RECURSO";
  const parts = type.split("/");
  const last = parts[parts.length - 1] || type;
  return last.toUpperCase();
}

/**
 * Compara las tags de un recurso con las políticas obligatorias
 */
export function evaluateResourceMissingTags(
  currentTags: Record<string, string>,
  policies: TagPolicyRule[] = DEFAULT_MANDATORY_TAG_POLICIES
): string[] {
  const normalizedCurrentKeys = Object.keys(currentTags || {}).map((k) => k.toLowerCase());
  const missing: string[] = [];

  for (const pol of policies) {
    if (!pol.isRequired) continue;
    const polKeyLower = pol.tagName.toLowerCase();
    const foundIdx = normalizedCurrentKeys.indexOf(polKeyLower);
    if (foundIdx === -1) {
      missing.push(pol.tagName);
    } else {
      const origKey = Object.keys(currentTags)[foundIdx];
      const val = currentTags[origKey];
      if (!val || val.trim() === "") {
        missing.push(pol.tagName);
      }
    }
  }

  return missing;
}

/**
 * Políticas efectivas del tenant: las que definió en TaggingPolicies o, si no
 * definió ninguna (o la tabla no se puede leer), las de la casa. Definir una
 * sola reemplaza a todas las por defecto.
 */
export async function getTenantTagPolicies(tenantId: string): Promise<TagPolicyRule[]> {
  try {
    const [rows] = await pool.query(
      `SELECT id, policy_name, is_required, allowed_values
         FROM TaggingPolicies WHERE tenant_id = ? ORDER BY id`,
      [tenantId]
    );
    const filas = Array.isArray(rows)
      ? (rows as Array<{ id: number; policy_name: string; is_required: number | null; allowed_values: unknown }>)
      : [];
    if (filas.length === 0) return DEFAULT_MANDATORY_TAG_POLICIES;
    return filas.map((r) => ({
      id: `tenant-policy-${r.id}`,
      tagName: r.policy_name,
      isRequired: Number(r.is_required ?? 1) === 1,
      allowedValues: parseAllowedValues(r.allowed_values) ?? undefined,
      descriptionKey: DEFAULT_MANDATORY_TAG_POLICIES.find(
        (d) => d.tagName.toLowerCase() === r.policy_name.toLowerCase()
      )?.descriptionKey,
    }));
  } catch (err) {
    console.warn("[azureTagGovernance] Error leyendo TaggingPolicies, se usan las por defecto:", errorMessage(err));
    return DEFAULT_MANDATORY_TAG_POLICIES;
  }
}

/**
 * Alias de valores (TagValueAliases) indexados por nombre de tag en minúsculas:
 * primero los del tenant y después los globales, así los del tenant ganan.
 */
export async function getTagValueAliases(tenantId: string): Promise<Map<string, TagValueAlias[]>> {
  const porTag = new Map<string, TagValueAlias[]>();
  try {
    const [rows] = await pool.query(
      `SELECT tag_name, alias, canonical_value FROM TagValueAliases
        WHERE tenant_id = ? OR tenant_id IS NULL
        ORDER BY (tenant_id IS NULL), id`,
      [tenantId]
    );
    for (const r of (Array.isArray(rows) ? rows : []) as Array<{ tag_name: string; alias: string; canonical_value: string }>) {
      const k = r.tag_name.toLowerCase();
      const lista = porTag.get(k) || [];
      lista.push({ alias: r.alias, canonicalValue: r.canonical_value });
      porTag.set(k, lista);
    }
  } catch (err) {
    console.warn("[azureTagGovernance] Error leyendo TagValueAliases:", errorMessage(err));
  }
  return porTag;
}

/**
 * Lee la caché local de tags optimistas desde MySQL
 */
export async function getLocalCachedTags(tenantId: string): Promise<Map<string, Record<string, string>>> {
  const cacheMap = new Map<string, Record<string, string>>();
  try {
    const [rows]: any = await pool.query(
      `SELECT resource_id, tags_json
       FROM LocalResourceTagsCache
       WHERE tenant_id = ?`,
      [tenantId]
    );

    if (Array.isArray(rows)) {
      for (const row of rows) {
        try {
          const parsed = typeof row.tags_json === "string" ? JSON.parse(row.tags_json) : row.tags_json;
          if (parsed && typeof parsed === "object") {
            cacheMap.set(row.resource_id.toLowerCase(), parsed);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } catch (err) {
    console.warn("[azureTagGovernance] Error leyendo LocalResourceTagsCache:", errorMessage(err));
  }
  return cacheMap;
}

/**
 * Guarda o actualiza etiquetas optimistas en LocalResourceTagsCache
 */
export async function saveLocalCachedTags(
  tenantId: string,
  resourceId: string,
  tags: Record<string, string>
): Promise<void> {
  try {
    const id = `tag_${tenantId}_${Buffer.from(resourceId).toString("base64").slice(0, 32)}`;
    await pool.query(
      `INSERT INTO LocalResourceTagsCache (id, tenant_id, resource_id, tags_json, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE tags_json = VALUES(tags_json), updated_at = NOW()`,
      [id, tenantId, resourceId, JSON.stringify(tags)]
    );
  } catch (err) {
    console.warn("[azureTagGovernance] Error guardando LocalResourceTagsCache:", errorMessage(err));
  }
}

/**
 * Escanea recursos y grupos de recursos en vivo vía Azure Resource Graph
 */
export async function scanTagGovernanceLive(
  credential: TokenCredential,
  subscriptions: string[],
  tenantId: string
): Promise<TagGovernanceSummaryMetrics> {
  const client = await getResourceGraphClient(tenantId, credential);
  const [localCache, policies, aliases] = await Promise.all([
    getLocalCachedTags(tenantId),
    getTenantTagPolicies(tenantId),
    getTagValueAliases(tenantId),
  ]);

  // 1. KQL para Recursos
  const resourcesKql = `
    resources
    | project id, name, type, subscriptionId, resourceGroup, location, tags
    | limit 1000
  `;

  // 2. KQL para Resource Groups
  const rgsKql = `
    resourcecontainers
    | where type == 'microsoft.resources/subscriptions/resourcegroups'
    | project id, name, subscriptionId, location, tags
    | limit 500
  `;

  // 3. KQL para conteo de hijos por RG
  const childCountsKql = `
    resources
    | summarize childCount = count() by subscriptionId, resourceGroup
  `;

  const subMap = await getSubscriptionNameMap(tenantId, credential);

  const [resResult, rgsResult, countsResult] = await Promise.all([
    client.resources({ query: resourcesKql, subscriptions }),
    client.resources({ query: rgsKql, subscriptions }),
    client.resources({ query: childCountsKql, subscriptions }),
  ]);

  const childCountsMap = new Map<string, number>();
  if (Array.isArray(countsResult.data)) {
    for (const r of countsResult.data) {
      const key = `${(r.subscriptionId || "").toLowerCase()}::${(r.resourceGroup || "").toLowerCase()}`;
      childCountsMap.set(key, Number(r.childCount || 0));
    }
  }

  // Procesar Recursos
  const processedResources: ResourceTagAuditItem[] = [];
  let nonCompliantResCount = 0;
  let invalidValueResCount = 0;
  const missingTagFreqMap: Record<string, number> = {};

  if (Array.isArray(resResult.data)) {
    for (const raw of resResult.data) {
      const subId = raw.subscriptionId || "";
      const subName = resolveSubscriptionName(subId, subMap);
      const resId = raw.id || "";
      const cachedTags = localCache.get(resId.toLowerCase());
      const rawTags: Record<string, string> =
        cachedTags || (raw.tags && typeof raw.tags === "object" ? raw.tags : {});

      const missing = evaluateResourceMissingTags(rawTags, policies);
      const invalid = findInvalidTagValues(rawTags, policies, aliases);
      const isCompliant = missing.length === 0 && invalid.length === 0;
      if (invalid.length > 0) invalidValueResCount++;

      if (!isCompliant) {
        nonCompliantResCount++;
        for (const m of missing) {
          missingTagFreqMap[m] = (missingTagFreqMap[m] || 0) + 1;
        }
      }

      processedResources.push({
        id: resId,
        resourceName: raw.name || resId.split("/").pop() || "recurso",
        resourceType: raw.type || "Desconocido",
        resourceTypeDisplay: formatResourceTypeDisplay(raw.type || ""),
        subscriptionId: subId,
        subscriptionName: subName,
        resourceGroup: raw.resourceGroup || "default-rg",
        location: raw.location || "global",
        complianceStatus: isCompliant ? "COMPLIANT" : "NON_COMPLIANT",
        currentTags: rawTags,
        missingTags: missing,
        invalidTags: invalid,
      });
    }
  }

  // Procesar Resource Groups
  const processedRgs: ResourceGroupTagAuditItem[] = [];
  let nonCompliantRgsCount = 0;
  let invalidValueRgsCount = 0;

  if (Array.isArray(rgsResult.data)) {
    for (const raw of rgsResult.data) {
      const subId = raw.subscriptionId || "";
      const subName = resolveSubscriptionName(subId, subMap);
      const rgId = raw.id || "";
      const rgName = raw.name || rgId.split("/").pop() || "rg";
      const cachedTags = localCache.get(rgId.toLowerCase());
      const rawTags: Record<string, string> =
        cachedTags || (raw.tags && typeof raw.tags === "object" ? raw.tags : {});

      const missing = evaluateResourceMissingTags(rawTags, policies);
      const invalid = findInvalidTagValues(rawTags, policies, aliases);
      const isCompliant = missing.length === 0 && invalid.length === 0;
      if (invalid.length > 0) invalidValueRgsCount++;

      if (!isCompliant) {
        nonCompliantRgsCount++;
        for (const m of missing) {
          missingTagFreqMap[m] = (missingTagFreqMap[m] || 0) + 1;
        }
      }

      const countKey = `${subId.toLowerCase()}::${rgName.toLowerCase()}`;
      const childCount = childCountsMap.get(countKey) || 0;

      processedRgs.push({
        id: rgId,
        resourceGroupName: rgName,
        subscriptionId: subId,
        subscriptionName: subName,
        location: raw.location || "global",
        complianceStatus: isCompliant ? "COMPLIANT" : "NON_COMPLIANT",
        currentTags: rawTags,
        missingTags: missing,
        invalidTags: invalid,
        childResourcesCount: childCount,
      });
    }
  }

  const totalScanned = processedResources.length;
  const totalRgs = processedRgs.length;
  const compliantCount = totalScanned - nonCompliantResCount;
  const overallPercentage =
    totalScanned > 0 ? Number(((compliantCount / totalScanned) * 100).toFixed(1)) : 100;

  // Encontrar tag más omitida
  let mostFreq = "CostCenter & Role";
  let maxCount = 0;
  for (const [tag, count] of Object.entries(missingTagFreqMap)) {
    if (count > maxCount) {
      maxCount = count;
      mostFreq = tag;
    }
  }

  return {
    overallCompliancePercentage: overallPercentage,
    nonCompliantResourcesCount: nonCompliantResCount,
    nonCompliantResourceGroupsCount: nonCompliantRgsCount,
    invalidValueResourcesCount: invalidValueResCount,
    invalidValueResourceGroupsCount: invalidValueRgsCount,
    totalScannedResources: totalScanned,
    totalScannedResourceGroups: totalRgs,
    mostFrequentMissingTag: mostFreq,
    mandatoryPolicies: policies,
    resources: processedResources,
    resourceGroups: processedRgs,
  };
}

/**
 * Sugiere etiquetas de forma inteligente según nombre, tipo y grupo de recursos
 */
export function suggestTagsForResource(
  resourceName: string,
  resourceType: string,
  resourceGroup: string
): Record<string, string> {
  const nameLower = (resourceName || "").toLowerCase();
  const rgLower = (resourceGroup || "").toLowerCase();
  const typeLower = (resourceType || "").toLowerCase();

  // Inferencia de Environment
  let env = "prod";
  if (nameLower.includes("dev") || rgLower.includes("dev")) env = "dev";
  else if (nameLower.includes("stg") || nameLower.includes("stage") || rgLower.includes("stg")) env = "stg";
  else if (nameLower.includes("qa") || nameLower.includes("test") || rgLower.includes("qa")) env = "qa";
  else if (nameLower.includes("sbx") || nameLower.includes("sandbox") || rgLower.includes("sandbox")) env = "sandbox";

  // Inferencia de Role
  let role = "worker";
  if (nameLower.includes("sql") || nameLower.includes("db") || nameLower.includes("mysql") || typeLower.includes("database")) {
    role = "database";
  } else if (nameLower.includes("api") || nameLower.includes("gateway") || typeLower.includes("apimanagement")) {
    role = "api";
  } else if (nameLower.includes("front") || nameLower.includes("ui") || nameLower.includes("web") || typeLower.includes("sites")) {
    role = "frontend";
  } else if (nameLower.includes("backup") || nameLower.includes("vault") || typeLower.includes("recoveryservices")) {
    role = "backup";
  } else if (nameLower.includes("disk") || typeLower.includes("disks")) {
    role = "database-disk";
  } else if (nameLower.includes("vnet") || nameLower.includes("nsg") || nameLower.includes("pip") || typeLower.includes("network")) {
    role = "network";
  } else if (nameLower.includes("storage") || typeLower.includes("storageaccounts")) {
    role = "storage";
  }

  // Inferencia de CostCenter
  let costCenter = "Engineering";
  if (rgLower.includes("finops") || nameLower.includes("finops")) costCenter = "FinOps";
  else if (rgLower.includes("core") || nameLower.includes("core")) costCenter = "CorePlatform";
  else if (rgLower.includes("sec") || nameLower.includes("security")) costCenter = "SecurityOps";
  else if (rgLower.includes("data") || nameLower.includes("data")) costCenter = "DataTeam";

  // Inferencia de Department
  let department = "CloudOps";
  if (role === "database" || role === "database-disk") department = "DataPlatform";
  else if (role === "frontend" || role === "api") department = "Engineering";
  else if (role === "network" || role === "backup") department = "SecurityOps";

  return {
    Environment: env,
    Role: role,
    CostCenter: costCenter,
    Department: department,
  };
}

/** Un puñado de los alias globales de 20261008-012, para que la demo sugiera como el escaneo real. */
const MOCK_TAG_VALUE_ALIASES = new Map<string, TagValueAlias[]>([
  ["environment", [
    { alias: "production", canonicalValue: "prod" },
    { alias: "development", canonicalValue: "dev" },
    { alias: "staging", canonicalValue: "stg" },
  ]],
  ["role", [
    { alias: "web", canonicalValue: "frontend" },
    { alias: "db", canonicalValue: "database" },
  ]],
]);

/**
 * Dataset Mock Determinista para Tenants Demo
 */
export function getMockTagGovernanceSummary(tenantId: string = "demo-tenant"): TagGovernanceSummaryMetrics {
  const mockRgs: ResourceGroupTagAuditItem[] = [
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-cscs-core-prod",
      resourceGroupName: "rg-cscs-core-prod",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      location: "eastus",
      complianceStatus: "COMPLIANT",
      currentTags: {
        Environment: "prod",
        Role: "orchestrator",
        CostCenter: "CorePlatform",
        Department: "CloudOps",
      },
      missingTags: [],
      childResourcesCount: 18,
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-data-analytics-dev",
      resourceGroupName: "rg-data-analytics-dev",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      location: "westus2",
      complianceStatus: "NON_COMPLIANT",
      currentTags: {
        Environment: "Development",
        Department: "DataTeam",
      },
      missingTags: ["Role", "CostCenter"],
      childResourcesCount: 24,
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-backups-dr",
      resourceGroupName: "rg-backups-dr",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      location: "eastus2",
      complianceStatus: "COMPLIANT",
      currentTags: {
        Environment: "prod",
        Role: "backup",
        CostCenter: "FinOps",
        Department: "SecurityOps",
      },
      missingTags: [],
      childResourcesCount: 8,
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-legacy-sandbox",
      resourceGroupName: "rg-legacy-sandbox",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      location: "centralus",
      complianceStatus: "NON_COMPLIANT",
      currentTags: {},
      missingTags: ["Environment", "Role", "CostCenter", "Department"],
      childResourcesCount: 15,
    },
  ];

  const mockResources: ResourceTagAuditItem[] = [
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-cscs-core-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-app-01",
      resourceName: "vm-prod-app-01",
      resourceType: "Microsoft.Compute/virtualMachines",
      resourceTypeDisplay: "VIRTUALMACHINES",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-cscs-core-prod",
      location: "eastus",
      complianceStatus: "COMPLIANT",
      currentTags: {
        Environment: "prod",
        Role: "api",
        CostCenter: "CorePlatform",
        Department: "CloudOps",
      },
      missingTags: [],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-cscs-core-prod/providers/Microsoft.Compute/disks/vm-prod-app-01_OsDisk_1",
      resourceName: "vm-prod-app-01_OsDisk_1",
      resourceType: "Microsoft.Compute/disks",
      resourceTypeDisplay: "DISKS",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-cscs-core-prod",
      location: "eastus",
      complianceStatus: "NON_COMPLIANT",
      currentTags: {
        Environment: "prod",
      },
      missingTags: ["Role", "CostCenter", "Department"],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-data-analytics-dev/providers/Microsoft.DataFactory/factories/adf-analytics-pipeline-dev",
      resourceName: "adf-analytics-pipeline-dev",
      resourceType: "Microsoft.DataFactory/factories",
      resourceTypeDisplay: "FACTORIES",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-data-analytics-dev",
      location: "westus2",
      complianceStatus: "NON_COMPLIANT",
      currentTags: {
        Environment: "dev",
        Department: "DataTeam",
      },
      missingTags: ["Role", "CostCenter"],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-data-analytics-dev/providers/Microsoft.Storage/storageAccounts/stanalyticsdata01dev",
      resourceName: "stanalyticsdata01dev",
      resourceType: "Microsoft.Storage/storageAccounts",
      resourceTypeDisplay: "STORAGEACCOUNTS",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-data-analytics-dev",
      location: "westus2",
      complianceStatus: "NON_COMPLIANT",
      currentTags: {
        Environment: "dev",
      },
      missingTags: ["Role", "CostCenter", "Department"],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-backups-dr/providers/Microsoft.RecoveryServices/vaults/rsv-primary-backup-prod",
      resourceName: "rsv-primary-backup-prod",
      resourceType: "Microsoft.RecoveryServices/vaults",
      resourceTypeDisplay: "VAULTS",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-backups-dr",
      location: "eastus2",
      complianceStatus: "COMPLIANT",
      currentTags: {
        Environment: "prod",
        Role: "backup",
        CostCenter: "FinOps",
        Department: "SecurityOps",
      },
      missingTags: [],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-legacy-sandbox/providers/Microsoft.Network/publicIPAddresses/pip-legacy-ingress-sbx",
      resourceName: "pip-legacy-ingress-sbx",
      resourceType: "Microsoft.Network/publicIPAddresses",
      resourceTypeDisplay: "PUBLICIPADDRESSES",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-legacy-sandbox",
      location: "centralus",
      complianceStatus: "NON_COMPLIANT",
      currentTags: {},
      missingTags: ["Environment", "Role", "CostCenter", "Department"],
    },
    // Valores no permitidos: los resuelve el normalizador (alias, forma o tipeo)
    // salvo "k8s-cluster" y "pruebas", que quedan para la IA o una corrección manual.
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-cscs-core-prod/providers/Microsoft.Web/sites/app-checkout-prod",
      resourceName: "app-checkout-prod",
      resourceType: "Microsoft.Web/sites",
      resourceTypeDisplay: "SITES",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-cscs-core-prod",
      location: "eastus",
      complianceStatus: "NON_COMPLIANT",
      currentTags: { Environment: "Production", Role: "web", CostCenter: "CorePlatform", Department: "Engineering" },
      missingTags: [],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-cscs-core-prod/providers/Microsoft.Sql/servers/sql-orders-prod",
      resourceName: "sql-orders-prod",
      resourceType: "Microsoft.Sql/servers",
      resourceTypeDisplay: "SERVERS",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-cscs-core-prod",
      location: "eastus",
      complianceStatus: "NON_COMPLIANT",
      currentTags: { environment: "PROD", Role: "Data Base", CostCenter: "CorePlatform", Department: "DataPlatform" },
      missingTags: [],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-cscs-core-prod/providers/Microsoft.ContainerService/managedClusters/aks-platform-prod",
      resourceName: "aks-platform-prod",
      resourceType: "Microsoft.ContainerService/managedClusters",
      resourceTypeDisplay: "MANAGEDCLUSTERS",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-cscs-core-prod",
      location: "eastus",
      complianceStatus: "NON_COMPLIANT",
      currentTags: { Environment: "prod", Role: "k8s-cluster", CostCenter: "CorePlatform", Department: "CloudOps" },
      missingTags: [],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-backups-dr/providers/Microsoft.Storage/storageAccounts/stfinopsexports",
      resourceName: "stfinopsexports",
      resourceType: "Microsoft.Storage/storageAccounts",
      resourceTypeDisplay: "STORAGEACCOUNTS",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-backups-dr",
      location: "eastus2",
      complianceStatus: "NON_COMPLIANT",
      currentTags: { Environment: "prod", Role: "storge", CostCenter: "FinOps", Department: "SecurityOps" },
      missingTags: [],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-data-analytics-dev/providers/Microsoft.Web/sites/func-etl-analytics-dev",
      resourceName: "func-etl-analytics-dev",
      resourceType: "Microsoft.Web/sites",
      resourceTypeDisplay: "SITES",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-data-analytics-dev",
      location: "westus2",
      complianceStatus: "NON_COMPLIANT",
      currentTags: { Environment: "Development", Role: "worker", Department: "DataTeam" },
      missingTags: ["CostCenter"],
    },
    {
      id: "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg-legacy-sandbox/providers/Microsoft.Compute/virtualMachines/vm-jumpbox-legacy",
      resourceName: "vm-jumpbox-legacy",
      resourceType: "Microsoft.Compute/virtualMachines",
      resourceTypeDisplay: "VIRTUALMACHINES",
      subscriptionId: "ec03e8ce-ceee-4638-b303-64ae431d5b1e",
      subscriptionName: "CSCS-LandingZone",
      resourceGroup: "rg-legacy-sandbox",
      location: "centralus",
      complianceStatus: "NON_COMPLIANT",
      currentTags: { Environment: "pruebas", Role: "network" },
      missingTags: ["CostCenter", "Department"],
    },
  ];

  // Mismo cálculo que el escaneo real para los valores no permitidos.
  const conValores = <T extends ResourceTagAuditItem | ResourceGroupTagAuditItem>(item: T): T => {
    const invalidTags = findInvalidTagValues(item.currentTags, DEFAULT_MANDATORY_TAG_POLICIES, MOCK_TAG_VALUE_ALIASES);
    return { ...item, invalidTags, complianceStatus: invalidTags.length > 0 ? "NON_COMPLIANT" : item.complianceStatus };
  };

  return {
    overallCompliancePercentage: 83.0,
    nonCompliantResourcesCount: 127,
    nonCompliantResourceGroupsCount: 10,
    invalidValueResourcesCount: 38,
    invalidValueResourceGroupsCount: 3,
    totalScannedResources: 748,
    totalScannedResourceGroups: 42,
    mostFrequentMissingTag: "CostCenter & Role",
    mandatoryPolicies: DEFAULT_MANDATORY_TAG_POLICIES,
    resources: mockResources.map(conValores),
    resourceGroups: mockRgs.map(conValores),
  };
}
