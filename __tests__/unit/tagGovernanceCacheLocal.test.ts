// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, graphMock } = vi.hoisted(() => ({ queryMock: vi.fn(), graphMock: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/azure", () => ({ getResourceGraphClient: async () => ({ resources: graphMock }) }));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: async () => new Map(),
    resolveSubscriptionName: (id: string) => id,
}));

import { mergeLocalCachedTags, overlayCachedTags, scanTagGovernanceLive } from "@/services/azureTagGovernance.service";

const RES = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Web/sites/app1";
const RG = "/subscriptions/s1/resourceGroups/rg1";
const AZURE = { Environment: "prod", Role: "api", CostCenter: "CC-10", Department: "IT" };

beforeEach(() => {
    queryMock.mockReset();
    graphMock.mockReset();
});

describe("overlayCachedTags", () => {
    it("la caché gana en la misma clave sin distinguir mayúsculas y el resto sale de Azure", () => {
        expect(overlayCachedTags({ Role: "Web", CostCenter: "CC-10" }, { role: "frontend" }))
            .toEqual({ CostCenter: "CC-10", role: "frontend" });
    });

    it("sin fila de caché quedan los tags de Azure, o vacío si Azure no trae", () => {
        expect(overlayCachedTags({ Role: "api" })).toEqual({ Role: "api" });
        expect(overlayCachedTags(null)).toEqual({});
    });
});

describe("scanTagGovernanceLive con LocalResourceTagsCache", () => {
    /** Un recurso y su RG con los mismos tags en Azure, y las filas de caché dadas. */
    function escenario(cache: Array<{ resource_id: string; tags_json: unknown }>) {
        queryMock.mockImplementation(async (sql: string) =>
            sql.includes("FROM LocalResourceTagsCache") ? [cache] : [[]]);
        graphMock.mockImplementation(async ({ query }: { query: string }) => {
            if (query.includes("summarize")) return { data: [] };
            if (query.includes("resourcecontainers")) {
                return { data: [{ id: RG, name: "rg1", subscriptionId: "s1", location: "eastus", tags: AZURE }] };
            }
            return {
                data: [{
                    id: RES, name: "app1", type: "Microsoft.Web/sites", subscriptionId: "s1",
                    resourceGroup: "rg1", location: "eastus", tags: AZURE,
                }],
            };
        });
    }

    // cleanup/ttl y backup-orphans escriben filas parciales sin tocar ARM.
    it("una fila de TTL no esconde los tags de Azure, en recursos ni en RGs", async () => {
        const ttl = JSON.stringify({ ExpireOn: "2026-12-01T00:00:00.000Z", TTL: "7d" });
        escenario([
            { resource_id: RES.toLowerCase(), tags_json: ttl },
            { resource_id: RG, tags_json: { PurgeStatus: "Requested" } },
        ]);

        const r = await scanTagGovernanceLive({} as never, ["s1"], "t1");

        expect(r.resources[0]).toMatchObject({
            complianceStatus: "COMPLIANT",
            missingTags: [],
            currentTags: { ...AZURE, ExpireOn: "2026-12-01T00:00:00.000Z", TTL: "7d" },
        });
        expect(r.resourceGroups[0]).toMatchObject({
            complianceStatus: "COMPLIANT",
            missingTags: [],
            currentTags: { ...AZURE, PurgeStatus: "Requested" },
        });
        expect(r.overallCompliancePercentage).toBe(100);
    });

    it("la caché gana sobre Azure en la misma clave, sin distinguir mayúsculas", async () => {
        escenario([{ resource_id: RES, tags_json: { role: "Web" } }]);

        const r = await scanTagGovernanceLive({} as never, ["s1"], "t1");

        expect(r.resources[0].currentTags).toEqual({ Environment: "prod", CostCenter: "CC-10", Department: "IT", role: "Web" });
        expect(r.resources[0].invalidTags).toMatchObject([{ tagName: "Role", tagKey: "role", value: "Web" }]);
        expect(r.resourceGroups[0].currentTags).toEqual(AZURE);
    });
});

describe("mergeLocalCachedTags", () => {
    it("reemplaza sin distinguir mayúsculas las claves aplicadas en las filas que existen y no inserta", async () => {
        queryMock.mockImplementation(async (sql: string) =>
            sql.startsWith("SELECT")
                ? [[{ id: "c1", resource_id: RES.toLowerCase(), tags_json: JSON.stringify({ role: "Web", ExpireOn: "2026-12-01" }) }]]
                : [{ affectedRows: 1 }]);

        await mergeLocalCachedTags("t1", [
            { resourceId: RES, tags: { Role: "frontend" } },
            { resourceId: "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Web/sites/sin-fila", tags: { Role: "api" } },
        ]);

        const [select, update, ...resto] = queryMock.mock.calls;
        expect(select[0]).toMatch(/WHERE tenant_id = \? AND resource_id IN \(\?\)/);
        expect(select[1]).toEqual(["t1", [RES, "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Web/sites/sin-fila"]]);
        expect(update[0]).toMatch(/^UPDATE LocalResourceTagsCache/);
        expect(update[1]).toEqual([JSON.stringify({ ExpireOn: "2026-12-01", Role: "frontend" }), "c1", "t1"]);
        expect(resto).toEqual([]);
        expect(queryMock.mock.calls.some(([sql]) => /INSERT/i.test(sql))).toBe(false);
    });

    it("sin cambios no consulta la base", async () => {
        await mergeLocalCachedTags("t1", []);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("si la base falla avisa y no corta: Azure ya aceptó el cambio", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        queryMock.mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

        await expect(mergeLocalCachedTags("t1", [{ resourceId: RES, tags: { Role: "api" } }])).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
