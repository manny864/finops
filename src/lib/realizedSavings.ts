/**
 * Cálculo de ahorro realizado (Before/After) del módulo Progreso Histórico.
 *
 * Regla de oro: el ahorro se DERIVA de costo real observado, no de una tabla de
 * valores fijos. El orden de fuentes es:
 *   1. Delta real de Azure Cost Management / `CostSnapshots` alrededor de la
 *      fecha del evento (run-rate de los 30 días previos vs. posteriores).
 *   2. Precio de catálogo del SKU exacto × 730 h (Azure Retail Prices API, ver
 *      `pricingService.getMonthlyCostEstimate`).
 *   3. Línea base por tipo de recurso (abajo) — SOLO como último recurso y
 *      marcada como tal, para no presentar una estimación como medición.
 * Si ninguna fuente da una línea base, el ahorro es 0 y la UI muestra "—":
 * antes cualquier recurso sin match caía en un fallback de 15 USD/mes, que es de
 * dónde salía el "ahorro de $15" al eliminar un Azure Bastion.
 */

export type BaselineSource = "cost_management" | "retail_catalog" | "type_baseline" | "none";

/**
 * Costo mensual orientativo por tipo ARM (USD, región base East US, 730 h/mes).
 * Es la línea base de último recurso cuando no hay historial de costo ni SKU
 * conocido. Valores tomados de la lista pública de precios de Azure; se marcan
 * con `source: 'type_baseline'` para que la UI pueda distinguir estimación de
 * medición.
 */
export const AZURE_MONTHLY_BASELINE_BY_TYPE: Array<{ match: string; monthly: number; note?: string }> = [
  // Red — los grandes ausentes que producían el bug del "ahorro de $15".
  { match: "microsoft.network/bastionhosts", monthly: 140.0, note: "Bastion Basic; Standard ~350" },
  { match: "microsoft.network/azurefirewalls", monthly: 912.0, note: "Firewall Standard" },
  { match: "microsoft.network/virtualnetworkgateways", monthly: 130.0 },
  { match: "microsoft.network/applicationgateways", monthly: 180.0 },
  { match: "microsoft.network/ddosprotectionplans", monthly: 2944.0 },
  { match: "microsoft.network/natgateways", monthly: 32.0 },
  { match: "microsoft.network/loadbalancers", monthly: 18.0 },
  { match: "microsoft.network/expressroutecircuits", monthly: 55.0 },
  { match: "microsoft.network/privateendpoints", monthly: 7.0 },
  { match: "microsoft.network/publicipaddresses", monthly: 3.5 },
  { match: "microsoft.network/trafficmanagerprofiles", monthly: 3.0 },
  { match: "microsoft.network/privatednszones", monthly: 0.25 },
  { match: "microsoft.network/frontdoorwebapplicationfirewallpolicies", monthly: 5.0 },
  { match: "microsoft.network/applicationgatewaywebapplicationfirewallpolicies", monthly: 5.0, note: "WAF Policy rule set" },
  { match: "unattachedwafpolicies", monthly: 5.0 },
  // Cómputo y contenedores — AKS faltaba por completo.
  { match: "microsoft.containerservice/managedclusters", monthly: 292.0, note: "Uptime SLA + 3 nodos D2s_v3" },
  { match: "microsoft.containerregistry/registries", monthly: 20.0 },
  { match: "microsoft.app/managedenvironments", monthly: 73.0 },
  { match: "microsoft.compute/virtualmachinescalesets", monthly: 140.0 },
  // VM Detenida / Deallocated: no incurre en cómputo ($0/h), pero sí en almacenamiento
  // de discos administrados asociados (OS disk P10 128 GiB $19.71) e IP pública reservada ($3.65).
  // Total orientativo: $23.36/mes.
  { match: "microsoft.compute/virtualmachines/stopped", monthly: 23.36, note: "Stopped VM (OS Disk P10 128 GiB $19.71 + Public IP $3.65)" },
  { match: "stoppedvirtualmachines", monthly: 23.36, note: "Stopped VM (OS Disk P10 128 GiB $19.71 + Public IP $3.65)" },
  { match: "vm (stopped)", monthly: 23.36, note: "Stopped VM (OS Disk P10 128 GiB $19.71 + Public IP $3.65)" },
  { match: "microsoft.compute/virtualmachines", monthly: 70.0, note: "Standard_D2s_v5 running 730h" },
  { match: "microsoft.compute/disks", monthly: 19.71, note: "P10 128 GiB Premium SSD ($0.154/GiB)" },
  { match: "unattacheddisks", monthly: 19.71, note: "P10 128 GiB Premium SSD ($0.154/GiB)" },
  { match: "microsoft.compute/snapshots", monthly: 5.0, note: "Snapshot baseline 100 GiB ($0.05/GiB)" },
  { match: "stalesnapshots", monthly: 5.0, note: "Snapshot baseline 100 GiB ($0.05/GiB)" },
  // App Service Environment v3: Isolated v2 stamp fee (~$300/mes base).
  { match: "microsoft.web/hostingenvironments", monthly: 300.0, note: "App Service Environment (Isolated v2 stamp fee)" },
  { match: "emptyase", monthly: 300.0, note: "App Service Environment (Isolated v2 stamp fee)" },
  { match: "microsoft.web/serverfarms", monthly: 54.75, note: "App Service Plan B1" },
  { match: "emptyappserviceplans", monthly: 45.0, note: "App Service Plan B1/S1" },
  // Datos y mensajería.
  { match: "microsoft.sql/servers/elasticpools", monthly: 250.0 },
  { match: "elasticpools", monthly: 250.0 },
  { match: "emptysqlelasticpools", monthly: 150.0 },
  { match: "microsoft.sql/managedinstances", monthly: 1200.0 },
  { match: "microsoft.dbforpostgresql/flexibleservers", monthly: 25.0, note: "B1ms burstable baseline" },
  { match: "microsoft.dbformysql/flexibleservers", monthly: 25.0, note: "B1ms burstable baseline" },
  { match: "stoppedflexibleservers", monthly: 25.0 },
  { match: "microsoft.cache/redis", monthly: 41.0, note: "C1 Standard" },
  { match: "microsoft.documentdb", monthly: 24.0 },
  { match: "emptycosmosdbaccounts", monthly: 24.0 },
  { match: "microsoft.eventhub", monthly: 11.0 },
  { match: "emptyeventhubnamespaces", monthly: 11.0 },
  { match: "microsoft.servicebus", monthly: 10.0 },
  { match: "emptyservicebusnamespaces", monthly: 10.0 },
  { match: "microsoft.apimanagement", monthly: 50.0 },
  { match: "emptyapimanagement", monthly: 50.0 },
  { match: "microsoft.recoveryservices/vaults", monthly: 10.0 },
  { match: "unprovisionedexpressroute", monthly: 55.0 },
  { match: "expiredttlresources", monthly: 10.0 },
];

