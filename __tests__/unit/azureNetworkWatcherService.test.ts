import { describe, it, expect } from "vitest";
import {
  isDevOrTestScope,
  normalizeTrafficAnalyticsInterval,
  deriveFlowLogTargetKind,
  calcTrafficAnalyticsCost,
  processedGBAtInterval,
  calcConnectionMonitorCost,
  calcFlowLogsStorageCost,
  hasWastefulInterval,
  hasUnboundedRetention,
  hasWastefulMonitors,
  deriveWasteState,
  assembleWatcher,
  calculateNetworkWatcherSummary,
  generateNetworkWatcherRecommendations,
  getMockNetworkWatcherPayload,
  parentWatcherId,
  fetchLiveNetworkWatcherData,
} from "@/services/azureNetworkWatcher.service";
import { buildNetworkWatcherRemediationCommand } from "@/lib/aiRemediations";
import type { ConnectionMonitorConfig, FlowLogConfig } from "@/types/azureNetworkWatcher.types";

const fl = (over: Partial<FlowLogConfig> = {}): FlowLogConfig => ({
  id: "/subscriptions/s/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/nw/flowLogs/f",
  name: "f",
  targetResourceId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/networkSecurityGroups/nsg",
  targetResourceName: "nsg",
  targetKind: "NSG",
  enabled: true,
  retentionDays: 30,
  trafficAnalyticsEnabled: true,
  trafficAnalyticsInterval: 60,
  processedGBPerMonth: 10,
  storedGBPerMonth: 20,
  ...over,
});

const cm = (over: Partial<ConnectionMonitorConfig> = {}): ConnectionMonitorConfig => ({
  id: "/subscriptions/s/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/nw/connectionMonitors/m",
  name: "m",
  testsCount: 3,
  minFrequencySeconds: 60,
  endpointsCount: 2,
  hasUnreachableEndpoint: false,
  monthlyCostUSD: 0.9,
  ...over,
});

describe("Network Watcher — clasificacion y normalizacion", () => {
  it("detecta scopes no productivos por nombre de RG o suscripcion", () => {
    expect(isDevOrTestScope("rg-dev-network", "Prod")).toBe(true);
    expect(isDevOrTestScope("rg-staging-net", "Prod")).toBe(true);
    expect(isDevOrTestScope("NetworkWatcherRG", "Suscripcion QA")).toBe(true);
    expect(isDevOrTestScope("rg-sandbox-net", "Operaciones")).toBe(true);
    expect(isDevOrTestScope("NetworkWatcherRG", "Produccion CSCloudSolutions")).toBe(false);
    // No debe disparar por subcadenas dentro de otra palabra.
    expect(isDevOrTestScope("rg-device-mgmt", "Produccion")).toBe(false);
    expect(isDevOrTestScope("rg-latest-app", "Produccion")).toBe(false);
  });

  it("normaliza el intervalo de Traffic Analytics a los dos valores que admite Azure", () => {
    expect(normalizeTrafficAnalyticsInterval(10)).toBe(10);
    expect(normalizeTrafficAnalyticsInterval(60)).toBe(60);
    // Valores intermedios se resuelven hacia 10: redondear al barato ocultaria la fuga.
    expect(normalizeTrafficAnalyticsInterval(30)).toBe(10);
    expect(normalizeTrafficAnalyticsInterval("10")).toBe(10);
    expect(normalizeTrafficAnalyticsInterval(undefined)).toBeUndefined();
    expect(normalizeTrafficAnalyticsInterval("x")).toBeUndefined();
  });

  it("deriva el tipo de recurso monitoreado por el flow log", () => {
    expect(deriveFlowLogTargetKind("/subscriptions/s/providers/Microsoft.Network/networkSecurityGroups/nsg")).toBe("NSG");
    expect(deriveFlowLogTargetKind("/subscriptions/s/providers/Microsoft.Network/virtualNetworks/vnet")).toBe("VNet");
    expect(deriveFlowLogTargetKind("/otro/tipo")).toBe("Unknown");
  });

  it("extrae el watcher padre del id de un recurso hijo", () => {
    const child =
      "/subscriptions/s/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NW_eastus/flowLogs/fl-1";
    expect(parentWatcherId(child)).toBe(
      "/subscriptions/s/resourcegroups/networkwatcherrg/providers/microsoft.network/networkwatchers/nw_eastus"
    );
    expect(parentWatcherId("/algo/sin/watcher")).toBe("");
  });
});

