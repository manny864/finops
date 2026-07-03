import { getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionsForTenant } from "@/lib/azure";
import { withArgLimit } from "@/lib/argConcurrency";

export type HASeverity = "critical" | "high" | "medium" | "low";

export interface HAItem {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  issueType: string;
  severity: HASeverity;
  estimatedRisk: string;
}

// Cada query es independiente y devuelve filas con el shape final.
// Esto facilita la depuración y evita problemas con un case() gigante.
const QUERIES: { key: string; kql: string }[] = [
  {
    key: 'vm_no_zone',
    kql: `
      resources
      | where type =~ 'microsoft.compute/virtualmachines'
      | extend z = coalesce(zones, dynamic([]))
      | extend avSet = tostring(properties.availabilitySet.id)
      | extend vmss = tostring(properties.virtualMachineScaleSet.id)
      | where array_length(z) == 0 and isempty(avSet) and isempty(vmss)
      | extend issueType = 'no_zone'
      | extend severity = 'critical'
      | extend estimatedRisk = strcat('VM en ', location, ' sin Availability Zone ni Availability Set: caída zonal = pérdida total')
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'vm_in_avset_no_zone',
    kql: `
      resources
      | where type =~ 'microsoft.compute/virtualmachines'
      | extend z = coalesce(zones, dynamic([]))
      | extend avSet = tostring(properties.availabilitySet.id)
      | where array_length(z) == 0 and isnotempty(avSet)
      | extend issueType = 'no_zone'
      | extend severity = 'medium'
      | extend estimatedRisk = strcat('VM en Availability Set pero sin Availability Zone (no protege ante caída zonal)')
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'pip_basic',
    kql: `
      resources
      | where type =~ 'microsoft.network/publicipaddresses'
      | where tostring(sku.name) =~ 'Basic'
      | extend issueType = 'basic_sku'
      | extend severity = 'medium'
      | extend estimatedRisk = 'Public IP Basic SKU no soporta zonas ni reglas SLA'
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'storage_lrs',
    kql: `
      resources
      | where type =~ 'microsoft.storage/storageaccounts'
      | extend skuName = tostring(sku.name)
      | where skuName in~ ('Standard_LRS','Premium_LRS')
      | extend issueType = 'single_replica'
      | extend severity = 'low'
      | extend estimatedRisk = strcat('Storage con redundancia ', skuName, ' (sin geo ni zona)')
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'sql_no_failover',
    kql: `
      resources
      | where type =~ 'microsoft.sql/servers'
      | join kind=leftouter (
          resources
          | where type =~ 'microsoft.sql/servers/failovergroups'
          | extend parentId = tolower(tostring(split(id, '/failoverGroups/')[0]))
          | distinct parentId
          | extend hasFG = true
      ) on $left.id == $right.parentId
      | where isnull(hasFG)
      | extend issueType = 'no_geo_redundancy'
      | extend severity = 'high'
      | extend estimatedRisk = 'SQL Server sin failover group ni geo-replica'
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'aks_no_zone',
    kql: `
      resources
      | where type =~ 'microsoft.containerservice/managedclusters'
      | mv-expand pool = properties.agentPoolProfiles
      | extend z = coalesce(todynamic(pool.availabilityZones), dynamic([]))
      | summarize zonesAll = make_set(z), name = any(name), type = any(type), location = any(location) by id
      | extend zonalCount = array_length(todynamic(zonesAll))
      | where zonalCount == 0
      | extend issueType = 'no_zone'
      | extend severity = 'high'
      | extend estimatedRisk = strcat('AKS sin Availability Zones en agent pools en ', location)
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'asp_single_instance',
    kql: `
      resources
      | where type =~ 'microsoft.web/serverfarms'
      | extend cap = toint(sku.capacity)
      | extend tier = tostring(sku.tier)
      | where cap <= 1 and tier !~ 'Free' and tier !~ 'Shared'
      | extend issueType = 'low_capacity'
      | extend severity = 'high'
      | extend estimatedRisk = strcat('App Service Plan ', tier, ' con capacidad ', cap, ' (single-instance, sin SLA)')
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'pg_flex_no_ha',
    kql: `
      resources
      | where type =~ 'microsoft.dbforpostgresql/flexibleservers'
      | extend haMode = tostring(properties.highAvailability.mode)
      | where haMode in~ ('Disabled','') or isempty(haMode)
      | extend issueType = 'no_geo_redundancy'
      | extend severity = 'high'
      | extend estimatedRisk = 'Postgres Flexible sin Zone-Redundant HA habilitado'
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'mysql_flex_no_ha',
    kql: `
      resources
      | where type =~ 'microsoft.dbformysql/flexibleservers'
      | extend haMode = tostring(properties.highAvailability.mode)
      | where haMode in~ ('Disabled','') or isempty(haMode)
      | extend issueType = 'no_geo_redundancy'
      | extend severity = 'high'
      | extend estimatedRisk = 'MySQL Flexible sin HA habilitada'
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'redis_non_premium',
    kql: `
      resources
      | where type =~ 'microsoft.cache/redis'
      | extend tier = tostring(sku.name)
      | where tier !~ 'Premium'
      | extend issueType = 'low_capacity'
      | extend severity = 'medium'
      | extend estimatedRisk = strcat('Redis ', tier, ' sin SLA de Premium (zonal/geo)')
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
  {
    key: 'cosmos_single_region',
    kql: `
      resources
      | where type =~ 'microsoft.documentdb/databaseaccounts'
      | extend locs = todynamic(properties.locations)
      | where array_length(locs) <= 1
      | extend issueType = 'no_geo_redundancy'
      | extend severity = 'high'
      | extend estimatedRisk = 'Cosmos DB con una sola región configurada'
      | project resourceId=id, resourceName=name, resourceType=type, issueType, severity, estimatedRisk
    `
  },
];

export interface HAEvalResult {
  items: HAItem[];
  counts: Record<HASeverity, number>;
  diagnostics: {
    subscriptionsQueried: number;
    perQuery: Record<string, { count: number; error?: string }>;
  };
}

export async function evaluateHALive(tenantId: string): Promise<HAEvalResult> {
  const client = await getResourceGraphClient(tenantId);
  const subscriptions = await getSubscriptionsForTenant(tenantId);
  const perQuery: Record<string, { count: number; error?: string }> = {};
  const all: HAItem[] = [];

  // Ejecutar queries en paralelo (chunks de 4) para reducir latencia total.
  // ARG soporta paralelismo razonable; con 11 queries en 3 tandas evitamos
  // saturar y reducimos el tiempo total ~4x vs secuencial.
  const CHUNK = 4;
  for (let i = 0; i < QUERIES.length; i += CHUNK) {
    const batch = QUERIES.slice(i, i + CHUNK);
    await Promise.all(batch.map(async q => {
      let retries = 3;
      let currentDelay = 3000;
      for (;;) {
        try {
          const res = await withArgLimit(() => client.resources({
            query: q.kql.trim(),
            subscriptions: subscriptions.length > 0 ? subscriptions : undefined,
          } as any));
          const rows = ((res.data as any[]) || []).map(r => ({
            resourceId: String(r.resourceId || ''),
            resourceName: String(r.resourceName || ''),
            resourceType: String(r.resourceType || ''),
            issueType: String(r.issueType || ''),
            severity: (r.severity as HASeverity) || 'low',
            estimatedRisk: String(r.estimatedRisk || ''),
          }));
          perQuery[q.key] = { count: rows.length };
          all.push(...rows);
          break;
        } catch (e: any) {
          const isRateLimit = e?.statusCode === 429 || (e?.code && e.code === 'RateLimiting');
          if (isRateLimit && retries > 1) {
            console.warn(`[HA] Query "${q.key}" rate limited (429). Reintentando en ${currentDelay}ms... (Intentos restantes: ${retries - 1})`);
            await new Promise(resolve => setTimeout(resolve, currentDelay));
            currentDelay *= 2;
            retries--;
          } else {
            perQuery[q.key] = { count: 0, error: e?.message || String(e) };
            console.warn(`[HA] Query "${q.key}" failed:`, e?.message || e);
            break;
          }
        }
      }
    }));
  }

  // Si más del 30% de las queries fallaron, abortamos para no cachear
  // un resultado parcial que cambiaría entre refreshes.
  const failedCount = Object.values(perQuery).filter(v => v.error).length;
  if (failedCount > Math.ceil(QUERIES.length * 0.3)) {
    throw new Error(`[HA] ${failedCount}/${QUERIES.length} queries failed; aborting to skip cache poisoning`);
  }

  // Dedup por (resourceId + issueType)
  const seen = new Set<string>();
  const items: HAItem[] = [];
  for (const it of all) {
    const k = `${it.resourceId}|${it.issueType}`;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(it);
  }

  const order: HASeverity[] = ['critical', 'high', 'medium', 'low'];
  items.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  const counts: Record<HASeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  items.forEach(it => { if (it.severity in counts) counts[it.severity]++; });

  return { items, counts, diagnostics: { subscriptionsQueried: subscriptions.length, perQuery } };
}
