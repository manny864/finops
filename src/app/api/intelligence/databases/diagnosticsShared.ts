import { CostManagementClient } from "@azure/arm-costmanagement";
import Decimal from "decimal.js";
import { getResourceGraphClient } from "@/lib/azure";
import { findCostColumnIndex, withCostColumn } from "@/lib/azureCostColumn";
import { withRetry } from "@/modules/collectors/azure/billing/billingHelpers";
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
    // Cero filas es una RESPUESTA, no un fallo: que el tenant no tenga ningún
    // recurso de este tipo es el caso normal. Antes se caía al fallback de ARM
    // y ahí está el costo: medido el 2026-09-05 sobre UN tenant de dos
    // suscripciones, 25 de 35 consultas KQL devolvieron 0 y dispararon 148
    // llamadas ARM, todas con "Found 0".
    //
    // El fallback tampoco cubría lo que parecía cubrir. El caso temido es que
    // ARG omita una suscripción que la credencial no puede leer — pero ARM usa
    // ESA MISMA credencial, devuelve 403 y el loop hace continue. Mismo
    // resultado vacío, 148 llamadas de más contra la cuota que después le
    // falta al barrido de costos.
    return rows;
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
      // Antes esto probaba cada tipo dos veces, en minúsculas y en un
      // "proper case" derivado a mano. Sobraban las dos cosas: el $filter de
      // ARM compara resourceType sin distinguir mayúsculas (verificado el
      // 2026-09-05 contra la API: las cuatro variantes de
      // Microsoft.Storage/storageAccounts devuelven los mismos 2 recursos), y
      // el derivador generaba de todos modos una cadena que no existe
      // — microsoft.documentdb/databaseaccounts salía como
      // "Microsoft.documentdb/Databaseaccounts", no como el
      // "Microsoft.DocumentDB/databaseAccounts" real. Duplicaba el tráfico
      // para pedir un nombre inventado.
      let url = `https://management.azure.com/subscriptions/${subscriptionId}/resources`;
      const params = new URLSearchParams({
        "api-version": "2021-04-01",
        "$filter": `resourceType eq '${resourceType}'`,
      });
      url = `${url}?${params.toString()}`;

      try {
        console.log(`[listResourcesViaArm] Querying ${resourceType} in ${subscriptionId}`);
        const response = await fetch(url, {
          method: "GET",
          headers,
          cache: "no-store",
        });

        if (!response.ok) {
          console.warn(
            `[listResourcesViaArm] HTTP ${response.status} for ${resourceType}. Status text: ${response.statusText}`
          );
          continue;
        }

        const json: any = await response.json();
        const values = Array.isArray(json.value) ? json.value : [];
        console.log(`[listResourcesViaArm] Found ${values.length} ${resourceType} resources in ${subscriptionId}`);

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
        }
      } catch (err) {
        console.error(`[listResourcesViaArm] Exception for ${resourceType}:`, err);
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
/**
 * Traduce el error crudo de Cost Management a una causa que se pueda mostrar.
 *
 * El texto de Azure ("Customer does not have the privilege to see the cost",
 * Request IDs, GUIDs) no le sirve a quien mira un cockpit de costos: no dice si
 * hay que hacer algo ni qué. Se clasifica en causas accionables.
 *
 * `sponsorship` es un caso donde NO hay nada que otorgar: las suscripciones de
 * patrocinio de Microsoft no exponen Cost Management por API, sus costos viven
 * en el portal de patrocinios. Azure devuelve el mismo error que una falta de
 * permiso, así que se agrupan bajo una causa que menciona ambas salidas.
 */
export type CostIssueKind = "no_access" | "throttled" | "unknown";

export function classifyCostIssue(rawMessage: string): CostIssueKind {
  const m = String(rawMessage || "").toLowerCase();
  if (m.includes("privilege") || m.includes("not authorized") || m.includes("forbidden")) {
    return "no_access";
  }
  if (m.includes("too many requests") || m.includes("429") || m.includes("throttl")) {
    return "throttled";
  }
  return "unknown";
}

/**
 * UNA sola consulta de costos por suscripción, compartida por todo el cockpit.
 *
 * Antes cada pantalla pedía dos cosas por separado — el agregado por
 * ResourceType y el detalle por ResourceId — así que con 4 suscripciones eran
 * 8-12 llamadas por carga de página, y cada pestaña repetía el ciclo. Cost
 * Management tiene límites estrictos y la propia app se throttleaba sola,
 * devolviendo "Too many requests" y dejando el cockpit sin costos.
 *
 * Agrupando por ResourceId Y ResourceType en la misma consulta se obtienen las
 * dos vistas de una: el detalle por recurso, y el total por tipo como suma. El
 * resultado se cachea en Redis y lo reutilizan todas las familias (web apps,
 * bases, integración…), así que una carga completa del cockpit cuesta una
 * consulta por suscripción en vez de decenas.
 */
type SubscriptionCostSnapshot = {
  byResourceId: Record<string, number>;
  byType: Record<string, number>;
  errors: string[];
};

const COST_SNAPSHOT_TTL_SECONDS = 600;

async function fetchSubscriptionCosts(
  tenantId: string,
  credential: any,
  subscriptionId: string,
): Promise<SubscriptionCostSnapshot> {
  const cacheKey = `cost:mtd:v1:${tenantId}:${subscriptionId}`;
  const cached = await readCostSnapshot(cacheKey);
  if (cached) return cached;

  const snapshot: SubscriptionCostSnapshot = { byResourceId: {}, byType: {}, errors: [] };
  const cm = new CostManagementClient(credential);

  try {
    // Con reintento: Cost Management responde 429 con facilidad y sin esto un
    // throttling pasajero dejaba TODO el cockpit en cero, como si nada gastara.
    const result = await withRetry(
      () => withCostColumn(tenantId, (costColumn) =>
      cm.query.usage(`/subscriptions/${subscriptionId}`, {
        type: "ActualCost",
        timeframe: "MonthToDate",
        dataset: {
          granularity: "None",
          aggregation: { totalCost: { name: costColumn, function: "Sum" } },
          grouping: [
            { type: "Dimension", name: "ResourceId" },
            { type: "Dimension", name: "ResourceType" },
          ],
        },
      } as any),
      ),
      // 2 reintentos cortos: se busca absorber un 429 puntual, no esperar
      // medio minuto. Si no sale, se degrada a la última foto conocida.
      { label: `cost-mtd(sub ${subscriptionId})`, maxRetries: 2, baseDelayMs: 800 },
    );

    const columns = result.columns || [];
    const costIndex = findCostColumnIndex(columns as any);
    const idIndex = columns.findIndex((c: any) => /resourceid/i.test(String(c?.name || "")));
    const typeIndex = columns.findIndex((c: any) => /resourcetype/i.test(String(c?.name || "")));

    for (const row of result.rows || []) {
      const cost = Number(row[costIndex >= 0 ? costIndex : 0] || 0);
      if (idIndex >= 0) {
        const resourceId = String(row[idIndex] || "").toLowerCase();
        if (resourceId) {
          snapshot.byResourceId[resourceId] = (snapshot.byResourceId[resourceId] || 0) + cost;
        }
      }
      if (typeIndex >= 0) {
        const resourceType = String(row[typeIndex] || "").toLowerCase();
        if (resourceType) {
          snapshot.byType[resourceType] = (snapshot.byType[resourceType] || 0) + cost;
        }
      }
    }

    await writeCostSnapshot(cacheKey, snapshot);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    snapshot.errors.push(`${subscriptionId}: ${message}`);
    console.error(`[cost] consulta MTD falló en ${subscriptionId}:`, message);
    // No se cachea el fallo: un throttling transitorio no debe dejar la
    // suscripción sin costos durante todo el TTL.
    //
    // Y si hay una foto anterior, se sirve esa: un costo de hace un rato es
    // muchísimo mejor que cero. Azure factura con 8-24h de retraso, así que la
    // diferencia real entre ambas es despreciable.
    const stale = await readCostSnapshot(`${cacheKey}:last`);
    if (stale) {
      return { ...stale, errors: snapshot.errors };
    }
  }

  if (snapshot.errors.length === 0) {
    // Copia sin vencimiento corto para poder degradar a ella ante un 429.
    await writeCostSnapshot(`${cacheKey}:last`, snapshot, 24 * 3600);
  }

  return snapshot;
}

async function readCostSnapshot(key: string): Promise<SubscriptionCostSnapshot | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as SubscriptionCostSnapshot) : null;
  } catch {
    return null;
  }
}