/**
 * Línea base por tipo ARM. Devuelve `source: 'none'` (y 0) cuando el tipo no
 * está catalogado: mejor un "—" honesto que un número inventado.
 *
 * Si se especifica `sizeGB` (>0) y el recurso es un disco o snapshot administrado,
 * calcula la línea base proporcional exacta según tarifas de Azure Storage:
 *  - Discos administrados: $0.154/GiB (tasa de referencia Premium SSD P10).
 *  - Snapshots: $0.05/GiB (tasa de referencia Standard Snapshot).
 */
export function baselineForResourceType(
  resourceIdOrType: string | null | undefined,
  sizeGB?: number | null
): { monthly: number; source: BaselineSource } {
  const lower = (resourceIdOrType || "").toLowerCase();
  if (!lower) return { monthly: 0, source: "none" };

  const parsedSize = Number(sizeGB);
  if (Number.isFinite(parsedSize) && parsedSize > 0) {
    if (lower.includes("disk") || lower.includes("unattacheddisks")) {
      const monthly = Number((parsedSize * 0.154).toFixed(2));
      return { monthly: monthly > 0 ? monthly : 19.71, source: "type_baseline" };
    }
    if (lower.includes("snapshot") || lower.includes("stalesnapshots")) {
      const monthly = Number((parsedSize * 0.05).toFixed(2));
      return { monthly: monthly > 0 ? monthly : 5.0, source: "type_baseline" };
    }
  }

  const hit = AZURE_MONTHLY_BASELINE_BY_TYPE.find((entry) => lower.includes(entry.match));
  return hit ? { monthly: hit.monthly, source: "type_baseline" } : { monthly: 0, source: "none" };
}

/**
 * Porcentaje de ahorro con guarda de división por cero.
 *
 *  - recurso eliminado con costo previo > 0 y posterior 0  -> 100 %
 *  - costBefore > costAfter                                -> delta / costBefore
 *  - costBefore <= 0 (sin línea base)                       -> 0 (la UI muestra "—")
 *
 * Nunca devuelve NaN ni Infinity: era el origen de las celdas vacías / "NaN%"
 * al auditar recursos sin costo previo registrado (ej. el clúster AKS de CSCS).
 */
export function safeSavingsPercentage(
  costBeforeUSD: number,
  costAfterUSD: number,
  wasDeleted = false
): number {
  const before = Number(costBeforeUSD);
  const after = Number(costAfterUSD);
  if (!Number.isFinite(before) || before <= 0) return 0;
  const safeAfter = Number.isFinite(after) && after > 0 ? after : 0;
  if (wasDeleted && safeAfter === 0) return 100;
  if (before <= safeAfter) return 0;
  return Number((((before - safeAfter) / before) * 100).toFixed(2));
}

/** "—" cuando no hay línea base; si no, el porcentaje con 2 decimales. */
export function formatSavingsPercentage(percentage: number, hasBaseline: boolean): string {
  if (!hasBaseline || !Number.isFinite(percentage) || percentage <= 0) return "—";
  return `${percentage.toFixed(2)}%`;
}

/**
 * Run-rate mensual a partir del costo observado en una ventana de N días.
 * Normaliza a 30 días para que ventanas parciales (un recurso eliminado hace 8
 * días) no subestimen la línea base.
 */
export function monthlyRunRate(totalCostUSD: number, windowDays: number): number {
  const total = Number(totalCostUSD);
  const days = Number(windowDays);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(days) || days <= 0) return 0;
  return Number(((total / days) * 30).toFixed(2));
}
