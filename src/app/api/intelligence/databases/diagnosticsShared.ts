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
  /**
   * Tier y capacidad del SKU, proyectados desde ARG.
   *
   * Antes sólo se proyectaba `skuName`, así que el código que buscaba un objeto
   * `sku` encontraba undefined y caía a un tier hardcodeado: dos App Service
   * Plans con SKUs distintos (FC1 y EP1) recibían el mismo precio estimado.
   */
  skuTier?: string;
  skuCapacity?: number;
  powerState?: string;
  provisioningState?: string;
  properties?: Record<string, unknown>;
};

function extractResourceGroup(resourceId: string, directRg?: string): string | undefined {
  if (directRg && directRg.trim().length > 0 && directRg.toLowerCase() !== "unknown") {
    return directRg;
  }
  if (!resourceId) return undefined;
  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i);
  return match ? match[1] : undefined;
}

export async function listResourcesByTypes(
  tenantId: string,
  resourceTypes: string[],
  subscriptionIds: string[] = [],
  credential?: any,
): Promise<ArgResourceRow[]> {
  const mapRows = (rows: any[]): ArgResourceRow[] => {
    const itemMap = new Map<string, ArgResourceRow>();
    for (const row of rows) {
      const id = String(row.id || "");
      const key = id.toLowerCase();
      if (!key || itemMap.has(key)) continue;

      itemMap.set(key, {
        id,
        name: String(row.name || ""),
        type: String(row.type || "").toLowerCase(),
        location: row.location ? String(row.location) : undefined,
        resourceGroup: extractResourceGroup(id, row.resourceGroup ? String(row.resourceGroup) : undefined),
        subscriptionId: row.subscriptionId ? String(row.subscriptionId) : undefined,
        kind: row.kind ? String(row.kind) : undefined,
        skuName: row.skuName ? String(row.skuName) : undefined,
        skuTier: row.skuTier ? String(row.skuTier) : undefined,
        skuCapacity: Number.isFinite(Number(row.skuCapacity)) ? Number(row.skuCapacity) : undefined,
        powerState: row.powerState ? String(row.powerState) : undefined,
        provisioningState: row.provisioningState ? String(row.provisioningState) : undefined,
        properties:
          row.properties && typeof row.properties === "object"
            ? (row.properties as Record<string, unknown>)
            : undefined,
      });
    }
    return Array.from(itemMap.values());
  };

  try {
    const argClient = await getResourceGraphClient(tenantId);
    const uniqueTypes = Array.from(new Set(resourceTypes.map((t) => t.toLowerCase())));
    const types = uniqueTypes.map((t) => `'${t}'`).join(",");
    const query = `
      Resources
      | where type in~ (${types})
      | extend powerState = tostring(properties.extended.instanceView.powerState.code)
      | extend provisioningState = tostring(properties.provisioningState)
      | project id, name, type = tolower(type), location, resourceGroup, subscriptionId, kind, skuName = tostring(sku.name), skuTier = tostring(sku.tier), skuCapacity = toint(sku.capacity), powerState, provisioningState, properties
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
  const itemsMap = new Map<string, ArgResourceRow>();

  const uniqueTypes = Array.from(new Set(resourceTypes.map((t) => t.toLowerCase())));
  console.log(`[listResourcesViaArm] Starting ARM query for ${subscriptionIds.length} subscriptions, ${uniqueTypes.length} unique types`);

  for (const subscriptionId of subscriptionIds) {
    for (const resourceType of uniqueTypes) {
      // Proper case variation (e.g. Microsoft.DocumentDB/databaseAccounts)
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
              const id = String(row.id || "");
              const key = id.toLowerCase();
              if (!key || itemsMap.has(key)) continue;

              itemsMap.set(key, {
                id,
                name: String(row.name || ""),
                type: String(row.type || "").toLowerCase(),
                location: row.location ? String(row.location) : undefined,
                resourceGroup: extractResourceGroup(id, row.resourceGroup ? String(row.resourceGroup) : undefined),
                subscriptionId,
                kind: row.kind ? String(row.kind) : undefined,
                skuName:
                  row.sku && typeof row.sku === "object" && row.sku.name
                    ? String(row.sku.name)
                    : undefined,
                skuTier:
                  row.sku && typeof row.sku === "object" && row.sku.tier
                    ? String(row.sku.tier)
                    : undefined,
                skuCapacity:
                  row.sku && typeof row.sku === "object" && Number.isFinite(Number(row.sku.capacity))
                    ? Number(row.sku.capacity)
                    : undefined,
                powerState:
                  row.properties &&
                  typeof row.properties === "object" &&
                  (row.properties as any).extended?.instanceView?.powerState?.code
                    ? String((row.properties as any).extended.instanceView.powerState.code)
                    : undefined,
                provisioningState:
                  row.properties &&
                  typeof row.properties === "object" &&
                  (row.properties as any).provisioningState
                    ? String((row.properties as any).provisioningState)
                    : undefined,
                properties:
                  row.properties && typeof row.properties === "object"
                    ? (row.properties as Record<string, unknown>)
                    : undefined,
              });
            }
            break; // Found items for this type, avoid duplicating with the other casing
          }
        } catch (err) {
          console.error(`[listResourcesViaArm] Exception for ${typeToTry}:`, err);
        }
      }
    }
  }

  return Array.from(itemsMap.values());
}

/**
 * Costo ACUMULADO DEL MES EN CURSO (MonthToDate) por tipo de recurso.
 *
 * El nombre dice "Monthly" por compatibilidad con sus 9 llamadores, pero lo que
 * devuelve es el acumulado del mes, no una tarifa mensual: es lo que la UI
 * rotula "Costo MTD Acumulado". Antes consultaba los últimos 30 días móviles,
 * que a principios de mes mezclaba gasto del mes anterior.
 *
 * Limitación conocida: agrupa por ResourceType, así que el reparto entre
 * recursos del mismo tipo lo hace `distributeCostPerResource` en partes
 * iguales. Para costo exacto por recurso está `getResourceCostsById`
 * (resourceInventoryService.ts), que agrupa por ResourceId.
 */
export async function getMonthlyCostByType(
  tenantId: string,
  credential: any,
  subscriptionIds: string[],
  resourceTypes: string[],
): Promise<{ costByType: Map<string, Decimal>; dataAvailable: boolean; errors: string[] }> {
  const normalizedTypes = resourceTypes.map((t) => t.toLowerCase());
  const costByType = new Map<string, Decimal>(normalizedTypes.map((t) => [t, new Decimal(0)]));
  let dataAvailable = true;
  const errors: string[] = [];

  for (const subscriptionId of subscriptionIds) {
    const cm = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;

    try {
      const result = await withCostColumn(tenantId, (costColumn) =>
        cm.query.usage(scope, {
          type: "ActualCost",
          // MonthToDate, no una ventana móvil de 30 días: la UI rotula este
          // número como "Facturación mes en curso". Con `Custom` + últimos 30
          // días, el día 3 del mes se mostraban 27 días del mes anterior como
          // si fueran del actual.
          timeframe: "MonthToDate",
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
    } catch (e) {
      // Antes este catch era mudo: una falla de permisos sobre Cost Management
      // quedaba indistinguible de "no hay gasto", y la UI mostraba $0 o caía a
      // un estimado sin que nadie supiera por qué.
      dataAvailable = false;
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${subscriptionId}: ${message}`);
      console.error(`[cost] getMonthlyCostByType falló en ${subscriptionId}:`, message);
    }
  }

  return { costByType, dataAvailable, errors };
}

