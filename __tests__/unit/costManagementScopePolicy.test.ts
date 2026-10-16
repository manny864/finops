// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPipelineRequest } from "@azure/core-rest-pipeline";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirScopesDelTenant: mocks.scope }));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));
import { getCostManagementClient } from "@/lib/azure";

beforeEach(() => vi.resetAllMocks());
describe("central Cost Management boundary", () => {
  const credential = { getToken: vi.fn(async () => ({ token: "synthetic", expiresOnTimestamp: Date.now() + 100_000 })) };
  it("checks the tenant on every scoped request, including next-page URLs", async () => {
    const client = await getCostManagementClient("tenant-a", credential);
    const policies = client.pipeline.getOrderedPolicies();
    expect(policies.some(policy => policy.name === "redirectPolicy")).toBe(false);
    const policy = policies.find(policy => policy.name === "tenantCostManagementScope")!;
    const next = vi.fn();
    const path = "/subscriptions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/providers/Microsoft.CostManagement/query";
    await policy.sendRequest(createPipelineRequest({ url: `https://management.azure.com${path}?$skiptoken=page2` }), next);
    expect(mocks.scope).toHaveBeenCalledWith("tenant-a", [path]);
    expect(next).toHaveBeenCalledTimes(1);
    mocks.scope.mockRejectedValue(new Error("foreign tenant"));
    await expect(policy.sendRequest(createPipelineRequest({ url: `https://management.azure.com${path}` }), next)).rejects.toThrow(/foreign/);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it("does not send pagination requests or credentials to another origin", async () => {
    const client = await getCostManagementClient("tenant-a", credential);
    const policy = client.pipeline.getOrderedPolicies().find(policy => policy.name === "tenantCostManagementScope")!;
    const next = vi.fn();
    await expect(policy.sendRequest(createPipelineRequest({ url: "https://attacker.example.test/nextpage" }), next)).rejects.toThrow(/untrusted/);
    expect(next).not.toHaveBeenCalled();
  });
  it("the actual SDK pipeline rejects foreign scope before requesting a token", async () => {
    const client = await getCostManagementClient("tenant-a", credential);
    mocks.scope.mockRejectedValue(new Error("foreign tenant"));
    await expect(client.query.usage("/subscriptions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
      type: "ActualCost", timeframe: "MonthToDate", dataset: { granularity: "None" },
    })).rejects.toThrow(/foreign/);
    expect(credential.getToken).not.toHaveBeenCalled();
  });
  it("has no direct SDK constructors outside the guarded factory", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);
    const bypasses = walk("src").filter(file => file !== "src/lib/azure.ts"
      && /new\s+CostManagementClient\s*\(/.test(readFileSync(file, "utf8")));
    expect(bypasses).toEqual([]);
  });
});
