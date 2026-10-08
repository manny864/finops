// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, roleMock, queryMock, AuthError } = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(m: string, s = 401) { super(m); this.status = s; }
    }
    return { accessMock: vi.fn(), roleMock: vi.fn(), queryMock: vi.fn(), AuthError };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, requireTenantRole: roleMock, AuthError }));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));

import { GET, POST, PUT, DELETE } from "@/app/api/governance/policies/route";

const req = (method: string, body?: object) => new NextRequest("http://localhost/api/governance/policies", {
    method,
    headers: { "Content-Type": "application/json", "x-tenant-id": "t1" },
    body: body ? JSON.stringify(body) : undefined,
});

beforeEach(() => {
    accessMock.mockReset().mockResolvedValue({ tenantId: "t1" });
    roleMock.mockReset().mockResolvedValue({ tenantId: "t1" });
    queryMock.mockReset().mockResolvedValue([[]]);
});

describe("/api/governance/policies (TaggingPolicies en snake_case)", () => {
    it("GET consulta las columnas snake_case y mantiene el JSON en camelCase", async () => {
        queryMock.mockResolvedValueOnce([[
            { id: 1, policyName: "Environment", isRequired: 1, allowedValues: ["prod", "dev"] },
            { id: 2, policyName: "CostCenter", isRequired: 1, allowedValues: null },
            { id: 3, policyName: "Role", isRequired: 0, allowedValues: '["api"]' },
        ]]);
        const res = await GET(req("GET"));
        const json = await res.json();
        const sql = String(queryMock.mock.calls[0][0]);
        expect(sql).toMatch(/policy_name AS policyName/);
        expect(sql).toMatch(/WHERE tenant_id = \?/);
        expect(sql).not.toMatch(/tenantId =/);
        expect(json.data.map((p: { allowedValues: unknown }) => p.allowedValues)).toEqual([["prod", "dev"], null, ["api"]]);
        expect(accessMock).toHaveBeenCalled();
        expect(roleMock).not.toHaveBeenCalled();
    });

    it("POST exige Admin/Owner y guarda allowed_values como JSON", async () => {
        const res = await POST(req("POST", { policyName: "Environment", isRequired: true, allowedValues: [" prod ", "dev"] }));
        expect(res.status).toBe(200);
        expect(roleMock).toHaveBeenCalledWith(expect.anything(), "t1", ["Admin", "Owner"]);
        const [sql, params] = queryMock.mock.calls[1];
        expect(sql).toMatch(/INSERT INTO TaggingPolicies \(tenant_id, policy_name, is_required, allowed_values\)/);
        expect(params).toEqual(["t1", "Environment", 1, '["prod","dev"]']);
    });

    it("POST sin allowedValues guarda NULL (valor libre)", async () => {
        await POST(req("POST", { policyName: "CostCenter", isRequired: true }));
        expect(queryMock.mock.calls[1][1]).toEqual(["t1", "CostCenter", 1, null]);
    });

    it("POST rechaza allowedValues inválidos", async () => {
        for (const allowedValues of ["prod", [""], [1], new Array(101).fill("x"), ["x".repeat(257)]]) {
            const res = await POST(req("POST", { policyName: "Environment", isRequired: true, allowedValues }));
            expect(res.status).toBe(400);
        }
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("POST de una política existente responde 409", async () => {
        queryMock.mockResolvedValueOnce([[{ id: 9 }]]);
        const res = await POST(req("POST", { policyName: "Environment", isRequired: true }));
        expect(res.status).toBe(409);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("un rol sin permiso no escribe", async () => {
        roleMock.mockRejectedValue(new AuthError("requiere rol Admin/Owner", 403));
        expect((await POST(req("POST", { policyName: "Environment", isRequired: true }))).status).toBe(403);
        expect((await PUT(req("PUT", { id: 1, isRequired: false }))).status).toBe(403);
        expect((await DELETE(req("DELETE", { id: 1 }))).status).toBe(403);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("PUT sin allowedValues no toca la lista; con null la borra", async () => {
        await PUT(req("PUT", { id: 1, isRequired: false }));
        expect(queryMock.mock.calls[0][0]).toMatch(/SET is_required = \? WHERE id = \? AND tenant_id = \?/);
        expect(queryMock.mock.calls[0][1]).toEqual([0, 1, "t1"]);

        await PUT(req("PUT", { id: 1, isRequired: true, allowedValues: null }));
        expect(queryMock.mock.calls[1][0]).toMatch(/allowed_values = \?/);
        expect(queryMock.mock.calls[1][1]).toEqual([1, null, 1, "t1"]);
    });

    it("DELETE filtra por tenant_id", async () => {
        await DELETE(req("DELETE", { id: 7 }));
        expect(queryMock.mock.calls[0]).toEqual(["DELETE FROM TaggingPolicies WHERE id = ? AND tenant_id = ?", [7, "t1"]]);
    });
});
