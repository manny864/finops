// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), scopes: vi.fn(), credential: vi.fn(), fetch: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: mocks.query } }));
vi.mock("@/lib/azure", () => ({ getAzureCredential: mocks.credential }));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirScopesDelTenant: mocks.scopes }));
import { mapPendingRow, reconcileApprovalExecution } from "@/services/azureRemediationApprovals.service";
const subscriptionId = "11111111-1111-4111-8111-111111111111";
const pollingUrl = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/eastus/operations/op-1?api-version=2023-01-02`;
const claim = {
  status: "Running", executionToken: "owned-token", resolvedBy: "original-approver@example.test",
  operation: { stage: "action", pollingUrl },
};
const row = {
  id: 7, status: "Pending", resource_id: `/subscriptions/${subscriptionId}/resourceGroups/rg/providers/Microsoft.Compute/disks/disk-a`,
  subscription_id: subscriptionId, resource_group: "rg", resource_type: "Microsoft.Compute/disks",
  resource_name: "disk-a", action_type: "DELETE_RESOURCE", requested_by: "requester@example.test",
  arm_execution_result_json: claim,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValueOnce([[row]]).mockResolvedValue([{ affectedRows: 1 }]);
  mocks.scopes.mockResolvedValue(undefined);
  mocks.credential.mockResolvedValue({ getToken: async () => ({ token: "synthetic" }) });
  mocks.fetch.mockResolvedValue(Response.json({ status: "Succeeded" }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe("read-only ARM reconciliation", () => {
  it("finalizes only the claimed operation, retaining the original approver", async () => {
    expect((await reconcileApprovalExecution("tenant-a", "7")).status).toBe("Succeeded");
    expect(mocks.query.mock.calls[0][1]).toEqual(["tenant-a", "7"]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]).toEqual([pollingUrl, expect.objectContaining({ method: "GET", redirect: "error" })]);
    const [, args] = mocks.query.mock.calls[1];
    expect(args[0]).toBe("Approved");
    expect(args[1]).toBe(claim.resolvedBy);
    expect(args.slice(-3)).toEqual(["7", "tenant-a", claim.executionToken]);
  });
  it("does not expose claim tokens or polling references in pending DTOs", () => {
    const dto = mapPendingRow(row);
    expect(dto.armExecutionStatus).toBe("Running");
    expect(JSON.stringify(dto)).not.toContain("owned-token");
    expect(JSON.stringify(dto)).not.toContain(pollingUrl);
  });
  it.each(["Failed", "Canceled", "Cancelled"])("records terminal %s without repeating the action", async status => {
    mocks.fetch.mockResolvedValue(Response.json({ status }));
    expect((await reconcileApprovalExecution("tenant-a", "7")).status).toBe("Failed");
    expect(mocks.query.mock.calls[1][1][0]).toBe("Failed");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("a completed snapshot never triggers deletion or claims that deletion succeeded", async () => {
    mocks.query.mockReset().mockResolvedValueOnce([[{
      ...row, arm_execution_result_json: { ...claim, operation: { ...claim.operation, stage: "snapshot" } },
    }]]).mockResolvedValue([{ affectedRows: 1 }]);
    const result = await reconcileApprovalExecution("tenant-a", "7");
    expect(result).toMatchObject({ status: "Failed", detail: expect.stringContaining("NOT attempted") });
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });
  it("nonterminal operations retain their durable ownership", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ status: "InProgress" }));
    expect((await reconcileApprovalExecution("tenant-a", "7")).status).toBe("Running");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { status: null }, { properties: { provisioningState: "Succeeded" } }])("requires explicit operation status, not a resource-shaped fallback: %j", async body => {
    mocks.fetch.mockResolvedValue(Response.json(body));
    await expect(reconcileApprovalExecution("tenant-a", "7")).rejects.toThrow(/explicit operation status/);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("transport or redirected polling errors retain the original claim", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(reconcileApprovalExecution("tenant-a", "7")).rejects.toThrow("fetch failed");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("invalid polling JSON does not finalize the request", async () => {
    mocks.fetch.mockResolvedValue(new Response("{invalid"));
    await expect(reconcileApprovalExecution("tenant-a", "7")).rejects.toThrow();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it.each([404, 429, 500])("polling HTTP %i never releases the mutation claim", async status => {
    mocks.fetch.mockResolvedValue(new Response(null, { status }));
    await expect(reconcileApprovalExecution("tenant-a", "7")).rejects.toThrow(/original claim is retained/);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("missing polling evidence after interruption requires manual review, not a retry", async () => {
    mocks.query.mockReset().mockResolvedValueOnce([[{ ...row, arm_execution_result_json: { ...claim, operation: null } }]]);
    expect(await reconcileApprovalExecution("tenant-a", "7")).toMatchObject({ status: "Running", detail: expect.stringContaining("activity logs") });
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([
    pollingUrl.replace("https:", "http:"),
    pollingUrl.replace("management.azure.com", "management.azure.com.evil.test"),
    pollingUrl.replace(subscriptionId, "22222222-2222-4222-8222-222222222222"),
    pollingUrl.replace("Microsoft.Compute", "Microsoft.Storage"),
    `${pollingUrl}#fragment`,
    pollingUrl.replace("https://", "https://user@"),
    `${pollingUrl}&token=untrusted`,
    pollingUrl.replace("op-1", "%2fop-1"),
    pollingUrl.replace("op-1", "../operations/op-1"),
    pollingUrl.replace("op-1", "op-\u00011"),
    `https://management.azure.com${row.resource_id}?api-version=2023-01-02`,
  ])("validates an untrusted polling reference before acquiring credentials: %s", async url => {
    mocks.query.mockReset().mockResolvedValueOnce([[{
      ...row, arm_execution_result_json: { ...claim, operation: { ...claim.operation, pollingUrl: url } },
    }]]);
    await expect(reconcileApprovalExecution("tenant-a", "7")).rejects.toThrow(/polling URL/);
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("revalidates the tenant scope before reading operation state", async () => {
    mocks.scopes.mockRejectedValue(new Error("Foreign tenant"));
    await expect(reconcileApprovalExecution("tenant-b", "7")).rejects.toThrow("Foreign tenant");
    expect(mocks.credential).not.toHaveBeenCalled();
  });
  it("does not replace a changed claim when two operators reconcile concurrently", async () => {
    mocks.query.mockReset().mockResolvedValueOnce([[row]]).mockResolvedValue([{ affectedRows: 0 }]);
    await expect(reconcileApprovalExecution("tenant-a", "7")).rejects.toThrow(/changed during reconciliation/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
