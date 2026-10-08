// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, graphMock } = vi.hoisted(() => ({ queryMock: vi.fn(), graphMock: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/azure", () => ({ getResourceGraphClient: async () => ({ resources: graphMock }) }));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: async () => new Map(),
    resolveSubscriptionName: (id: string) => id,
}));

import {
    DEFAULT_MANDATORY_TAG_POLICIES,
    getTagValueAliases,
    getTenantTagPolicies,
    scanTagGovernanceLive,
} from "@/services/azureTagGovernance.service";

/** Responde cada query según la tabla que consulta. */
function db(tablas: { policies?: unknown[]; aliases?: unknown[]; cache?: unknown[]; fallaPolicies?: boolean }) {
    queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM TaggingPolicies")) {
            if (tablas.fallaPolicies) throw new Error("ER_BAD_FIELD_ERROR");
            return [tablas.policies || []];
        }
        if (sql.includes("FROM TagValueAliases")) return [tablas.aliases || []];
        if (sql.includes("FROM LocalResourceTagsCache")) return [tablas.cache || []];
        return [[]];
    });
}

beforeEach(() => {
    queryMock.mockReset();
    graphMock.mockReset();
});

describe("getTenantTagPolicies", () => {
    it("sin políticas propias usa las por defecto", async () => {
        db({});
        expect(await getTenantTagPolicies("t1")).toBe(DEFAULT_MANDATORY_TAG_POLICIES);
    });

    it("si la tabla no se puede leer usa las por defecto", async () => {
        db({ fallaPolicies: true });
        expect(await getTenantTagPolicies("t1")).toBe(DEFAULT_MANDATORY_TAG_POLICIES);
    });

    it("las del tenant reemplazan a las por defecto, con sus valores permitidos", async () => {
        db({
            policies: [
                { id: 1, policy_name: "Environment", is_required: 1, allowed_values: ["prod", "dev"] },
                { id: 2, policy_name: "Owner", is_required: 0, allowed_values: null },
                { id: 3, policy_name: "Role", is_required: null, allowed_values: '["api","web"]' },
            ],
        });
        const pols = await getTenantTagPolicies("t1");
        expect(queryMock.mock.calls[0][1]).toEqual(["t1"]);
        expect(pols).toEqual([
            { id: "tenant-policy-1", tagName: "Environment", isRequired: true, allowedValues: ["prod", "dev"], descriptionKey: "policyEnvironmentPurpose" },
            { id: "tenant-policy-2", tagName: "Owner", isRequired: false, allowedValues: undefined, descriptionKey: undefined },
            { id: "tenant-policy-3", tagName: "Role", isRequired: true, allowedValues: ["api", "web"], descriptionKey: "policyRoleDesc" },
        ]);
    });
});

describe("getTagValueAliases", () => {
    it("agrupa por tag en minúsculas y pide primero los del tenant", async () => {
        db({
            aliases: [
                { tag_name: "Environment", alias: "test", canonical_value: "stg" },
                { tag_name: "Environment", alias: "test", canonical_value: "qa" },
                { tag_name: "Role", alias: "db", canonical_value: "database" },
            ],
        });
        const porTag = await getTagValueAliases("t1");
        expect(String(queryMock.mock.calls[0][0])).toMatch(/ORDER BY \(tenant_id IS NULL\), id/);
        expect(porTag.get("environment")).toEqual([
            { alias: "test", canonicalValue: "stg" },
            { alias: "test", canonicalValue: "qa" },
        ]);
        expect(porTag.get("role")).toEqual([{ alias: "db", canonicalValue: "database" }]);
    });

    it("si la tabla no existe todavía devuelve vacío", async () => {
        queryMock.mockRejectedValue(new Error("ER_NO_SUCH_TABLE"));
        expect((await getTagValueAliases("t1")).size).toBe(0);
    });
});

