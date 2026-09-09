/**
 * Azure Network Watcher — FinOps de Diagnostico de Red
 *
 * RBAC minimo en Azure: `Reader` sobre las suscripciones (inventario via
 * Resource Graph). Solo lectura: la remediacion se entrega como comando CLI.
 *
 * El Network Watcher es gratuito; el gasto lo generan Traffic Analytics,
 * Connection Monitor y el almacenamiento de los Flow Logs. Este servicio
 * consolida esos tres cargos y los atribuye al watcher regional que los origina,
 * que es por que la tabla nativa de Azure muestra $0.00 y esta no.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import {
  CONNECTION_MONITOR_USD_PER_TEST_MONTH,
  FLOW_LOGS_STORAGE_USD_PER_GB_MONTH,
  NETWORK_SERVICE_COLORS,
  TRAFFIC_ANALYTICS_USD_PER_GB,
  type ConnectionMonitorConfig,
  type FlowLogConfig,
  type NetworkWatcherPayload,
  type NetworkWatcherRemediationAction,
  type NetworkWatcherResource,
  type NetworkWatcherSummaryMetrics,
  type TrafficAnalyticsInterval,
} from "@/types/azureNetworkWatcher.types";

// ─────────────────────────────────────────────────────────────────────────────
// Clasificacion de entorno y normalizacion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infiere si el scope es no productivo a partir del nombre del grupo de recursos
 * y de la suscripcion. Gobierna la Regla 1: un intervalo de 10 min en Dev es
 * gasto puro, en Prod puede estar justificado.
 *
 * ponytail: heuristica por nombre; migrar a tag `Environment` cuando el tagging
 * este al 100% (ver src/lib/tagConfig.ts).
 */
export function isDevOrTestScope(resourceGroup: string, subscriptionName: string): boolean {
  const haystack = `${resourceGroup} ${subscriptionName}`.toLowerCase();
  return /\b(dev|desarrollo|test|testing|qa|stg|stage|staging|sandbox|poc|lab|preprod|pre-prod|nonprod|non-prod)\b/.test(
    haystack
  );
}

/** Normaliza el intervalo de Traffic Analytics: Azure solo admite 10 o 60 min. */
export function normalizeTrafficAnalyticsInterval(raw: unknown): TrafficAnalyticsInterval | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  // Cualquier valor por debajo del punto medio se trata como el tramo de 10 min,
  // que es el caro. Redondear hacia el barato ocultaria la fuga.
  return n <= 35 ? 10 : 60;
}

