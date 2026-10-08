// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, queryMock, AuthError } = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(m: string, s = 401) { super(m); this.status = s; }
    }
    return { accessMock: vi.fn(), queryMock: vi.fn(), AuthError };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, AuthError }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo_tenant" }));

import { POST } from "@/app/api/governance/tags/suggest/route";

const req = (qs: string, body: string | object) => new NextRequest(`http://localhost/api/governance/tags/suggest${qs}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
});
const ok = { resourceName: "sql-dev-01", resourceType: "Microsoft.Sql/servers", resourceGroup: "rg-data" };

beforeEach(() => {
    accessMock.mockReset().mockResolvedValue({ tenantId: "t1" });
    queryMock.mockReset().mockResolvedValue([[]]);
});

describe("POST /api/governance/tags/suggest", () => {
    it("sin tenantId responde 400 en vez de caer en 'default'", async () => {
        const res = await POST(req("", ok));
        expect(res.status).toBe(400);
        expect(accessMock).not.toHaveBeenCalled();
    });

    // Antes `?mock=true` salteaba la autenticación para cualquier tenant.
    it("?mock=true ya no saltea la autenticación", async () => {
        accessMock.mockRejectedValue(new AuthError("no", 403));
        const res = await POST(req("?tenantId=t1&mock=true", ok));
        expect(accessMock).toHaveBeenCalled();
        expect(res.status).toBe(403);
    });

    it("propaga el status del AuthError en vez de 500", async () => {
        accessMock.mockRejectedValue(new AuthError("sin token", 401));
        expect((await POST(req("?tenantId=t1", ok))).status).toBe(401);
    });

    it("JSON inválido o sin resourceName responde 400", async () => {
        expect((await POST(req("?tenantId=t1", "{nope"))).status).toBe(400);
        expect((await POST(req("?tenantId=t1", { resourceType: "x" }))).status).toBe(400);
    });

    it("no inventa una confianza: declara que es heurística", async () => {
        const res = await POST(req("?tenantId=t1", ok));
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.method).toBe("heuristic");
        expect(json).not.toHaveProperty("confidence");
        expect(json.suggestedTags.Environment).toBe("dev");
        expect(json.details).toEqual({
            Environment: { value: "dev", method: "naming", basis: "name", confidence: 0.8 },
            Role: { value: "database", method: "naming", basis: "name", confidence: 0.8 },
            CostCenter: { value: "DataTeam", method: "naming", basis: "resource_group", confidence: 0.6 },
            Department: { value: "DataPlatform", method: "naming", basis: "role", confidence: 0.5 },
        });
    });

    it("normaliza el valor actual al vocabulario y con los alias del tenant", async () => {
        queryMock.mockImplementation(async (sql: string) =>
            sql.includes("TaggingPolicies")
                ? [[{ id: 1, policy_name: "Environment", is_required: 1, allowed_values: '["Production","Development"]' }]]
                : [[{ tag_name: "Environment", alias: "prd", canonical_value: "Production" }]]
        );
        const res = await POST(req("?tenantId=t1", { ...ok, currentTags: { Environment: "PRD", Owner: 3 } }));
        const json = await res.json();
        expect(json.details.Environment).toEqual({ value: "Production", method: "alias", confidence: 0.95 });
        expect(json.suggestedTags).toMatchObject({ Environment: "Production", Role: "database" });
    });

    it("el tenant demo no pasa por requireTenantAccess", async () => {
        const res = await POST(req("?tenantId=demo_tenant", ok));
        expect(res.status).toBe(200);
        expect(accessMock).not.toHaveBeenCalled();
        expect(queryMock).not.toHaveBeenCalled();
    });
});
