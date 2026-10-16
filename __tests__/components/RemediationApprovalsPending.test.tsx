import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PendingApprovalItem } from "@/types/azureRemediationApprovals.types";
const mocks = vi.hoisted(() => ({
  pending: [] as PendingApprovalItem[], mutate: vi.fn(), fetch: vi.fn(),
  info: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock("next-intl", async importOriginal => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { readFileSync } = await import("node:fs");
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  return { ...actual, useLocale: () => "en", useTranslations: (namespace: string) => actual.createTranslator({ locale: "en", messages: en, namespace }) };
});
vi.mock("swr", () => ({
  default: () => ({
    data: { source: "live", summary: { pendingRequests: mocks.pending, history: [] } },
    isValidating: false, mutate: mocks.mutate,
  }),
}));
vi.mock("@/components/TenantProvider", () => ({ useTenant: () => ({ selectedTenant: { id: "tenant-a" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));
vi.mock("sonner", () => ({ toast: { info: mocks.info, success: mocks.success, error: mocks.error } }));
vi.mock("@/components/InfoTooltip", () => ({ default: () => null }));
vi.mock("@/components/Pagination", () => ({ default: () => null, usePagination: (items: unknown[]) => ({ paged: items }) }));
import RemediationApprovalsPanel from "@/components/governance/RemediationApprovalsPanel";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = [{
    id: "7", resourceId: "/resource", resourceName: "disk-a", resourceType: "Microsoft.Compute/disks",
    resourceTypeDisplay: "Disk", subscriptionName: "A", resourceGroup: "rg", subscriptionId: "sub",
    actionType: "CHANGE_TIER", requestedBy: "requester@example.test", requestedAt: "",
    monthlySavingsUSD: 1, requiresReboot: false, isDestructive: false, canSnapshot: false,
    armExecutionStatus: "Running",
  }];
  mocks.fetch.mockResolvedValue(Response.json({ success: false, status: "PENDING", armExecutionStatus: "Running" }, { status: 202 }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("pending ARM execution is not a successful action", () => {
  it("offers read-only reconciliation instead of approve/reject or bulk retry", async () => {
    render(<RemediationApprovalsPanel />);
    expect(screen.queryByRole("button", { name: "Approve & Execute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject", exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: /Approve all safe/i }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check execution" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ tenantId: "tenant-a", approvalId: "7", decision: "RECONCILE" });
    await waitFor(() => expect(mocks.info).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Check execution" })).toBeTruthy();
  });
  it("an initial 202 approval shows an informational notice and marks the cached card Running", async () => {
    mocks.pending = mocks.pending.map(p => ({ ...p, armExecutionStatus: undefined }));
    render(<RemediationApprovalsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Approve & Execute" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Approve & Execute" }).at(-1)!);
    await waitFor(() => expect(mocks.info).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
    const updater = mocks.mutate.mock.calls.find(([arg]) => typeof arg === "function")?.[0];
    expect(updater).toBeTypeOf("function");
    expect(updater({ summary: { pendingRequests: mocks.pending } }).summary.pendingRequests[0].armExecutionStatus).toBe("Running");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).decision).toBe("APPROVE");
  });
});
