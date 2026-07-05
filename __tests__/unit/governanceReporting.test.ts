import { describe, it, expect, beforeEach, vi } from "vitest";

const rgData: any[][] = [];
let rgCall = 0;
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn().mockResolvedValue({ getToken: vi.fn().mockResolvedValue({ token: "tok" }) }),
    getSubscriptionsForTenant: vi.fn().mockResolvedValue(["sub-1"]),
}));
vi.mock("@azure/arm-resourcegraph", () => ({
    ResourceGraphClient: class {
        resources() { return Promise.resolve({ data: rgData[rgCall++] ?? [] }); }
    },
}));

import { getGovernanceReport } from "@/services/governanceReportingService";

describe("governanceReportingService", () => {
    beforeEach(() => { rgData.length = 0; rgCall = 0; vi.stubGlobal("fetch", vi.fn()); });

    it("compone inventario + identidades + policy compliance", async () => {
        // Orden de queries: byType, byLocation, total, identities
        rgData.push(
            [{ type: "microsoft.compute/virtualmachines", count_: 8 }, { type: "microsoft.storage/storageaccounts", count_: 25 }],
            [{ location: "eastus", count_: 20 }],
            [{ count_: 376 }],
            [{ pType: "User", count_: 110 }, { pType: "ServicePrincipal", count_: 106 }],
        );
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ value: [{ results: { nonCompliantResources: 122, nonCompliantPolicies: 13 }, policyAssignments: new Array(32) }] }),
        });

        const r = await getGovernanceReport("t1");

        expect(r.resourceInventory.total).toBe(376);
        expect(r.resourceInventory.byType[1]).toEqual({ type: "microsoft.storage/storageaccounts", count: 25 });
        expect(r.identities.totalAssignments).toBe(216);
        expect(r.identities.byPrincipalType[0]).toEqual({ principalType: "User", count: 110 });
        expect(r.policyCompliance).toEqual({ nonCompliantResources: 122, nonCompliantPolicies: 13, policyAssignments: 32, available: true });
    });

    it("policy available=false cuando PolicyInsights no responde OK", async () => {
        rgData.push([], [], [{ count_: 0 }], []);
        (globalThis.fetch as any).mockResolvedValue({ ok: false, json: async () => ({}) });
        const r = await getGovernanceReport("t1");
        expect(r.policyCompliance.available).toBe(false);
        expect(r.policyCompliance.nonCompliantResources).toBe(0);
    });
});