async function writeCostSnapshot(
  key: string,
  snapshot: SubscriptionCostSnapshot,
  ttlSeconds: number = COST_SNAPSHOT_TTL_SECONDS,
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(snapshot), "EX", ttlSeconds);
  } catch {
    /* cache best-effort */
  }
}

export async function getMonthlyCostByType(
  tenantId: string,
  credential: any,
  subscriptionIds: string[],
  resourceTypes: string[],
): Promise<{ costByType: Map<string, Decimal>; dataAvailable: boolean; errors: string[] }> {
  const normalizedTypes = resourceTypes.map((t) => t.toLowerCase());
  const costByType = new Map<string, Decimal>(normalizedTypes.map((t) => [t, new Decimal(0)]));
  const errors: string[] = [];
  let dataAvailable = true;

  // En paralelo: en serie, 4 suscripciones con reintentos sumaban decenas de
  // segundos y la página quedaba colgada en "Cargando…".
  const snapshots = await Promise.all(
    subscriptionIds.map((subscriptionId) => fetchSubscriptionCosts(tenantId, credential, subscriptionId)),
  );
  for (const snapshot of snapshots) {
    if (snapshot.errors.length > 0) {
      dataAvailable = false;
      errors.push(...snapshot.errors);
    }
    for (const [type, cost] of Object.entries(snapshot.byType)) {
      if (!costByType.has(type)) continue;
      costByType.set(type, (costByType.get(type) || new Decimal(0)).plus(cost));
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

  const subscriptionIds = new Set<string>();
  for (const resource of resources) {
    const subId =
      resource.subscriptionId ||
      String(resource.id || "").match(/\/subscriptions\/([^/]+)/i)?.[1] ||
      "";
    if (subId) subscriptionIds.add(subId);
  }

  const wanted = new Set(resources.map((r) => String(r.id || "").toLowerCase()));

  const snapshots = await Promise.all(
    Array.from(subscriptionIds).map((subscriptionId) =>
      fetchSubscriptionCosts(tenantId, credential, subscriptionId),
    ),
  );
  for (const snapshot of snapshots) {
    for (const [resourceId, cost] of Object.entries(snapshot.byResourceId)) {
      if (!wanted.has(resourceId)) continue;
      perResource.set(resourceId, (perResource.get(resourceId) || 0) + cost);
    }
  }

  return perResource;
}

/**
 * Costo por recurso, EXCLUSIVAMENTE del dato exacto por ResourceId.
 *
 * Antes, los recursos sin costo propio recibían el total de su tipo dividido en
 * partes iguales. Eso hacía que dos App Service Plans con SKUs y precios muy
 * distintos mostraran exactamente el mismo importe — el promedio — y no había
 * forma de notar que era un número repartido y no el costo de cada uno.
 *
 * Un recurso sin dato queda FUERA del Map. El llamador lo marca
 * `costDataAvailable: false` y la UI muestra "sin datos" en lugar de un
 * promedio disfrazado de facturación.
 *
 * `costByType` se conserva en la firma porque los llamadores ya lo calculan y
 * sirve para el total del tenant, pero deliberadamente NO se reparte.
 */
export function distributeCostPerResource(
  resources: Array<{ id: string; type: string }>,
  _costByType: Map<string, Decimal>,
  exactById?: Map<string, number>,
): Map<string, number> {
  const perResource = new Map<string, number>();
  if (!exactById) return perResource;

  for (const resource of resources) {
    const exact = exactById.get(String(resource.id || "").toLowerCase());
    if (typeof exact === "number" && exact > 0) {
      perResource.set(resource.id, Math.round(exact * 100) / 100);
    }
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
