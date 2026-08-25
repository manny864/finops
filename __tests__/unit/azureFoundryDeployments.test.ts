import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAzureCredential, getSubscriptionsForTenant, resources } = vi.hoisted(() => ({
  getAzureCredential: vi.fn(),
  getSubscriptionsForTenant: vi.fn(),
  resources: vi.fn(),
}));

vi.mock("@/lib/azure", () => ({
  getAzureCredential,
  getSubscriptionsForTenant,
}));

vi.mock("@azure/arm-resourcegraph", () => ({
  ResourceGraphClient: class {
    resources = resources;
  },
}));

vi.mock("@/modules/storage/db", () => ({
  default: { query: vi.fn().mockResolvedValue([[]]) },
}));

import { getAzureFoundryDeployments } from "@/modules/collectors/azure/foundryCollector";

describe("Azure AI Foundry Live Model Deployments Discovery", () => {
  beforeEach(() => {
    getAzureCredential.mockReset().mockResolvedValue({});
    getSubscriptionsForTenant.mockReset().mockResolvedValue(["sub-test-123"]);
    resources.mockReset();
  });

  it("should fetch all live model deployments directly from Azure Resource Graph", async () => {
    resources.mockResolvedValueOnce({
      data: [
        {
          id: "/subscriptions/sub-test-123/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/foundry-hub/deployments/gpt-5.6-sol",
          name: "gpt-5.6-sol",
          resourceGroup: "rg-ai",
          subscriptionId: "sub-test-123",
          location: "eastus2",
          modelName: "gpt-5.6-sol",
          modelVersion: "2024-12-01",
          modelFormat: "OpenAI",
          skuName: "Standard",
          capacity: 10,
        },
        {
          id: "/subscriptions/sub-test-123/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/foundry-hub/deployments/gpt-5.6-terra",
          name: "gpt-5.6-terra",
          resourceGroup: "rg-ai",
          subscriptionId: "sub-test-123",
          location: "eastus2",
          modelName: "gpt-5.6-terra",
          modelVersion: "2024-12-01",
          modelFormat: "OpenAI",
          skuName: "Standard",
          capacity: 20,
        },
        {
          id: "/subscriptions/sub-test-123/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/foundry-hub/deployments/gpt-5.3-codex",
          name: "gpt-5.3-codex",
          resourceGroup: "rg-ai",
          subscriptionId: "sub-test-123",
          location: "eastus2",
          modelName: "gpt-5.3-codex",
          modelVersion: "2024-11-01",
          modelFormat: "OpenAI",
          skuName: "Standard",
          capacity: 15,
        },
      ],
    });

    const deployments = await getAzureFoundryDeployments("tenant-test-123");

    expect(deployments).toHaveLength(3);
    expect(deployments[0].modelName).toBe("gpt-5.6-sol");
    expect(deployments[0].accountName).toBe("foundry-hub");
    expect(deployments[1].modelName).toBe("gpt-5.6-terra");
    expect(deployments[2].modelName).toBe("gpt-5.3-codex");
  });
});
