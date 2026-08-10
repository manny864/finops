import { CostManagementClient } from "@azure/arm-costmanagement";
import Decimal from "decimal.js";
import { getResourceGraphClient } from "@/lib/azure";
import { findCostColumnIndex, withCostColumn } from "@/lib/azureCostColumn";
import { redis } from "@/lib/redis";

export type ArgResourceRow = {
  id: string;
  name: string;
  type: string;
  location?: string;
  resourceGroup?: string;
  subscriptionId?: string;
  kind?: string;
  skuName?: string;
  properties?: Record<string, unknown>;
};

export async function listResourcesByTypes(
  tenantId: string,
  resourceTypes: string[],
  subscriptionIds: string[] = [],
  credential?: any,
): Promise<ArgResourceRow[]> {
  const mapRows = (rows: any[]): ArgResourceRow[] =>
    rows.map((row) => ({
      id: String(row.id || ""),
      name: String(row.name || ""),
      type: String(row.type || "").toLowerCase(),
      location: row.location ? String(row.location) : undefined,
      resourceGroup: row.resourceGroup ? String(row.resourceGroup) : undefined,
      subscriptionId: row.subscriptionId ? String(row.subscriptionId) : undefined,
      kind: row.kind ? String(row.kind) : undefined,
      skuName: row.skuName ? String(row.skuName) : undefined,
      properties:
        row.properties && typeof row.properties === "object"
          ? (row.properties as Record<string, unknown>)
          : undefined,
    }));

  try {
    const argClient = await getResourceGraphClient(tenantId);
    const types = resourceTypes.map((t) => `'${t.toLowerCase()}'`).join(",");
    const query = `
      Resources
      | where type in~ (${types})
      | project id, name, type = tolower(type), location, resourceGroup, subscriptionId, kind, skuName = tostring(sku.name), properties
    `;
    console.log(`[listResourcesByTypes] KQL query: where type in~ (${types})`);
    const response: any = await argClient.resources({
      subscriptions: subscriptionIds.length > 0 ? subscriptionIds : undefined,
      query,
      options: { resultFormat: "objectArray", top: 1000 },
    });
    const rows = mapRows((response.data as any[]) || []);
    console.log(`[listResourcesByTypes] KQL returned ${rows.length} rows`);
    if (rows.length > 0) {
      console.log(`[listResourcesByTypes] Using KQL results`);
      return rows;
    }
    // If KQL returns 0 results, continue to ARM fallback below
    console.log(`[listResourcesByTypes] KQL returned 0, will try ARM fallback`);
  } catch (err) {
    // fallback ARM below on KQL error
    console.log(`[listResourcesByTypes] KQL error, will try ARM fallback:`, err);
  }

  if (!credential || subscriptionIds.length === 0) return [];
  return listResourcesViaArm(credential, subscriptionIds, resourceTypes);
}

async function listResourcesViaArm(
  credential: any,
  subscriptionIds: string[],
  resourceTypes: string[],
): Promise<ArgResourceRow[]> {
  const token = await credential.getToken("https://management.azure.com/.default");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token?.token) headers.Authorization = `Bearer ${token.token}`;
  const items: ArgResourceRow[] = [];

  console.log(`[listResourcesViaArm] Starting ARM query for ${subscriptionIds.length} subscriptions, ${resourceTypes.length} types`);

  for (const subscriptionId of subscriptionIds) {
    for (const resourceType of resourceTypes) {
      // Try both lowercase and proper case (Microsoft.Cache/Redis)
      const properCaseType = resourceType
        .split('/')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('/');

      for (const typeToTry of [properCaseType, resourceType]) {
        let url = `https://management.azure.com/subscriptions/${subscriptionId}/resources`;
        const params = new URLSearchParams({
          "api-version": "2021-04-01",
          "$filter": `resourceType eq '${typeToTry}'`,
        });
        url = `${url}?${params.toString()}`;

        try {
          console.log(`[listResourcesViaArm] Querying ${typeToTry} in ${subscriptionId}`);
          const response = await fetch(url, {
            method: "GET",
            headers,
            cache: "no-store",
          });

          if (!response.ok) {
            console.warn(
              `[listResourcesViaArm] HTTP ${response.status} for ${typeToTry}. Status text: ${response.statusText}`
            );
            continue;
          }

          const json: any = await response.json();
          const values = Array.isArray(json.value) ? json.value : [];
          console.log(`[listResourcesViaArm] Found ${values.length} ${typeToTry} resources in ${subscriptionId}`);

          if (values.length > 0) {
            for (const row of values) {
              items.push({
                id: String(row.id || ""),
                name: String(row.name || ""),
                type: String(row.type || "").toLowerCase(),
                location: row.location ? String(row.location) : undefined,
                resourceGroup: row.resourceGroup ? String(row.resourceGroup) : undefined,
                subscriptionId,
                kind: row.kind ? String(row.kind) : undefined,
                skuName:
                  row.sku && typeof row.sku === "object" && row.sku.name
                    ? String(row.sku.name)
                    : undefined,
                properties:
                  row.properties && typeof row.properties === "object"
                    ? (row.properties as Record<string, unknown>)
                    : undefined,
              });
            }
            break; // Found items, don't try other case variations
          }
        } catch (err) {
          console.error(`[listResourcesViaArm] Exception for ${typeToTry}:`, err);
        }
      }
    }
  }

  console.log(`[listResourcesViaArm] Finished. Total ${items.length} items found`);
  return items;
}

