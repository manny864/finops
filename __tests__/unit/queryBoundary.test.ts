// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TtlResourceType } from "@/services/ttlService";
const mocks = vi.hoisted(() => ({ query: vi.fn(), resources: vi.fn(), credential: vi.fn(), graph: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: mocks.query } }));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: mocks.credential, getResourceGraphClient: mocks.graph,
    getSubscriptionsForTenant: async () => ["11111111-1111-4111-8111-111111111111"],
    listTenantSubscriptions: async () => [],
}));
import { escapeKql } from "@/lib/kql";
import { searchLiveResources } from "@/services/azureResourcesInventory.service";
import { getExecutiveReportHistory } from "@/services/executiveReportHistory.service";
import { getUnlabeledResources } from "@/services/ttlService";
import { analyzeMissingTags } from "@/services/tagInheritanceService";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.graph.mockResolvedValue({ resources: mocks.resources });
    mocks.resources.mockResolvedValue({ data: [] });
    mocks.credential.mockResolvedValue({ getToken: async () => ({ token: "synthetic", expiresOnTimestamp: Date.now() + 1000 }) });
    mocks.query.mockResolvedValue([[]]);
});
describe("query structure boundaries", () => {
    it.each(["' | union Resources //", "\\'; print secret='x", "\n| take 999999", "a\u0000b", "O'Reilly", "\\", "\r\n\t"])(
        "KQL escaping leaves no bare quote, control or incomplete escape: %j", value => {
            const escaped = escapeKql(value);
            expect(escaped).not.toMatch(/[\x00-\x1f\x7f]/);
            for (let i = 0; i < escaped.length; i++) {
                if (escaped[i] === "\\") {
                    expect(i + 1).toBeLessThan(escaped.length);
                    i++;
                } else expect(escaped[i]).not.toBe("'");
            }
        },
    );
    it("inventory preserves apostrophes and backslashes inside literals and groups search OR", async () => {
        const injected = "rg\\' or true | union Resources //";
        await searchLiveResources("tenant-a", {
            page: 1, pageSize: 15, search: injected, resourceGroup: injected, tagKey: injected,
        });
        const query = mocks.resources.mock.calls[0][0].query;
        expect(query).toContain(`resourceGroup =~ '${escapeKql(injected)}'`);
        expect(query).toContain(`(name contains '${escapeKql(injected)}' or type contains '${escapeKql(injected)}')`);
        expect(mocks.graph).toHaveBeenCalledWith("tenant-a", expect.anything());
    });
    it("SQL report filters are parameters and each query is scoped to its tenant", async () => {
        const injected = "' OR 1=1; DROP TABLE Users; --";
        for (const tenantId of ["tenant-a", "tenant-b"]) {
            await getExecutiveReportHistory({ tenantId, search: injected, scopeFilter: injected, sortBy: "cost" });
        }
        const calls = mocks.query.mock.calls.filter(([sql]) => sql.includes("ExecutiveReportJobs"));
        expect(calls.length).toBeGreaterThanOrEqual(4);
        for (const [sql, parameters] of calls) {
            expect(sql).toContain("tenant_id = ?");
            expect(sql).not.toContain(injected);
            expect(["tenant-a", "tenant-b"]).toContain(parameters[0]);
        }
        expect(calls.some(([, parameters]) => parameters.includes(injected))).toBe(true);
    });
    it("unsupported identifiers and numeric query structure are rejected at runtime", async () => {
        const params = { tenantId: "tenant-a", sortBy: "cost; DROP TABLE Users" };
        // Runtime input deliberately bypasses compile-time unions.
        await expect(Reflect.apply(getExecutiveReportHistory, null, [params])).rejects.toThrow(/Unsupported/);
        await expect(getUnlabeledResources("tenant-a", "evil' | union Resources" as TtlResourceType)).rejects.toThrow(/Unsupported/);
        await expect(analyzeMissingTags("tenant-a", { getToken: async () => null }, "All", { limit: Infinity })).rejects.toThrow(/limit/);
        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.graph).not.toHaveBeenCalled();
    });
});
