// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAzureCredential: vi.fn(),
  resources: vi.fn(),
}));

vi.mock("@/lib/azure", () => ({
  getAzureCredential: mocks.getAzureCredential,
  getResourceGraphClient: vi.fn(async () => ({ resources: mocks.resources })),
}));

import { buildTrafficAnalyticsQuery, getNetworkTrafficPilot } from "@/services/networkTrafficPilot.service";

const workspaceId = "/subscriptions/sub1/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/law-prod";
const customerId = "11111111-2222-3333-4444-555555555555";

function configuredFlowLog(name: string, resourceId = workspaceId) {
  return {
    name,
    properties: {
      enabled: true,
      flowAnalyticsConfiguration: {
        networkWatcherFlowAnalyticsConfiguration: {
          enabled: true,
          workspaceResourceId: resourceId,
        },
      },
    },
  };
}

function queryResponse(rows: unknown[][] = []) {
  return Response.json({
    tables: [{
      name: "PrimaryResult",
      columns: [
        "Source", "Destination", "SourceRegion", "DestinationRegion", "FlowType", "Bytes", "Records",
      ].map((name) => ({ name })),
      rows,
    }],
  });
}

describe("read-only Network Watcher traffic pilot", () => {
  const credential = { getToken: vi.fn(async () => ({ token: "test-token" })) };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAzureCredential.mockResolvedValue(credential);
    mocks.resources.mockResolvedValue({ data: [configuredFlowLog("flow-prod")] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("queries only configured workspaces and returns subnet/region aggregates, never IP addresses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ properties: { customerId } }))
      .mockResolvedValueOnce(queryResponse([[
        "Subnet: rg-app/vnet-prod/app",
        "Subnet: rg-data/vnet-prod/data",
        "eastus",
        "eastus",
        "IntraVNet",
        2_000_000_000,
        17,
      ]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getNetworkTrafficPilot("tenant-1", 7);

    expect(result).toMatchObject({
      status: "ready",
      configuredFlowLogs: 1,
      activeFlowLogs: 1,
      workspaceCount: 1,
      queriedWorkspaceCount: 1,
      totalObservedBytes: 2_000_000_000,
    });
    expect(result.edges[0]).toMatchObject({
      source: "Subnet: rg-app/vnet-prod/app",
      destination: "Subnet: rg-data/vnet-prod/data",
      bytes: 2_000_000_000,
      records: 17,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/query?timespan=P7D");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { query: string };
    expect(requestBody.query).not.toMatch(/\b(SrcIp|DestIp)\b/i);
    expect(requestBody.query).toContain("top 100");
  });

  it("does not call Azure Monitor when no active Traffic Analytics flow logs exist", async () => {
    mocks.resources.mockResolvedValue({ data: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getNetworkTrafficPilot("tenant-1");

    expect(result.status).toBe("not_configured");
    expect(result.days).toBe(7);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(credential.getToken).not.toHaveBeenCalled();
  });

  it("reports denied workspaces as unavailable rather than returning an empty successful result", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ properties: { customerId } }))
      .mockResolvedValueOnce(Response.json({ error: { message: "forbidden" } }, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getNetworkTrafficPilot("tenant-1");

    expect(result.status).toBe("unavailable");
    expect(result.issues).toEqual([{ workspace: "law-prod", reason: "permission_denied" }]);
  });

  it("marks missing workspace links as incomplete coverage", async () => {
    mocks.resources.mockResolvedValue({
      data: [{
        name: "flow-no-workspace",
        properties: {
          enabled: true,
          flowAnalyticsConfiguration: {
            networkWatcherFlowAnalyticsConfiguration: { enabled: true },
          },
        },
      }],
    });

    const result = await getNetworkTrafficPilot("tenant-1");

    expect(result.status).toBe("unavailable");
    expect(result.workspacesWithoutId).toBe(1);
    expect(result.issues).toEqual([{ workspace: "flow-no-workspace", reason: "workspace_unavailable" }]);
  });

  it("bounds the KQL window and omits raw IP columns", () => {
    const query = buildTrafficAnalyticsQuery(30);

    expect(query).toContain("ago(30d)");
    expect(query).not.toMatch(/\b(SrcIp|DestIp)\b/i);
  });
});
