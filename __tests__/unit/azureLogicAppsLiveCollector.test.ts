import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAzureCredential, getSubscriptionsForTenant, resourcesMock, monitorListMock, costUsageMock, dbQueryMock } = vi.hoisted(() => ({
  getAzureCredential: vi.fn(),
  getSubscriptionsForTenant: vi.fn(),
  resourcesMock: vi.fn(),
  monitorListMock: vi.fn(),
  costUsageMock: vi.fn(),
  dbQueryMock: vi.fn(),
}));

vi.mock("@/lib/azure", () => ({
  getAzureCredential,
  getSubscriptionsForTenant,
}));

vi.mock("@azure/arm-resourcegraph", () => ({
  ResourceGraphClient: class {
    resources = resourcesMock;
  },
}));

vi.mock("@azure/arm-monitor", () => ({
  MonitorClient: class {
    metrics = {
      list: monitorListMock,
    };
  },
}));

vi.mock("@azure/arm-costmanagement", () => ({
  CostManagementClient: class {
    query = {
      usage: costUsageMock,
    };
  },
}));

vi.mock("@/modules/storage/db", () => ({
  default: {
    query: dbQueryMock,
  },
}));

import { getLiveLogicAppsData } from "@/services/azureLogicApps.service";

describe("Azure Logic Apps Live Collector", () => {
  beforeEach(() => {
    getAzureCredential.mockReset().mockResolvedValue({});
    getSubscriptionsForTenant.mockReset().mockResolvedValue(["sub-123"]);
    resourcesMock.mockReset();
    monitorListMock.mockReset();
    costUsageMock.mockReset();
    dbQueryMock.mockReset();
  });

  it("should discover workflows, enrich with real costs, monitor runs and 30-day dailyTrend", async () => {
    resourcesMock.mockResolvedValueOnce({
      data: [
        {
          id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Logic/workflows/la-backup-alerts",
          name: "la-backup-alerts",
          type: "microsoft.logic/workflows",
          location: "westus2",
          resourceGroup: "rg-prod",
          subscriptionId: "sub-123",
          properties: {
            state: "Enabled",
            provisioningState: "Succeeded",
            definition: {
              triggers: {
                manual: {
                  type: "Request",
                  inputs: {
                    host: {
                      connection: { name: "shared_azureblob" },
                    },
                  },
                },
              },
              actions: {
                send_email: {
                  type: "ApiConnection",
                  inputs: {
                    host: {
                      api: { name: "office365" },
                    },
                  },
                },
              },
            },
          },
        },
        {
          id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Web/sites/la-std-workflow-app",
          name: "la-std-workflow-app",
          type: "microsoft.web/sites",
          kind: "functionapp,workflowapp",
          location: "eastus2",
          resourceGroup: "rg-prod",
          subscriptionId: "sub-123",
          sku: { name: "WS1" },
          properties: {
            state: "Enabled",
            provisioningState: "Succeeded",
          },
        },
      ],
    });

    monitorListMock.mockResolvedValue({
      value: [
        {
          name: { value: "RunsStarted" },
          timeseries: [{ data: [{ total: 1250 }] }],
        },
        {
          name: { value: "RunsFailed" },
          timeseries: [{ data: [{ total: 12 }] }],
        },
        {
          name: { value: "BillableActionExecutions" },
          timeseries: [{ data: [{ total: 25000 }] }],
        },
      ],
    });

    costUsageMock.mockResolvedValue({
      rows: [
        [
          "14.50",
          "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Logic/workflows/la-backup-alerts",
        ],
      ],
    });

    dbQueryMock.mockImplementation((queryText: string) => {
      if (queryText.includes("CostSnapshots")) {
        return Promise.resolve([
          [
            {
              resource_id:
                "/subscriptions/sub-123/resourcegroups/rg-prod/providers/microsoft.logic/workflows/la-backup-alerts",
              cost_mtd: 14.5,
              cost_prev: 12.0,
            },
          ],
        ]);
      }
      return Promise.resolve([[]]);
    });

    const result = await getLiveLogicAppsData("tenant-test-123");

    expect(result.source).toBe("live");
    expect(result.items.length).toBe(2);

    const consumptionApp = result.items.find((i) => i.name === "la-backup-alerts");
    expect(consumptionApp).toBeDefined();
    expect(consumptionApp?.planType).toBe("Consumption");
    expect(consumptionApp?.costMtdUSD).toBe(14.5);
    expect(consumptionApp?.runsStartedCount).toBe(1250);
    expect(consumptionApp?.runsFailedCount).toBe(12);
    expect(consumptionApp?.totalBillableExecutions).toBe(25000);
    expect(consumptionApp?.connectors).toContain("Azure Blob Storage");
    expect(consumptionApp?.connectors).toContain("Office 365 Outlook");

    const standardApp = result.items.find((i) => i.name === "la-std-workflow-app");
    expect(standardApp).toBeDefined();
    expect(standardApp?.planType).toBe("Standard_WS1");
    expect(standardApp?.costMtdUSD).toBe(175.0);

    // Summary metrics
    expect(result.summary.totalResourcesCount).toBe(2);
    expect(result.summary.costMtdUSD).toBe(189.5); // 14.5 + 175.0
    expect(result.summary.forecastEomUSD).toBeGreaterThan(0);

    // 30-day dailyTrend
    expect(result.dailyTrend.length).toBe(30);
    expect(result.dailyTrend.some((d) => d.runsStarted > 0)).toBe(true);
  });
});