/**
 * Costo ACUMULADO DEL MES por ResourceId exacto.
 *
 * Es la versión precisa de `getMonthlyCostByType`: en vez de traer el total del
 * tipo y repartirlo, pide el costo de cada recurso. Con tres App Service Plans,
 * el reparto en partes iguales mostraba a los tres el promedio; con esto cada
 * uno muestra lo suyo.
 *
 * Devuelve un Map con las claves en minúsculas — Cost Management normaliza así
 * los ResourceId y no siempre coinciden en mayúsculas con los de Resource Graph.
 * Un recurso sin datos de facturación todavía (creado hace horas) simplemente
 * no aparece en el Map; el llamador decide el respaldo.
 */
export async function getMtdCostByResourceId(
  tenantId: string,
  credential: any,
  resources: Array<{ id: string; subscriptionId?: string }>,
): Promise<Map<string, number>> {
  const perResource = new Map<string, number>();
  if (resources.length === 0) return perResource;

  const bySubscription = new Map<string, string[]>();
  for (const resource of resources) {
    const subId =
      resource.subscriptionId ||
      String(resource.id || "").match(/\/subscriptions\/([^/]+)/i)?.[1] ||
      "";
    if (!subId) continue;
    if (!bySubscription.has(subId)) bySubscription.set(subId, []);
    bySubscription.get(subId)!.push(resource.id);
  }

  // El filtro `In` de Cost Management no admite listas arbitrariamente largas.
  const CHUNK = 100;

  for (const [subscriptionId, ids] of bySubscription.entries()) {
    const cm = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      try {
        const result = await withCostColumn(tenantId, (costColumn) =>
          cm.query.usage(scope, {
            type: "ActualCost",
            timeframe: "MonthToDate",
            dataset: {
              granularity: "None",
              aggregation: { totalCost: { name: costColumn, function: "Sum" } },
              grouping: [{ type: "Dimension", name: "ResourceId" }],
              filter: { dimensions: { name: "ResourceId", operator: "In", values: chunk } },
            },
          } as any),
        );

        const columns = result.columns || [];
        const costIndex = findCostColumnIndex(columns as any);
        const idIndex = columns.findIndex((c: any) => /resourceid/i.test(String(c?.name || "")));
        if (idIndex < 0) continue;

        for (const row of result.rows || []) {
          const resourceId = String(row[idIndex] || "").toLowerCase();
          if (!resourceId) continue;
          const cost = Number(row[costIndex >= 0 ? costIndex : 0] || 0);
          perResource.set(resourceId, (perResource.get(resourceId) || 0) + cost);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[cost] getMtdCostByResourceId falló en ${subscriptionId}:`, message);
      }
    }
  }

  return perResource;
}

/**
 * Costo por recurso, priorizando el dato exacto por ResourceId.
 *
 * `exactById` (de `getMtdCostByResourceId`) manda cuando existe. El reparto en
 * partes iguales por tipo queda sólo como respaldo para los recursos que
 * todavía no tienen facturación propia — y se aplica sobre el REMANENTE del
 * tipo, restando lo ya imputado: si no, un recurso con costo exacto sumaría dos
 * veces y el total del cockpit no cerraría con la factura.
 */
export function distributeCostPerResource(
  resources: Array<{ id: string; type: string }>,
  costByType: Map<string, Decimal>,
  exactById?: Map<string, number>,
): Map<string, number> {
  const perResource = new Map<string, number>();

  const exactFor = (id: string): number | undefined => {
    if (!exactById) return undefined;
    const value = exactById.get(String(id || "").toLowerCase());
    return typeof value === "number" && value > 0 ? value : undefined;
  };

  // Cuánto del total de cada tipo ya quedó imputado con precisión, y cuántos
  // recursos siguen sin dato propio.
  const attributedByType = new Map<string, Decimal>();
  const pendingByType = new Map<string, number>();
  for (const resource of resources) {
    const type = resource.type.toLowerCase();
    const exact = exactFor(resource.id);
    if (exact !== undefined) {
      attributedByType.set(type, (attributedByType.get(type) || new Decimal(0)).plus(exact));
    } else {
      pendingByType.set(type, (pendingByType.get(type) || 0) + 1);
    }
  }

  for (const resource of resources) {
    const type = resource.type.toLowerCase();
    const exact = exactFor(resource.id);
    if (exact !== undefined) {
      perResource.set(resource.id, Math.round(exact * 100) / 100);
      continue;
    }

    const totalTypeCost = costByType.get(type) || new Decimal(0);
    const remaining = Decimal.max(0, totalTypeCost.minus(attributedByType.get(type) || new Decimal(0)));
    const pending = pendingByType.get(type) || 1;
    perResource.set(
      resource.id,
      remaining.dividedBy(pending).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
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
