// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, AuthError } = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(m: string, s = 401) { super(m); this.status = s; }
    }
    return { accessMock: vi.fn(), AuthError };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, AuthError }));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo_tenant" }));

import { POST } from "@/app/api/governance/tags/suggest/route";

const req = (qs: string, body: string | object) => new NextRequest(`http://localhost/api/governance/tags/suggest${qs}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
});
const ok = { resourceName: "sql-dev-01", resourceType: "Microsoft.Sql/servers", resourceGroup: "rg-data" };

beforeEach(() => { accessMock.mockReset().mockResolvedValue({ tenantId: "t1" }); });

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
    });

    it("el tenant demo no pasa por requireTenantAccess", async () => {
        const res = await POST(req("?tenantId=demo_tenant", ok));
        expect(res.status).toBe(200);
        expect(accessMock).not.toHaveBeenCalled();
    });
});