describe("Network Watcher — calculo de costo real", () => {
  it("valua cada capacidad con su tarifa", () => {
    expect(calcTrafficAnalyticsCost(10)).toBe(23);
    expect(calcConnectionMonitorCost(4)).toBe(1.2);
    expect(calcFlowLogsStorageCost(100)).toBe(2.1);
    expect(calcTrafficAnalyticsCost(0)).toBe(0);
  });

  it("pasar de 10 a 60 min recorta el volumen procesado y el camino inverso lo restituye", () => {
    expect(processedGBAtInterval(100, 10, 60)).toBe(40);
    expect(processedGBAtInterval(40, 60, 10)).toBe(100);
    expect(processedGBAtInterval(50, 60, 60)).toBe(50);
  });

  it("el watcher consolida las cuatro capacidades en un unico costo real", () => {
    const w = assembleWatcher({
      id: "/subscriptions/s/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/nw",
      name: "nw",
      location: "eastus",
      resourceGroup: "NetworkWatcherRG",
      subscriptionId: "s",
      subscriptionName: "Produccion",
      flowLogs: [fl({ processedGBPerMonth: 10, storedGBPerMonth: 100 })],
      connectionMonitors: [cm({ monthlyCostUSD: 0.9 })],
      packetCapturesCount: 2,
    });

    expect(w.estimatedTrafficAnalyticsCostUSD).toBe(23);
    expect(w.estimatedConnectionMonitorCostUSD).toBe(0.9);
    expect(w.estimatedStorageCostUSD).toBe(2.1);
    expect(w.totalEstimatedRealCostUSD).toBeCloseTo(
      w.estimatedTrafficAnalyticsCostUSD +
        w.estimatedConnectionMonitorCostUSD +
        w.estimatedStorageCostUSD +
        w.estimatedPacketCaptureCostUSD,
      2
    );
  });

  it("un flow log deshabilitado no suma costo", () => {
    const w = assembleWatcher({
      id: "/subscriptions/s/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/nw",
      name: "nw",
      location: "eastus",
      resourceGroup: "NetworkWatcherRG",
      subscriptionId: "s",
      subscriptionName: "Produccion",
      flowLogs: [fl({ enabled: false, processedGBPerMonth: 500, storedGBPerMonth: 900 })],
      connectionMonitors: [],
      packetCapturesCount: 0,
    });
    expect(w.estimatedTrafficAnalyticsCostUSD).toBe(0);
    expect(w.estimatedStorageCostUSD).toBe(0);
    expect(w.totalEstimatedRealCostUSD).toBe(0);
  });

  it("una region sin flow logs ni monitores queda en $0.00 real, no en null", () => {
    const w = assembleWatcher({
      id: "/subscriptions/s/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/nw",
      name: "nw",
      location: "brazilsouth",
      resourceGroup: "NetworkWatcherRG",
      subscriptionId: "s",
      subscriptionName: "Produccion",
      flowLogs: [],
      connectionMonitors: [],
      packetCapturesCount: 0,
    });
    expect(w.totalEstimatedRealCostUSD).toBe(0);
    expect(w.isWasteful).toBe(false);
  });
});

describe("Network Watcher — motor de deteccion de fugas", () => {
  it("Regla 1: 10 min solo es fuga en scope no productivo", () => {
    expect(hasWastefulInterval({ isDevOrTest: true, trafficAnalytics10MinCount: 1 })).toBe(true);
    // En produccion 10 min puede estar justificado por deteccion temprana.
    expect(hasWastefulInterval({ isDevOrTest: false, trafficAnalytics10MinCount: 3 })).toBe(false);
    expect(hasWastefulInterval({ isDevOrTest: true, trafficAnalytics10MinCount: 0 })).toBe(false);
  });

  it("Regla 2: retencion 0 es infinita, no ausencia de retencion", () => {
    expect(hasUnboundedRetention([fl({ retentionDays: 0 })])).toBe(true);
    expect(hasUnboundedRetention([fl({ retentionDays: 30 })])).toBe(false);
    // Un flow log deshabilitado con retencion infinita ya no acumula.
    expect(hasUnboundedRetention([fl({ retentionDays: 0, enabled: false })])).toBe(false);
  });

  it("Regla 3: endpoints huerfanos cuentan siempre; la frecuencia agresiva solo en no-prod", () => {
    expect(hasWastefulMonitors([cm({ hasUnreachableEndpoint: true })], false)).toBe(true);
    expect(hasWastefulMonitors([cm({ minFrequencySeconds: 30 })], true)).toBe(true);
    expect(hasWastefulMonitors([cm({ minFrequencySeconds: 30 })], false)).toBe(false);
    expect(hasWastefulMonitors([cm({ minFrequencySeconds: 60 })], true)).toBe(false);
  });

  it("acumula todos los motivos de desperdicio en un unico texto", () => {
    const state = deriveWasteState({
      isDevOrTest: true,
      trafficAnalytics10MinCount: 2,
      flowLogs: [fl({ retentionDays: 0 })],
      connectionMonitors: [cm({ hasUnreachableEndpoint: true })],
    });
    expect(state.isWasteful).toBe(true);
    expect(state.wasteReason).toContain("10 min");
    expect(state.wasteReason).toContain("retencion infinita");
    expect(state.wasteReason).toContain("Connection Monitors");

    const clean = deriveWasteState({
      isDevOrTest: false,
      trafficAnalytics10MinCount: 0,
      flowLogs: [fl()],
      connectionMonitors: [cm()],
    });
    expect(clean.isWasteful).toBe(false);
    expect(clean.wasteReason).toBeUndefined();
  });
});