/** Deriva el tipo de recurso monitoreado a partir del `targetResourceId`. */
export function deriveFlowLogTargetKind(targetResourceId: string): FlowLogConfig["targetKind"] {
  const lower = targetResourceId.toLowerCase();
  if (lower.includes("/networksecuritygroups/")) return "NSG";
  if (lower.includes("/virtualnetworks/")) return "VNet";
  return "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Calculo de costo real
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Costo mensual de Traffic Analytics.
 *
 * El intervalo NO cambia el volumen de flujos crudos que el NSG genera, pero si
 * el volumen procesado e ingerido: a 10 min Azure emite ~6 lotes por hora contra
 * 1 a 60 min, y cada lote arrastra su propio overhead de agregacion. En la
 * practica el modo de 10 min procesa del orden del doble de datos que el de 60.
 */
export function calcTrafficAnalyticsCost(processedGBPerMonth: number): number {
  return Number((processedGBPerMonth * TRAFFIC_ANALYTICS_USD_PER_GB).toFixed(2));
}

/** Volumen procesado esperado al pasar de 10 a 60 minutos. */
export function processedGBAtInterval(
  processedGBPerMonth: number,
  from: TrafficAnalyticsInterval,
  to: TrafficAnalyticsInterval
): number {
  if (from === to) return processedGBPerMonth;
  // 10 -> 60 recorta ~60% del volumen procesado; el camino inverso lo restituye.
  return from === 10 ? Number((processedGBPerMonth * 0.4).toFixed(2)) : Number((processedGBPerMonth / 0.4).toFixed(2));
}

export function calcConnectionMonitorCost(testsCount: number): number {
  return Number((testsCount * CONNECTION_MONITOR_USD_PER_TEST_MONTH).toFixed(2));
}

export function calcFlowLogsStorageCost(storedGBPerMonth: number): number {
  return Number((storedGBPerMonth * FLOW_LOGS_STORAGE_USD_PER_GB_MONTH).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de deteccion de fugas
// ─────────────────────────────────────────────────────────────────────────────

/** Regla 1 — Traffic Analytics a 10 min en un scope no productivo. */
export function hasWastefulInterval(watcher: {
  isDevOrTest: boolean;
  trafficAnalytics10MinCount: number;
}): boolean {
  return watcher.isDevOrTest && watcher.trafficAnalytics10MinCount > 0;
}

/** Regla 2 — Flow Logs con retencion infinita (`retentionPolicy.days == 0`). */
export function hasUnboundedRetention(flowLogs: FlowLogConfig[]): boolean {
  return flowLogs.some((f) => f.enabled && f.retentionDays === 0);
}

/**
 * Regla 3 — Connection Monitors con frecuencia agresiva (<=30 s) en entornos no
 * productivos, o apuntando a endpoints inalcanzables.
 */
export function hasWastefulMonitors(monitors: ConnectionMonitorConfig[], isDevOrTest: boolean): boolean {
  return monitors.some(
    (m) => m.hasUnreachableEndpoint || (isDevOrTest && m.minFrequencySeconds > 0 && m.minFrequencySeconds <= 30)
  );
}

/** Consolida las tres reglas en el flag y el motivo legible del watcher. */
export function deriveWasteState(watcher: {
  isDevOrTest: boolean;
  trafficAnalytics10MinCount: number;
  flowLogs: FlowLogConfig[];
  connectionMonitors: ConnectionMonitorConfig[];
}): { isWasteful: boolean; wasteReason?: string } {
  const reasons: string[] = [];
  if (hasWastefulInterval(watcher)) {
    reasons.push(
      `${watcher.trafficAnalytics10MinCount} configuracion(es) de Traffic Analytics a 10 min en un scope no productivo`
    );
  }
  if (hasUnboundedRetention(watcher.flowLogs)) {
    const n = watcher.flowLogs.filter((f) => f.enabled && f.retentionDays === 0).length;
    reasons.push(`${n} flow log(s) con retencion infinita`);
  }
  if (hasWastefulMonitors(watcher.connectionMonitors, watcher.isDevOrTest)) {
    reasons.push("Connection Monitors con frecuencia agresiva o endpoints inalcanzables");
  }
  return reasons.length > 0
    ? { isWasteful: true, wasteReason: reasons.join(" · ") }
    : { isWasteful: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregacion y recomendaciones
// ─────────────────────────────────────────────────────────────────────────────

export function calculateNetworkWatcherSummary(
  watchers: NetworkWatcherResource[],
  remediations: NetworkWatcherRemediationAction[]
): NetworkWatcherSummaryMetrics {
  const ta = watchers.reduce((a, w) => a + w.estimatedTrafficAnalyticsCostUSD, 0);
  const cm = watchers.reduce((a, w) => a + w.estimatedConnectionMonitorCostUSD, 0);
  const st = watchers.reduce((a, w) => a + w.estimatedStorageCostUSD, 0);
  const pc = watchers.reduce((a, w) => a + w.estimatedPacketCaptureCostUSD, 0);
  const total = ta + cm + st + pc;

  const rows: Array<[string, number]> = [
    ["Traffic Analytics", ta],
    ["Connection Monitor", cm],
    ["Flow Logs (Storage)", st],
    ["Packet Captures", pc],
  ];

  return {
    totalRealCostUSD: Number(total.toFixed(2)),
    totalWatchersCount: watchers.length,
    totalFlowLogsCount: watchers.reduce((a, w) => a + w.flowLogsCount, 0),
    totalConnectionMonitorsCount: watchers.reduce((a, w) => a + w.connectionMonitorsCount, 0),
    trafficAnalytics10MinCount: watchers.reduce((a, w) => a + w.trafficAnalytics10MinCount, 0),
    trafficAnalytics60MinCount: watchers.reduce((a, w) => a + w.trafficAnalytics60MinCount, 0),
    totalProcessedGBPerMonth: Number(
      watchers.reduce((a, w) => a + w.flowLogs.reduce((b, f) => b + f.processedGBPerMonth, 0), 0).toFixed(2)
    ),
    potentialSavingsUSD: Number(remediations.reduce((a, r) => a + r.estimatedSavingsUSD, 0).toFixed(2)),
    breakdownByService: rows
      .filter(([, cost]) => cost > 0)
      .map(([serviceName, costUSD]) => ({
        serviceName,
        costUSD: Number(costUSD.toFixed(2)),
        percentage: total > 0 ? Number(((costUSD / total) * 100).toFixed(1)) : 0,
        color: NETWORK_SERVICE_COLORS[serviceName],
      }))
      .sort((a, b) => b.costUSD - a.costUSD),
  };
}

export function generateNetworkWatcherRecommendations(
  watchers: NetworkWatcherResource[]
): NetworkWatcherRemediationAction[] {
  const out: NetworkWatcherRemediationAction[] = [];

  for (const w of watchers) {
    // Regla 1 — bajar Traffic Analytics de 10 a 60 min en no-prod.
    if (hasWastefulInterval(w)) {
      const gb10 = w.flowLogs
        .filter((f) => f.trafficAnalyticsEnabled && f.trafficAnalyticsInterval === 10)
        .reduce((a, f) => a + f.processedGBPerMonth, 0);
      const saving = calcTrafficAnalyticsCost(gb10) - calcTrafficAnalyticsCost(processedGBAtInterval(gb10, 10, 60));
      out.push({
        id: `ta-interval-${w.id}`,
        resourceId: w.id,
        params: { location: w.location, rg: w.resourceGroup, count: w.trafficAnalytics10MinCount },
        category: "TRAFFIC_ANALYTICS_INTERVAL",
        estimatedSavingsUSD: Number(Math.max(0, saving).toFixed(2)),
        confidence: "HIGH",
        actionType: "SET_TA_INTERVAL_60",
      });
    }

    // Regla 2 — ciclo de vida en la Storage Account de los flow logs.
    if (hasUnboundedRetention(w.flowLogs)) {
      const unbounded = w.flowLogs.filter((f) => f.enabled && f.retentionDays === 0);
      const gb = unbounded.reduce((a, f) => a + f.storedGBPerMonth, 0);
      // Con retencion infinita el blob crece indefinidamente. Una politica de 30
      // dias estabiliza el acumulado; el ahorro sostenido se aproxima con el
      // crecimiento mensual que se deja de acumular.
      out.push({
        id: `retention-${w.id}`,
        resourceId: w.id,
        params: { storage: w.linkedStorageAccountName || "SIN_CUENTA", count: unbounded.length, gb: gb.toFixed(1) },
        category: "STORAGE_LIFECYCLE",
        estimatedSavingsUSD: calcFlowLogsStorageCost(gb),
        confidence: "HIGH",
        actionType: "SET_LIFECYCLE_30D",
      });
    }

    // Regla 3 — monitores huerfanos o con sondeo agresivo.
    const orphanMonitors = w.connectionMonitors.filter((m) => m.hasUnreachableEndpoint);
    if (orphanMonitors.length > 0) {
      out.push({
        id: `cm-orphan-${w.id}`,
        resourceId: w.id,
        params: { count: orphanMonitors.length, location: w.location, rate: CONNECTION_MONITOR_USD_PER_TEST_MONTH },
        category: "ORPHAN_PURGE",
        estimatedSavingsUSD: calcConnectionMonitorCost(orphanMonitors.reduce((a, m) => a + m.testsCount, 0)),
        confidence: "HIGH",
        actionType: "DELETE_CONNECTION_MONITOR",
      });
    }

    const aggressive = w.connectionMonitors.filter(
      (m) => !m.hasUnreachableEndpoint && w.isDevOrTest && m.minFrequencySeconds > 0 && m.minFrequencySeconds <= 30
    );
    if (aggressive.length > 0) {
      out.push({
        id: `cm-freq-${w.id}`,
        resourceId: w.id,
        params: { count: aggressive.length, location: w.location, seconds: Math.min(...aggressive.map((m) => m.minFrequencySeconds)) },
        category: "MONITOR_FREQUENCY",
        // La tarifa es por prueba/mes, no por sondeo: el ahorro directo es nulo,
        // el beneficio es menos ingesta de telemetria asociada. No se infla.
        estimatedSavingsUSD: 0,
        confidence: "MEDIUM",
        actionType: "SET_MONITOR_FREQUENCY_300",
      });
    }
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado de un watcher (compartido entre mock y live)
// ─────────────────────────────────────────────────────────────────────────────

export function assembleWatcher(input: {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  flowLogs: FlowLogConfig[];
  connectionMonitors: ConnectionMonitorConfig[];
  packetCapturesCount: number;
}): NetworkWatcherResource {
  const { flowLogs, connectionMonitors } = input;
  const isDevOrTest = isDevOrTestScope(input.resourceGroup, input.subscriptionName);

  const active = flowLogs.filter((f) => f.enabled);
  const taActive = active.filter((f) => f.trafficAnalyticsEnabled);

  const processedGB = taActive.reduce((a, f) => a + f.processedGBPerMonth, 0);
  const storedGB = active.reduce((a, f) => a + f.storedGBPerMonth, 0);

  const estimatedTrafficAnalyticsCostUSD = calcTrafficAnalyticsCost(processedGB);
  const estimatedConnectionMonitorCostUSD = Number(
    connectionMonitors.reduce((a, m) => a + m.monthlyCostUSD, 0).toFixed(2)
  );
  const estimatedStorageCostUSD = calcFlowLogsStorageCost(storedGB);
  // Packet captures se cobran como blobs en la storage de destino; en ausencia
  // de su tamaño real se dimensiona con un promedio conservador por captura.
  const estimatedPacketCaptureCostUSD = Number(
    (input.packetCapturesCount * 0.5 * FLOW_LOGS_STORAGE_USD_PER_GB_MONTH).toFixed(2)
  );

  const retentions = active.map((f) => f.retentionDays);
  const { isWasteful, wasteReason } = deriveWasteState({
    isDevOrTest,
    trafficAnalytics10MinCount: taActive.filter((f) => f.trafficAnalyticsInterval === 10).length,
    flowLogs,
    connectionMonitors,
  });

  const linked = active.find((f) => f.storageAccountName);

  return {
    id: input.id,
    name: input.name,
    location: input.location,
    resourceGroup: input.resourceGroup,
    subscriptionId: input.subscriptionId,
    subscriptionName: input.subscriptionName,
    flowLogsCount: flowLogs.length,
    trafficAnalyticsActiveCount: taActive.length,
    trafficAnalytics10MinCount: taActive.filter((f) => f.trafficAnalyticsInterval === 10).length,
    trafficAnalytics60MinCount: taActive.filter((f) => f.trafficAnalyticsInterval === 60).length,
    connectionMonitorsCount: connectionMonitors.length,
    packetCapturesCount: input.packetCapturesCount,
    linkedStorageAccountId: linked?.storageId,
    linkedStorageAccountName: linked?.storageAccountName,
    // 0 significa retencion infinita, no "sin retencion": si alguno la tiene,
    // ese es el valor que manda para la gobernanza.
    storageRetentionDays: retentions.includes(0) ? 0 : retentions.length > 0 ? Math.min(...retentions) : 0,
    estimatedTrafficAnalyticsCostUSD,
    estimatedConnectionMonitorCostUSD,
    estimatedStorageCostUSD,
    estimatedPacketCaptureCostUSD,
    totalEstimatedRealCostUSD: Number(
      (
        estimatedTrafficAnalyticsCostUSD +
        estimatedConnectionMonitorCostUSD +
        estimatedStorageCostUSD +
        estimatedPacketCaptureCostUSD
      ).toFixed(2)
    ),
    isDevOrTest,
    isWasteful,
    wasteReason,
    flowLogs,
    connectionMonitors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintetico por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

function flowLog(over: Partial<FlowLogConfig> & { name: string }): FlowLogConfig {
  return {
    id: over.id || `/subscriptions/s1/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/nw/flowLogs/${over.name}`,
    name: over.name,
    targetResourceId: over.targetResourceId || "/subscriptions/s1/resourceGroups/rg-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-prod",
    targetResourceName: over.targetResourceName || "nsg-prod",
    targetKind: over.targetKind || "NSG",
    enabled: over.enabled ?? true,
    storageId: over.storageId || "/subscriptions/s1/resourceGroups/rg-logs/providers/Microsoft.Storage/storageAccounts/stflowlogs",
    storageAccountName: over.storageAccountName || "stflowlogs",
    retentionDays: over.retentionDays ?? 30,
    trafficAnalyticsEnabled: over.trafficAnalyticsEnabled ?? true,
    trafficAnalyticsInterval: over.trafficAnalyticsInterval ?? 60,
    workspaceId: over.workspaceId,
    processedGBPerMonth: over.processedGBPerMonth ?? 12,
    storedGBPerMonth: over.storedGBPerMonth ?? 40,
  };
}

function monitor(over: Partial<ConnectionMonitorConfig> & { name: string }): ConnectionMonitorConfig {
  const testsCount = over.testsCount ?? 3;
  return {
    id: over.id || `/subscriptions/s1/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/nw/connectionMonitors/${over.name}`,
    name: over.name,
    testsCount,
    minFrequencySeconds: over.minFrequencySeconds ?? 60,
    endpointsCount: over.endpointsCount ?? 2,
    hasUnreachableEndpoint: over.hasUnreachableEndpoint ?? false,
    monthlyCostUSD: over.monthlyCostUSD ?? calcConnectionMonitorCost(testsCount),
  };
}

export function getMockNetworkWatcherPayload(tenantId: string): NetworkWatcherPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const watchers: NetworkWatcherResource[] = [
    assembleWatcher({
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_eastus",
      name: "NetworkWatcher_eastus",
      location: "eastus",
      resourceGroup: "NetworkWatcherRG",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Produccion CSCloudSolutions",
      flowLogs: [
        flowLog({ name: "fl-nsg-web-prod", processedGBPerMonth: 34, storedGBPerMonth: 110, retentionDays: 30 }),
        flowLog({
          name: "fl-vnet-hub-prod",
          targetKind: "VNet",
          targetResourceName: "vnet-hub",
          processedGBPerMonth: 58,
          storedGBPerMonth: 190,
          // Regla 2: retencion infinita en produccion.
          retentionDays: 0,
        }),
      ],
      connectionMonitors: [monitor({ name: "cm-hub-to-onprem", testsCount: 4, minFrequencySeconds: 60 })],
      packetCapturesCount: 1,
    }),
    assembleWatcher({
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-dev-network/providers/Microsoft.Network/networkWatchers/NetworkWatcher_westus2",
      name: "NetworkWatcher_westus2",
      location: "westus2",
      resourceGroup: "rg-dev-network",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Produccion CSCloudSolutions",
      flowLogs: [
        // Regla 1: 10 min en un RG de desarrollo.
        flowLog({
          name: "fl-nsg-dev",
          targetResourceName: "nsg-dev",
          trafficAnalyticsInterval: 10,
          processedGBPerMonth: 26,
          storedGBPerMonth: 60,
          retentionDays: 7,
        }),
      ],
      // Regla 3: sondeo cada 30 s en desarrollo.
      connectionMonitors: [monitor({ name: "cm-dev-api", testsCount: 2, minFrequencySeconds: 30 })],
      packetCapturesCount: 0,
    }),
    assembleWatcher({
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_brazilsouth",
      name: "NetworkWatcher_brazilsouth",
      location: "brazilsouth",
      resourceGroup: "NetworkWatcherRG",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Produccion CSCloudSolutions",
      // Region sin trafico: watcher aprovisionado por defecto, sin flow logs.
      flowLogs: [],
      connectionMonitors: [],
      packetCapturesCount: 0,
    }),
  ];

  if (isBusiness) {
    watchers.push(
      assembleWatcher({
        id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-staging-net/providers/Microsoft.Network/networkWatchers/NetworkWatcher_northeurope",
        name: "NetworkWatcher_northeurope",
        location: "northeurope",
        resourceGroup: "rg-staging-net",
        subscriptionId: "00000000-0000-0000-0000-000000000002",
        subscriptionName: "Cumplimiento y Auditoria",
        flowLogs: [
          flowLog({
            name: "fl-nsg-staging",
            targetResourceName: "nsg-staging",
            trafficAnalyticsInterval: 10,
            processedGBPerMonth: 19,
            storedGBPerMonth: 48,
            retentionDays: 0,
          }),
        ],
        connectionMonitors: [
          monitor({ name: "cm-staging-legacy", testsCount: 3, hasUnreachableEndpoint: true, minFrequencySeconds: 60 }),
        ],
        packetCapturesCount: 2,
      })
    );
  }

  if (isEnterprise) {
    watchers.push(
      assembleWatcher({
        id: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_southeastasia",
        name: "NetworkWatcher_southeastasia",
        location: "southeastasia",
        resourceGroup: "NetworkWatcherRG",
        subscriptionId: "00000000-0000-0000-0000-000000000003",
        subscriptionName: "Operaciones Globales",
        flowLogs: [
          flowLog({ name: "fl-vnet-apac", targetKind: "VNet", targetResourceName: "vnet-apac", processedGBPerMonth: 71, storedGBPerMonth: 240, retentionDays: 90 }),
          flowLog({ name: "fl-nsg-apac-edge", targetResourceName: "nsg-apac-edge", processedGBPerMonth: 44, storedGBPerMonth: 150, retentionDays: 30 }),
        ],
        connectionMonitors: [
          monitor({ name: "cm-apac-mesh", testsCount: 8, minFrequencySeconds: 60, endpointsCount: 6 }),
        ],
        packetCapturesCount: 3,
      }),
      assembleWatcher({
        id: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-sandbox-net/providers/Microsoft.Network/networkWatchers/NetworkWatcher_australiaeast",
        name: "NetworkWatcher_australiaeast",
        location: "australiaeast",
        resourceGroup: "rg-sandbox-net",
        subscriptionId: "00000000-0000-0000-0000-000000000003",
        subscriptionName: "Operaciones Globales",
        flowLogs: [
          flowLog({
            name: "fl-nsg-sandbox",
            targetResourceName: "nsg-sandbox",
            trafficAnalyticsInterval: 10,
            processedGBPerMonth: 15,
            storedGBPerMonth: 35,
            retentionDays: 0,
          }),
        ],
        connectionMonitors: [
          monitor({ name: "cm-sandbox-ping", testsCount: 2, minFrequencySeconds: 10, hasUnreachableEndpoint: true }),
        ],
        packetCapturesCount: 0,
      })
    );
  }

  const remediations = generateNetworkWatcherRecommendations(watchers);
  const summary = calculateNetworkWatcherSummary(watchers, remediations);

  // Serie determinista (sin Math.random) para que la demo sea estable.
  const dailyGB = summary.totalProcessedGBPerMonth / 30;
  const ingestTrend = Array.from({ length: 30 }, (_, i) => {
    const wave = 1 + 0.22 * Math.sin((i / 30) * Math.PI * 3);
    const processedGB = Number((dailyGB * wave).toFixed(2));
    return {
      date: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
      processedGB,
      costUSD: Number((processedGB * TRAFFIC_ANALYTICS_USD_PER_GB).toFixed(2)),
    };
  });

  return {
    summary,
    watchers,
    remediations,
    ingestTrend,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: Array.from(new Set(watchers.map((w) => w.subscriptionName))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descubrimiento vivo (Azure Resource Graph)
// ─────────────────────────────────────────────────────────────────────────────

function emptyPayload(availableSubscriptions: string[] = []): NetworkWatcherPayload {
  return {
    summary: calculateNetworkWatcherSummary([], []),
    watchers: [],
    remediations: [],
    ingestTrend: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions,
  };
}

/** Extrae el ID del Network Watcher padre a partir del ID de un recurso hijo. */
export function parentWatcherId(childId: string): string {
  const marker = "/networkwatchers/";
  const lower = childId.toLowerCase();
  const idx = lower.indexOf(marker);
  if (idx === -1) return "";
  const after = childId.slice(idx + marker.length);
  const name = after.split("/")[0];
  return `${childId.slice(0, idx + marker.length)}${name}`.toLowerCase();
}

/**
 * Inventario vivo de Network Watchers y sus recursos satelite.
 * Devuelve estado vacio legitimo cuando no hay credenciales o no hay watchers:
 * nunca cae al dataset mock (Directiva 24.1).
 */
export async function fetchLiveNetworkWatcherData(tenantId: string): Promise<NetworkWatcherPayload> {
  try {
    const credentials = await getAzureCredential(tenantId);
    if (!credentials) return emptyPayload();

    const subMap = await getSubscriptionNameMap(tenantId, credentials).catch(() => new Map<string, string>());
    const client = await getResourceGraphClient(tenantId);

    const watchersQuery = `
      resources
      | where type =~ 'microsoft.network/networkwatchers'
      | project id, name, location, resourceGroup, subscriptionId
    `;
    const flowLogsQuery = `
      resources
      | where type =~ 'microsoft.network/networkwatchers/flowlogs'
      | project id, name, location, resourceGroup, subscriptionId, properties
    `;
    const monitorsQuery = `
      resources
      | where type =~ 'microsoft.network/networkwatchers/connectionmonitors'
      | project id, name, location, resourceGroup, subscriptionId, properties
    `;
    const capturesQuery = `
      resources
      | where type =~ 'microsoft.network/networkwatchers/packetcaptures'
      | project id, name
    `;

    const [wRes, flRes, cmRes, pcRes] = await withArgLimit(async () => {
      return await Promise.all([
        client.resources({ query: watchersQuery }),
        client.resources({ query: flowLogsQuery }),
        client.resources({ query: monitorsQuery }),
        client.resources({ query: capturesQuery }),
      ]);
    });

    const watcherRows: Array<Record<string, unknown>> = wRes.data || [];
    const availableSubscriptions = Array.from(subMap.values());
    if (watcherRows.length === 0) return emptyPayload(availableSubscriptions);

    // Indexar los recursos satelite por watcher padre.
    const flowLogsByWatcher = new Map<string, FlowLogConfig[]>();
    for (const row of (flRes.data || []) as Array<Record<string, unknown>>) {
      const id = String(row.id || "");
      const parent = parentWatcherId(id);
      if (!parent) continue;
      const props = (row.properties || {}) as Record<string, unknown>;
      const retention = (props.retentionPolicy || {}) as Record<string, unknown>;
      const flowAnalytics = (props.flowAnalyticsConfiguration || {}) as Record<string, unknown>;
      const taCfg = (flowAnalytics.networkWatcherFlowAnalyticsConfiguration || {}) as Record<string, unknown>;

      const targetResourceId = String(props.targetResourceId || "");
      const storageId = typeof props.storageId === "string" ? props.storageId : undefined;
      const taEnabled = taCfg.enabled === true;

      flowLogsByWatcher.set(parent, [
        ...(flowLogsByWatcher.get(parent) || []),
        {
          id,
          name: String(row.name || ""),
          targetResourceId,
          targetResourceName: targetResourceId.split("/").pop() || "",
          targetKind: deriveFlowLogTargetKind(targetResourceId),
          enabled: props.enabled !== false,
          storageId,
          storageAccountName: storageId ? storageId.split("/").pop() : undefined,
          // `retentionPolicy.days === 0` es retencion infinita, no ausencia.
          retentionDays: typeof retention.days === "number" ? retention.days : 0,
          trafficAnalyticsEnabled: taEnabled,
          trafficAnalyticsInterval: taEnabled
            ? normalizeTrafficAnalyticsInterval(taCfg.trafficAnalyticsInterval)
            : undefined,
          workspaceId: typeof taCfg.workspaceResourceId === "string" ? taCfg.workspaceResourceId : undefined,
          // Sin telemetria de volumen en ARG el procesado queda en 0 y la UI
          // muestra $0.00 real. Inventarlo seria el fallback que la Directiva
          // 24.1 prohibe; se poblara al cruzar con Cost Management.
          processedGBPerMonth: 0,
          storedGBPerMonth: 0,
        },
      ]);
    }

    const monitorsByWatcher = new Map<string, ConnectionMonitorConfig[]>();
    for (const row of (cmRes.data || []) as Array<Record<string, unknown>>) {
      const id = String(row.id || "");
      const parent = parentWatcherId(id);
      if (!parent) continue;
      const props = (row.properties || {}) as Record<string, unknown>;
      const testConfigs = Array.isArray(props.testConfigurations) ? props.testConfigurations : [];
      const endpoints = Array.isArray(props.endpoints) ? props.endpoints : [];
      const frequencies = testConfigs
        .map((t) => Number((t as { testFrequencySec?: unknown }).testFrequencySec))
        .filter((n) => Number.isFinite(n) && n > 0);
      const testsCount = testConfigs.length || 1;

      monitorsByWatcher.set(parent, [
        ...(monitorsByWatcher.get(parent) || []),
        {
          id,
          name: String(row.name || ""),
          testsCount,
          minFrequencySeconds: frequencies.length > 0 ? Math.min(...frequencies) : 0,
          endpointsCount: endpoints.length,
          // Un endpoint inalcanzable no se puede afirmar desde ARG: haria falta
          // el estado del monitor. Se deja en false en vez de adivinar.
          hasUnreachableEndpoint: false,
          monthlyCostUSD: calcConnectionMonitorCost(testsCount),
        },
      ]);
    }

    const capturesByWatcher = new Map<string, number>();
    for (const row of (pcRes.data || []) as Array<{ id?: string }>) {
      const parent = parentWatcherId(String(row.id || ""));
      if (!parent) continue;
      capturesByWatcher.set(parent, (capturesByWatcher.get(parent) || 0) + 1);
    }

    const watchers = watcherRows.map((row) => {
      const id = String(row.id || "");
      const key = id.toLowerCase();
      const subscriptionId = String(row.subscriptionId || "");
      return assembleWatcher({
        id,
        name: String(row.name || ""),
        location: String(row.location || ""),
        resourceGroup: String(row.resourceGroup || ""),
        subscriptionId,
        subscriptionName: subMap.get(subscriptionId) || subscriptionId,
        flowLogs: flowLogsByWatcher.get(key) || [],
        connectionMonitors: monitorsByWatcher.get(key) || [],
        packetCapturesCount: capturesByWatcher.get(key) || 0,
      });
    });

    const remediations = generateNetworkWatcherRecommendations(watchers);
    const summary = calculateNetworkWatcherSummary(watchers, remediations);

    return {
      summary,
      watchers,
      remediations,
      ingestTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions,
    };
  } catch (error) {
    console.error("[azureNetworkWatcher.service] fetchLiveNetworkWatcherData:", errorMessage(error));
    return emptyPayload();
  }
}
