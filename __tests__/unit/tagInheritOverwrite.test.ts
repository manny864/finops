import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { applyMock, saveCacheMock, argMock } = vi.hoisted(() => ({
    applyMock: vi.fn(),
    saveCacheMock: vi.fn(async () => {}),
    argMock: vi.fn(),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1" })),
    requireTenantTier: vi.fn(async () => {}),
    AuthError: class AuthError extends Error {
        status = 403;
    },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo_tenant" }));
vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn(async () => ({})) }));
vi.mock("@/services/azureTagGovernance.service", () => ({ saveLocalCachedTags: saveCacheMock }));
vi.mock("@/services/tagInheritanceService", () => ({ applyTagInheritance: applyMock }));
vi.mock("@azure/arm-resourcegraph", () => ({
    ResourceGraphClient: class {
        resources = argMock;
    },
}));

import { POST } from "@/app/api/governance/tags/inherit-rg/route";

const RG = "/subscriptions/sub-1/resourceGroups/rg-prod";

const call = (overwriteExisting?: boolean) =>
    POST(new NextRequest("http://localhost/api/governance/tags/inherit-rg?tenantId=t1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            resourceGroupId: RG,
            rgTags: { Environment: "prod", CostCenter: "FIN" },
            ...(overwriteExisting === undefined ? {} : { overwriteExisting }),
        }),
    }));

beforeEach(() => {
    applyMock.mockReset().mockImplementation(async (_c: unknown, ops: any[]) =>
        ops.map((o) => ({ resourceId: o.resourceId, success: true })));
    saveCacheMock.mockReset();
    // El hijo YA tiene Environment con un valor propio distinto al del RG, y le
    // falta CostCenter: el caso que distingue los dos modos.
    argMock.mockReset().mockResolvedValue({
        data: [{ id: "/subscriptions/sub-1/rg/child1", tags: { Environment: "dev" } }],
    });
});

describe("POST tags/inherit-rg — sobrescribir valores existentes", () => {
    it("por defecto NO pisa el valor propio del hijo, sólo inyecta el que falta", async () => {
        await call();

        const [, ops] = applyMock.mock.calls[0];
        expect(ops[0].tagsToMerge).toEqual({ CostCenter: "FIN" });
        // Environment queda en 'dev': es lo que promete la Política de Merge Seguro.
        expect(ops[0].tagsToMerge.Environment).toBeUndefined();
    });

    it("con overwriteExisting el valor del RG reemplaza al del hijo", async () => {
        await call(true);

        const [, ops] = applyMock.mock.calls[0];
        expect(ops[0].tagsToMerge).toEqual({ Environment: "prod", CostCenter: "FIN" });
    });

    it("la caché refleja el resultado del modo elegido", async () => {
        await call(true);
        expect(saveCacheMock).toHaveBeenCalledWith("t1", "/subscriptions/sub-1/rg/child1", {
            Environment: "prod",
            CostCenter: "FIN",
        });
    });

    it("un valor idéntico no genera trabajo aunque se pida sobrescribir", async () => {
        argMock.mockResolvedValue({
            data: [{ id: "/c1", tags: { Environment: "prod", CostCenter: "FIN" } }],
        });

        const res = await call(true);
        const json = await res.json();

        // Nada que cambiar: no se manda ninguna operación a ARM.
        expect(applyMock).toHaveBeenCalledWith(expect.anything(), []);
        expect(json.inheritedCount).toBe(0);
    });

    it("un payload sin el flag se trata como NO sobrescribir (default seguro)", async () => {
        await call(undefined);
        const [, ops] = applyMock.mock.calls[0];
        expect(ops[0].tagsToMerge).toEqual({ CostCenter: "FIN" });
    });
});