export async function getMonthlyCostByType(
  tenantId: string,
  credential: any,
  subscriptionIds: string[],
  resourceTypes: string[],
): Promise<{ costByType: Map<string, Decimal>; dataAvailable: boolean }> {
  const normalizedTypes = resourceTypes.map((t) => t.toLowerCase());
  const costByType = new Map<string, Decimal>(normalizedTypes.map((t) => [t, new Decimal(0)]));
  let dataAvailable = true;

  for (const subscriptionId of subscriptionIds) {
    const cm = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;
    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - 30);

    try {
      const result = await withCostColumn(tenantId, (costColumn) =>
        cm.query.usage(scope, {
          type: "ActualCost",
          timeframe: "Custom",
          timePeriod: { from, to: now },
          dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: costColumn, function: "Sum" } },
            grouping: [{ type: "Dimension", name: "ResourceType" }],
            filter: {
              dimensions: { name: "ResourceType", operator: "In", values: resourceTypes },
            },
          },
        } as any),
      );

      const columns = result.columns || [];
      const costIndex = findCostColumnIndex(columns as any);
      const typeIndex = columns.findIndex((c: any) =>
        /resourcetype/i.test(String(c?.name || "")),
      );

      for (const row of result.rows || []) {
        const resourceType = String(row[typeIndex] || "").toLowerCase();
        if (!costByType.has(resourceType)) continue;
        const cost = new Decimal(row[costIndex >= 0 ? costIndex : 0] || 0);
        costByType.set(resourceType, (costByType.get(resourceType) || new Decimal(0)).plus(cost));
      }
    } catch {
      dataAvailable = false;
    }
  }

  return { costByType, dataAvailable };
}

export function distributeCostPerResource(
  resources: Array<{ id: string; type: string }>,
  costByType: Map<string, Decimal>,
): Map<string, number> {
  const countByType = new Map<string, number>();
  for (const resource of resources) {
    const type = resource.type.toLowerCase();
    countByType.set(type, (countByType.get(type) || 0) + 1);
  }

  const perResource = new Map<string, number>();
  for (const resource of resources) {
    const type = resource.type.toLowerCase();
    const totalTypeCost = costByType.get(type) || new Decimal(0);
    const typeCount = countByType.get(type) || 1;
    perResource.set(
      resource.id,
      totalTypeCost.dividedBy(typeCount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    );
  }
  return perResource;
}

const DIAGNOSTICS_CACHE_TTL_SECONDS = 900;

export function getDiagnosticsCacheKey(family: string, tenantId: string): string {
  return `databases:diagnostics:v1:${family}:${tenantId}`;
}

export async function readDiagnosticsCache<T>(key: string): Promise<T | null> {
  try {
    const cached = await redis.get(key);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  } catch {
    return null;
  }
}

export async function writeDiagnosticsCache<T>(key: string, payload: T): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(payload), "EX", DIAGNOSTICS_CACHE_TTL_SECONDS);
  } catch {
    // Best-effort cache.
  }
}
