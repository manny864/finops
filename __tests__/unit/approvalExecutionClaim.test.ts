// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query } }));
vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn() }));
import { claimApprovalExecution, recordPendingApprovalExecution, resolveApproval } from "@/services/azureRemediationApprovals.service";

beforeEach(() => query.mockReset());

describe("durable approval ownership before ARM", () => {
  it("only one concurrent caller can claim the pending operation", async () => {
    let claimed = false;
    query.mockImplementation(async () => {
      const affectedRows = claimed ? 0 : 1;
      claimed = true;
      return [{ affectedRows }];
    });
    const results = await Promise.all([
      claimApprovalExecution("tenant-a", "1", "admin@example.test", { id: "1", resource_id: "/resource" }),
      claimApprovalExecution("tenant-a", "1", "other@example.test", { id: "1", resource_id: "/resource" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [sql, args] = query.mock.calls[0];
    expect(sql).toContain("arm_execution_result_json IS NULL");
    expect(sql).toContain("LOWER(TRIM(requested_by)) <> LOWER(TRIM(?))");
    expect(sql).toContain("action_payload_json <=> CAST(? AS JSON)");
    expect(args.slice(1, 4)).toEqual(["1", "tenant-a", "admin@example.test"]);
    expect(JSON.parse(args[0])).toMatchObject({ status: "Running", executionToken: results[0] });
  });
  it("completion requires the matching execution token; rejection cannot steal a running claim", async () => {
    query.mockResolvedValue([{ affectedRows: 0 }]);
    expect(await resolveApproval("tenant-a", "1", "REJECTED", "admin@example.test")).toBe(false);
    expect(query.mock.calls[0][1].at(-1)).toBeNull();
    await resolveApproval("tenant-a", "1", "APPROVED", "admin@example.test", {
      executionToken: "owned-token", armResult: { status: "Succeeded", detail: "done" },
    });
    expect(query.mock.calls[1][0]).toContain("'$.executionToken'");
    expect(query.mock.calls[1][1].at(-1)).toBe("owned-token");
  });
  it("pending evidence cannot replace another tenant or token's claim", async () => {
    query.mockResolvedValue([{ affectedRows: 0 }]);
    const result = { status: "Running" as const, detail: "Accepted", operation: { stage: "snapshot" as const, pollingUrl: "https://management.azure.com/operation" } };
    expect(await recordPendingApprovalExecution("tenant-b", "1", "wrong-token", result)).toBe(false);
    const [sql, args] = query.mock.calls[0];
    expect(sql).toContain("JSON_SET(arm_execution_result_json");
    expect(sql).toContain("tenant_id = ?");
    expect(sql).toContain("'$.executionToken'");
    expect(args).toEqual(["Accepted", JSON.stringify(result.operation), null, "1", "tenant-b", "wrong-token"]);
    await expect(recordPendingApprovalExecution("tenant-a", "1", "owned-token", { status: "Succeeded", detail: "Done" })).rejects.toThrow(/Only a running/);
  });
});
