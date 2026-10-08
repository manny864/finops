// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, roleMock, queryMock, policiesMock, AuthError } = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(m: string, s = 401) { super(m); this.status = s; }
    }
    return { accessMock: vi.fn(), roleMock: vi.fn(), queryMock: vi.fn(), policiesMock: vi.fn(), AuthError };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, requireTenantRole: roleMock, AuthError }));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo" }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/services/azureTagGovernance.service", () => ({ getTenantTagPolicies: policiesMock }));

import { GET, POST } from "@/app/api/governance/tags/normalization/route";

const req = (method: string, tenantId: string, body?: unknown) =>
    new NextRequest(`http://localhost/api/governance/tags/normalization?tenantId=${tenantId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

const DECISION = {
    tagName: "environment",
    originalValue: "Production",
    suggestedValue: "prod",
    suggestionSource: "rule",
    suggestedMethod: "alias",
    suggestedConfidence: 0.95,
    appliedValue: "prod",
    resourceCount: 3,
};

beforeEach(() => {
    accessMock.mockReset().mockResolvedValue({ tenantId: "t1" });
    roleMock.mockReset().mockResolvedValue({ tenantId: "t1", email: "ana@cliente.com", claims: { oid: "oid-1" } });
    queryMock.mockReset().mockResolvedValue([[]]);
    policiesMock.mockReset().mockResolvedValue([
        { id: "p1", tagName: "Environment", isRequired: true, allowedValues: ["prod", "dev"] },
        { id: "p2", tagName: "CostCenter", isRequired: true },
    ]);
});

describe("POST /api/governance/tags/normalization", () => {
    it("exige Admin/Owner y registra la decisión con el nombre canónico de la política", async () => {
        const res = await POST(req("POST", "t1", DECISION));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, aliasSaved: false });
        expect(roleMock).toHaveBeenCalledWith(expect.anything(), "t1", ["Admin", "Owner"]);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO TagNormalizationDecisions/);
        expect(params).toEqual(["t1", "Environment", "Production", "prod", "rule", "alias", 0.95, "prod", 1, 3, "ana@cliente.com"]);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("con saveAlias guarda el alias del tenant en su forma comparable", async () => {
        const res = await POST(req("POST", "t1", { ...DECISION, originalValue: "Producción ", saveAlias: true }));
        expect(await res.json()).toEqual({ success: true, aliasSaved: true });
        const [sql, params] = queryMock.mock.calls[1];
        expect(sql).toMatch(/INSERT INTO TagValueAliases[\s\S]*ON DUPLICATE KEY UPDATE canonical_value/);
        expect(params).toEqual(["t1", "Environment", "produccion", "prod", "ana@cliente.com"]);
    });

    it("no guarda alias si el original ya se resuelve por forma comparable o si fue un descarte", async () => {
        await POST(req("POST", "t1", { ...DECISION, originalValue: "PROD", saveAlias: true }));
        await POST(req("POST", "t1", { ...DECISION, appliedValue: null, saveAlias: true }));
        expect(queryMock).toHaveBeenCalledTimes(2);
        expect(queryMock.mock.calls.every(([sql]) => /TagNormalizationDecisions/.test(sql))).toBe(true);
    });

    it("calcula accepted: 0 si se aplicó otro valor o se descartó, NULL si no había sugerencia", async () => {
        await POST(req("POST", "t1", { ...DECISION, appliedValue: "dev" }));
        await POST(req("POST", "t1", { ...DECISION, appliedValue: null }));
        await POST(req("POST", "t1", { tagName: "CostCenter", originalValue: "", appliedValue: "FIN-001", resourceCount: 1 }));
        const accepted = queryMock.mock.calls.map(([, p]) => p[8]);
        expect(accepted).toEqual([0, 0, null]);
        expect(queryMock.mock.calls[2][1].slice(3, 7)).toEqual([null, null, null, null]);
    });

    it("registra la herencia del grupo como sugerencia por regla aceptada, sin alias", async () => {
        const res = await POST(req("POST", "t1", {
            tagName: "costcenter",
            originalValue: "",
            suggestedValue: "CorePlatform",
            suggestionSource: "rule",
            suggestedMethod: "inheritance",
            suggestedConfidence: 1,
            appliedValue: "CorePlatform",
            resourceCount: 2,
            saveAlias: true,
        }));
        expect(await res.json()).toEqual({ success: true, aliasSaved: false });
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(queryMock.mock.calls[0][1]).toEqual(
            ["t1", "CostCenter", "", "CorePlatform", "rule", "inheritance", 1, "CorePlatform", 1, 2, "ana@cliente.com"],
        );
    });

    it("rechaza un valor aplicado fuera de los permitidos", async () => {
        const res = await POST(req("POST", "t1", { ...DECISION, appliedValue: "produccion" }));
        expect(res.status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("rechaza etiquetas sin política y payloads inválidos", async () => {
        expect((await POST(req("POST", "t1", { ...DECISION, tagName: "Owner" }))).status).toBe(400);
        for (const malo of [
            { ...DECISION, tagName: "" },
            { ...DECISION, originalValue: 5 },
            { ...DECISION, suggestedValue: null, appliedValue: null },
            { ...DECISION, suggestionSource: "magia" },
            { ...DECISION, suggestedMethod: "heuristic" },
            { ...DECISION, suggestedConfidence: 1.5 },
            { ...DECISION, resourceCount: -1 },
            { ...DECISION, appliedValue: "x".repeat(257) },
        ]) {
            expect((await POST(req("POST", "t1", malo))).status).toBe(400);
        }
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("propaga el 403 de rol sin tocar la base", async () => {
        roleMock.mockRejectedValueOnce(new AuthError("Acceso denegado: requiere rol Admin/Owner.", 403));
        const res = await POST(req("POST", "t1", DECISION));
        expect(res.status).toBe(403);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("demo: valida pero no escribe ni pide rol", async () => {
        const res = await POST(req("POST", "demo", { ...DECISION, saveAlias: true }));
        expect(await res.json()).toEqual({ success: true, mock: true, aliasSaved: true });
        expect(roleMock).not.toHaveBeenCalled();
        expect(queryMock).not.toHaveBeenCalled();
    });
});

describe("GET /api/governance/tags/normalization", () => {
    it("pondera por recursos y calcula la tasa de aceptación sobre las sugerencias decididas", async () => {
        queryMock.mockResolvedValueOnce([[{ by_rule: "12", by_ai: "3", manual: "2", accepted_count: "7", decided_count: "9" }]]);
        const res = await GET(req("GET", "t1"));
        expect(accessMock).toHaveBeenCalledWith(expect.anything(), "t1");
        expect(queryMock.mock.calls[0][1]).toEqual(["t1", 90]);
        expect(await res.json()).toEqual({
            periodDays: 90,
            resolvedResources: { rule: 12, ai: 3, manual: 2 },
            suggestionsDecided: 9,
            suggestionsAccepted: 7,
            acceptanceRatePct: 77.8,
        });
    });

    it("sin decisiones la tasa es null", async () => {
        queryMock.mockResolvedValueOnce([[{ by_rule: 0, by_ai: 0, manual: 0, accepted_count: 0, decided_count: 0 }]]);
        expect((await (await GET(req("GET", "t1"))).json()).acceptanceRatePct).toBeNull();
    });

    it("demo devuelve KPIs mock sin auth ni base", async () => {
        const json = await (await GET(req("GET", "demo"))).json();
        expect(json.resolvedResources.rule).toBeGreaterThan(0);
        expect(accessMock).not.toHaveBeenCalled();
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("sin tenantId responde 400", async () => {
        const res = await GET(new NextRequest("http://localhost/api/governance/tags/normalization"));
        expect(res.status).toBe(400);
    });
});
