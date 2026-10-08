// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, globalMock, queryMock, rlMock, assessmentMock } = vi.hoisted(() => ({
    accessMock: vi.fn(),
    globalMock: vi.fn(),
    queryMock: vi.fn(),
    rlMock: vi.fn(),
    assessmentMock: vi.fn(),
}));
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, AuthError: class extends Error { status = 401; } }));
vi.mock("@/services/aiService", () => ({ isAiGloballyEnabled: globalMock }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rlMock } }));
vi.mock("@/modules/core/aiProvider", () => ({ getAssessment: assessmentMock }));

import { POST } from "@/app/api/intelligence/assessment/route";

const req = () => new NextRequest("http://localhost/api/intelligence/assessment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: "t1", metrics: [{ ServiceName: "VM" }] }),
});

beforeEach(() => {
    accessMock.mockReset().mockResolvedValue({ email: "ana@x.com" });
    globalMock.mockReset().mockResolvedValue(true);
    queryMock.mockReset().mockResolvedValue([[{ ai_enabled: 1 }]]);
    rlMock.mockReset().mockResolvedValue({ allowed: true, resetAt: new Date() });
    assessmentMock.mockReset().mockResolvedValue("## ok");
});

// MEJ-42 punto 2: esta ruta llamaba a la IA aunque la plataforma o el tenant la tuvieran apagada.
describe("POST /api/intelligence/assessment", () => {
    it("con la IA apagada en la plataforma no llama al modelo", async () => {
        globalMock.mockResolvedValue(false);
        const res = await POST(req());
        expect(res.status).toBe(403);
        expect((await res.json()).aiDisabled).toBe(true);
        expect(assessmentMock).not.toHaveBeenCalled();
    });

    it("con la IA apagada en el tenant no llama al modelo", async () => {
        queryMock.mockResolvedValue([[{ ai_enabled: 0 }]]);
        const res = await POST(req());
        expect(res.status).toBe(403);
        expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("ai_enabled"), ["t1"]);
        expect(assessmentMock).not.toHaveBeenCalled();
    });

    it("con todo encendido genera el reporte", async () => {
        const res = await POST(req());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, report: "## ok" });
        expect(assessmentMock).toHaveBeenCalledWith([{ ServiceName: "VM" }], "t1");
    });
});
