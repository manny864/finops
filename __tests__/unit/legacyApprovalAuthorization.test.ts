// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  role: vi.fn(), tier: vi.fn(), row: vi.fn(), claim: vi.fn(), execute: vi.fn(),
  resolve: vi.fn(), pending: vi.fn(), reconcile: vi.fn(), scopes: vi.fn(), log: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: {}, initializeDatabase: vi.fn() }));
vi.mock("@/lib/requestAuth", () => ({
  AuthError: class extends Error { status = 403; },
  requireTenantRole: mocks.role, requireTenantTier: mocks.tier,
  requireRequestIdentity: vi.fn(), requireTenantAccess: vi.fn(),
}));
vi.mock("@/lib/lighthouseAccess", () => ({ bloqueoPorDelegacionDeLectura: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirScopesDelTenant: mocks.scopes }));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false }));
vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn() }));
vi.mock("@/lib/azureSubscriptionNames", () => ({ getSubscriptionNameMap: vi.fn() }));
vi.mock("@/services/remediationService", () => ({ logAction: mocks.log }));
vi.mock("@/lib/notifications", () => ({ notifyTenant: mocks.notify }));
vi.mock("@/services/azureRemediationApprovals.service", () => ({
  assembleLiveApprovals: vi.fn(), getMockApprovalsPayload: vi.fn(), listApprovals: vi.fn(),
  mapHistoryRow: vi.fn(), mapPendingRow: (row: object) => row,
  statusFromDb: (status: string) => status.toUpperCase(),
  getApprovalById: mocks.row, claimApprovalExecution: mocks.claim,
  executeApprovedAction: mocks.execute, resolveApproval: mocks.resolve,
  recordPendingApprovalExecution: mocks.pending,
  reconcileApprovalExecution: mocks.reconcile,
}));
import { AuthError } from "@/lib/requestAuth";
import { PATCH } from "@/app/api/remediation/workflow/route";
import { POST } from "@/app/api/governance/approvals/route";

const item = {
  id: "7", status: "Pending", requestedBy: "requester@example.test",
  resourceId: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/disks/disk",
  resourceType: "Microsoft.Compute/disks", resourceName: "disk", subscriptionId: "sub", resourceGroup: "rg",
  actionType: "DELETE_RESOURCE",
};
const request = (body: object) => new NextRequest("https://app.example.test/api/remediation/workflow", {
  method: "PATCH", body: JSON.stringify(body), headers: { authorization: "Bearer test" },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue({ email: "admin@example.test" });
  mocks.row.mockResolvedValue(item);
  mocks.claim.mockResolvedValue("claim-token");
  mocks.execute.mockResolvedValue({ status: "Succeeded", detail: "done" });
  mocks.resolve.mockResolvedValue(true);
  mocks.pending.mockResolvedValue(true);
  mocks.reconcile.mockResolvedValue({ status: "Running", detail: "Still running" });
  mocks.notify.mockResolvedValue(undefined);
});
describe("canonical resolution on legacy and current routes", () => {
  it("legacy Reader is denied by canonical role guard before lookup/ARM", async () => {
    mocks.role.mockRejectedValue(new AuthError("Forbidden", 403));
    expect((await PATCH(request({ id: 7, status: "Approved", tenantId: "tenant-a" }))).status).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith(expect.anything(), "tenant-a", ["Owner", "Admin"]);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.row).not.toHaveBeenCalled();
  });
  it("legacy cannot self-approve, including casing and whitespace", async () => {
    mocks.role.mockResolvedValue({ email: " REQUESTER@example.test " });
    expect((await PATCH(request({ id: 7, status: "Approved", tenantId: "tenant-a" }))).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("legacy rejection requires a reason and never executes ARM", async () => {
    expect((await PATCH(request({ id: 7, status: "Rejected", tenantId: "tenant-a" }))).status).toBe(400);
    expect((await PATCH(request({ id: 7, status: "Rejected", tenantId: "tenant-a", rejectionReason: "Not safe" }))).status).toBe(200);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("missing object in target tenant cannot be approved", async () => {
    mocks.row.mockResolvedValue(null);
    expect((await PATCH(request({ id: 7, status: "Approved", tenantId: "other-tenant" }))).status).toBe(404);
    expect(mocks.row).toHaveBeenCalledWith("other-tenant", "7");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("a losing concurrent approval never executes ARM", async () => {
    mocks.claim.mockResolvedValue(null);
    expect((await POST(request({ approvalId: 7, decision: "APPROVE", tenantId: "tenant-a" }))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("executes only after scope validation and claim; persists ownership", async () => {
    expect((await PATCH(request({ id: 7, status: "Approved", tenantId: "tenant-a" }))).status).toBe(200);
    expect(mocks.scopes.mock.invocationCallOrder[0]).toBeLessThan(mocks.claim.mock.invocationCallOrder[0]);
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[0]);
    expect(mocks.resolve).toHaveBeenCalledWith("tenant-a", "7", "APPROVED", "admin@example.test",
      expect.objectContaining({ executionToken: "claim-token" }));
  });
  it("persists pending ARM evidence with its original claim instead of resolving or retrying", async () => {
    const pending = { status: "Running", detail: "Azure accepted", operation: { stage: "action", pollingUrl: "https://management.azure.com/operation" } };
    mocks.execute.mockResolvedValue(pending);
    const response = await POST(request({ approvalId: 7, decision: "APPROVE", tenantId: "tenant-a" }));
    expect(response.status).toBe(202);
    expect(mocks.pending).toHaveBeenCalledWith("tenant-a", "7", "claim-token", pending);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ success: false, armExecutionStatus: "Running" });
  });
  it("does not announce accepted persistence when pending result loses ownership", async () => {
    mocks.execute.mockResolvedValue({ status: "Running", detail: "Azure accepted" });
    mocks.pending.mockResolvedValue(false);
    expect((await POST(request({ approvalId: 7, decision: "APPROVE", tenantId: "tenant-a" }))).status).toBe(409);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("reconciliation requires the same Admin/Owner and tier guards but never submits a mutation", async () => {
    const response = await POST(request({ approvalId: 7, decision: "RECONCILE", tenantId: "tenant-a" }));
    expect(response.status).toBe(202);
    expect(mocks.role).toHaveBeenCalledWith(expect.anything(), "tenant-a", ["Owner", "Admin"]);
    expect(mocks.tier).toHaveBeenCalledWith(expect.anything(), "tenant-a", "Business");
    expect(mocks.reconcile).toHaveBeenCalledWith("tenant-a", "7");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    mocks.role.mockRejectedValue(new AuthError("Forbidden", 403));
    expect((await POST(request({ approvalId: 7, decision: "RECONCILE", tenantId: "tenant-a" }))).status).toBe(403);
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });
});
