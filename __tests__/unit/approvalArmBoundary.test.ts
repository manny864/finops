// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingApprovalItem } from "@/types/azureRemediationApprovals.types";
const mocks = vi.hoisted(() => ({ scopes: vi.fn(), permission: vi.fn(), credential: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirScopesDelTenant: mocks.scopes }));
vi.mock("@/lib/lighthouseAccess", () => ({ tenantPuedeEscribirEnAzure: mocks.permission }));
vi.mock("@/lib/azure", () => ({ getAzureCredential: mocks.credential }));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));
import { executeApprovedAction, normalizeActionType } from "@/services/azureRemediationApprovals.service";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const item: PendingApprovalItem = {
  id: "1", subscriptionId, resourceGroup: "rg-a", resourceName: "disk-a",
  resourceType: "Microsoft.Compute/disks", resourceTypeDisplay: "Disk", subscriptionName: "A",
  resourceId: `/subscriptions/${subscriptionId}/resourceGroups/rg-a/providers/Microsoft.Compute/disks/disk-a`,
  actionType: "DELETE_RESOURCE", requestedBy: "requester@example.test", requestedAt: "",
  monthlySavingsUSD: 1, isDestructive: true, requiresReboot: false, canSnapshot: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopes.mockResolvedValue(undefined);
  mocks.permission.mockResolvedValue({ puede: true });
  mocks.credential.mockResolvedValue({ getToken: async () => ({ token: "synthetic-token" }) });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => vi.unstubAllGlobals());

describe("approval execution boundary", () => {
  it.each(["", "UNKNOWN", "do_not_delete", "backup_whatever", "delete_and_recreate"])("unknown action %s never defaults to deletion", (value) => {
    expect(() => normalizeActionType(value)).toThrow(/Unsupported/);
  });
  it("rejects inconsistent target fields before requesting credentials", async () => {
    expect((await executeApprovedAction("tenant-a", { ...item, resourceName: "disk-b" })).status).toBe("Failed");
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("revalidates tenant scope inside the service", async () => {
    mocks.scopes.mockRejectedValue(new Error("foreign tenant"));
    expect((await executeApprovedAction("tenant-b", item)).status).toBe("Failed");
    expect(mocks.scopes).toHaveBeenCalledWith("tenant-b", [item.resourceId]);
    expect(mocks.credential).not.toHaveBeenCalled();
  });
  it("blocks read-only delegation inside the service", async () => {
    mocks.permission.mockResolvedValue({ puede: false });
    expect((await executeApprovedAction("tenant-a", item)).status).toBe("Failed");
    expect(mocks.credential).not.toHaveBeenCalled();
  });
  it("does not allow a VM action against a disk", async () => {
    expect((await executeApprovedAction("tenant-a", { ...item, actionType: "POWER_OFF" })).status).toBe("Failed");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not delete a resource before an async protective snapshot is complete", async () => {
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 202 }));
    const result = await executeApprovedAction("tenant-a", item, { createBackupSnapshot: true });
    expect(result.status).toBe("Running");
    expect(result.detail).toContain("NOT attempted");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].method).toBe("PUT");
  });
  it("does not report an accepted asynchronous deletion as successful", async () => {
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 202 }));
    expect((await executeApprovedAction("tenant-a", item)).status).toBe("Running");
  });
  it("executes a validated synchronous deletion without following redirects", async () => {
    expect((await executeApprovedAction("tenant-a", item)).status).toBe("Succeeded");
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: "DELETE", redirect: "error" });
  });
});