describe("Network Watcher — payload demo y agregacion", () => {
  it("genera dataset sintetico con las tres fugas representadas", () => {
    const payload = getMockNetworkWatcherPayload("demo-tenant-2222");
    expect(payload.source).toBe("mock");
    expect(payload.watchers.length).toBeGreaterThan(3);
    expect(payload.summary.totalWatchersCount).toBe(payload.watchers.length);
    expect(payload.summary.trafficAnalytics10MinCount).toBeGreaterThan(0);
    expect(payload.remediations.some((r) => r.category === "TRAFFIC_ANALYTICS_INTERVAL")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "STORAGE_LIFECYCLE")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "ORPHAN_PURGE")).toBe(true);
    expect(payload.ingestTrend?.length).toBe(30);
  });

  it("incluye una region sin trafico en $0.00, que es el caso real mas comun", () => {
    const payload = getMockNetworkWatcherPayload("demo-1111");
    const idle = payload.watchers.find((w) => w.flowLogsCount === 0);
    expect(idle).toBeDefined();
    expect(idle?.totalEstimatedRealCostUSD).toBe(0);
  });

  it("escala por tier y es determinista", () => {
    const pro = getMockNetworkWatcherPayload("demo-1111");
    const business = getMockNetworkWatcherPayload("demo-2222");
    const enterprise = getMockNetworkWatcherPayload("demo-4444");
    expect(business.watchers.length).toBeGreaterThan(pro.watchers.length);
    expect(enterprise.watchers.length).toBeGreaterThan(business.watchers.length);

    const again = getMockNetworkWatcherPayload("demo-4444");
    expect(again.summary.totalRealCostUSD).toBe(enterprise.summary.totalRealCostUSD);
    expect(again.ingestTrend?.map((p) => p.processedGB)).toEqual(enterprise.ingestTrend?.map((p) => p.processedGB));
  });

  it("el desglose por servicio suma 100% y omite las capacidades sin gasto", () => {
    const payload = getMockNetworkWatcherPayload("demo-4444");
    const pct = payload.summary.breakdownByService.reduce((a, b) => a + b.percentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
    expect(payload.summary.breakdownByService.every((b) => b.costUSD > 0)).toBe(true);
  });

  it("no infla el ahorro de la frecuencia de sondeo: esa tarifa es por prueba/mes", () => {
    const payload = getMockNetworkWatcherPayload("demo-4444");
    const freq = payload.remediations.filter((r) => r.category === "MONITOR_FREQUENCY");
    expect(freq.length).toBeGreaterThan(0);
    expect(freq.every((r) => r.estimatedSavingsUSD === 0)).toBe(true);
  });

  it("summary vacio no divide por cero", () => {
    const s = calculateNetworkWatcherSummary([], []);
    expect(s.totalRealCostUSD).toBe(0);
    expect(s.breakdownByService).toEqual([]);
    expect(generateNetworkWatcherRecommendations([])).toEqual([]);
  });

  it("un tenant real sin credenciales recibe estado vacio legitimo, nunca el mock", async () => {
    const result = await fetchLiveNetworkWatcherData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.watchers).toEqual([]);
    expect(result.summary.totalRealCostUSD).toBe(0);
    expect(result.remediations).toEqual([]);
  });
});

describe("Network Watcher — comandos de remediacion", () => {
  const base = {
    id: "r",
    resourceId:
      "/subscriptions/s/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_eastus",
    title: "t",
    description: "d",
    estimatedSavingsUSD: 5,
    confidence: "HIGH" as const,
    actionType: "X",
  };

  it("entrega CLI y PowerShell por categoria", () => {
    const ta = buildNetworkWatcherRemediationCommand({ ...base, category: "TRAFFIC_ANALYTICS_INTERVAL" });
    expect(ta.cli).toContain("--interval 60");
    expect(ta.powershell).toContain("TrafficAnalyticsInterval 60");

    const lc = buildNetworkWatcherRemediationCommand({ ...base, category: "STORAGE_LIFECYCLE" });
    // Hacen falta las dos patas: retencion del flow log y lifecycle del contenedor.
    expect(lc.cli).toContain("--retention 30");
    expect(lc.cli).toContain("management-policy");
    expect(lc.cli).toContain("insights-logs-networksecuritygroupflowevent");

    const mf = buildNetworkWatcherRemediationCommand({ ...base, category: "MONITOR_FREQUENCY" });
    expect(mf.cli).toContain("--frequency 300");

    const op = buildNetworkWatcherRemediationCommand({ ...base, category: "ORPHAN_PURGE" });
    expect(op.cli).toContain("connection-monitor delete");
  });

  it("escapa el nombre del watcher tomado del resourceId", () => {
    const hostil = buildNetworkWatcherRemediationCommand({
      ...base,
      resourceId:
        '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/networkWatchers/nw"; rm -rf ~; #',
      category: "ORPHAN_PURGE",
    });
    expect(hostil.powershell).toContain('nw\\"');
    expect(hostil.powershell).not.toMatch(/-Name "nw"; rm/);
  });
});