describe("scanTagGovernanceLive con políticas del tenant", () => {
    const recurso = (name: string, tags: Record<string, string>) => ({
        id: `/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Web/sites/${name}`,
        name, type: "Microsoft.Web/sites", subscriptionId: "s1", resourceGroup: "rg1", location: "eastus", tags,
    });

    function arg(recursos: unknown[], rgs: unknown[] = []) {
        graphMock.mockImplementation(async ({ query }: { query: string }) => {
            if (query.includes("resourcecontainers")) return { data: rgs };
            if (query.includes("summarize")) return { data: [] };
            return { data: recursos };
        });
    }

    it("separa 'valor no permitido' de 'faltante' y cuenta ambos como no conformes", async () => {
        db({
            policies: [
                { id: 1, policy_name: "Environment", is_required: 1, allowed_values: ["prod", "dev"] },
                { id: 2, policy_name: "Owner", is_required: 1, allowed_values: null },
            ],
            aliases: [{ tag_name: "Environment", alias: "production", canonical_value: "prod" }],
        });
        arg(
            [
                recurso("ok", { Environment: "prod", Owner: "ana" }),
                recurso("mal-valor", { environment: "Production", Owner: "ana" }),
                recurso("falta", { Environment: "dev" }),
                recurso("ambos", { Environment: "desa" }),
                // CostCenter ya no es obligatoria para este tenant: no falta.
                recurso("extra", { Environment: "dev", Owner: "x", CostCenter: "" }),
            ],
            [{ id: "/subscriptions/s1/resourceGroups/rg1", name: "rg1", subscriptionId: "s1", location: "eastus", tags: { Environment: "PROD", Owner: "ops" } }],
        );

        const r = await scanTagGovernanceLive({} as never, ["s1"], "t1");
        const porNombre = Object.fromEntries(r.resources.map((x) => [x.resourceName, x]));

        expect(porNombre.ok).toMatchObject({ complianceStatus: "COMPLIANT", missingTags: [], invalidTags: [] });
        expect(porNombre["mal-valor"]).toMatchObject({
            complianceStatus: "NON_COMPLIANT",
            missingTags: [],
            invalidTags: [{
                tagName: "Environment", tagKey: "environment", value: "Production",
                suggestion: { normalized: "prod", method: "alias", confidence: 0.95 },
            }],
        });
        expect(porNombre.falta).toMatchObject({ complianceStatus: "NON_COMPLIANT", missingTags: ["Owner"], invalidTags: [] });
        expect(porNombre.ambos.missingTags).toEqual(["Owner"]);
        expect(porNombre.ambos.invalidTags?.[0]).toMatchObject({ value: "desa", suggestion: { normalized: null, method: null } });
        expect(porNombre.extra.complianceStatus).toBe("COMPLIANT");

        expect(r.resourceGroups[0]).toMatchObject({
            complianceStatus: "NON_COMPLIANT",
            invalidTags: [{ value: "PROD", suggestion: { normalized: "prod", method: "exact" } }],
        });
        expect(r.nonCompliantResourcesCount).toBe(3);
        expect(r.invalidValueResourcesCount).toBe(2);
        expect(r.invalidValueResourceGroupsCount).toBe(1);
        expect(r.overallCompliancePercentage).toBe(40);
        expect(r.mandatoryPolicies.map((p) => p.tagName)).toEqual(["Environment", "Owner"]);
    });

    it("sin políticas propias valida contra las por defecto", async () => {
        db({});
        arg([recurso("a", { Environment: "Prod", Role: "api", CostCenter: "X", Department: "Y" })]);
        const r = await scanTagGovernanceLive({} as never, ["s1"], "t1");
        expect(r.mandatoryPolicies).toBe(DEFAULT_MANDATORY_TAG_POLICIES);
        expect(r.resources[0].invalidTags).toEqual([
            { tagName: "Environment", tagKey: "Environment", value: "Prod", suggestion: { normalized: "prod", method: "exact", confidence: 1 } },
        ]);
    });
});
