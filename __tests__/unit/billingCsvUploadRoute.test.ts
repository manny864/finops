// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { identityMock, tierMock, rateMock, normalizeMock, assessmentMock, CsvMappingError, AuthError } = vi.hoisted(() => {
    class CsvMappingError extends Error {
        reason: string;
        constructor(reason: string) { super(`csv: ${reason}`); this.reason = reason; }
    }
    class AuthError extends Error {
        status: number;
        constructor(message: string, status = 401) { super(message); this.status = status; }
    }
    return {
        identityMock: vi.fn(), tierMock: vi.fn(), rateMock: vi.fn(),
        normalizeMock: vi.fn(), assessmentMock: vi.fn(), CsvMappingError, AuthError,
    };
});
vi.mock("@/lib/requestAuth", () => ({ requireRequestIdentity: identityMock, assertTenantTier: tierMock, AuthError }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rateMock } }));
vi.mock("@/modules/core/aiProvider", () => ({ getAssessment: assessmentMock, extractAiErrorMessage: () => "" }));
vi.mock("@/services/billingCsvMapping.service", () => ({ normalizeBillingCsv: normalizeMock, CsvMappingError }));

import { POST } from "@/app/api/intelligence/upload/route";

const ROWS = [{ Service: "VM", Cost: "1" }];
const upload = () => new NextRequest("http://localhost/api/intelligence/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: ROWS }),
});

beforeEach(() => {
    identityMock.mockReset();
    identityMock.mockResolvedValue({ tenantId: "t1", email: "ana@x.com" });
    tierMock.mockReset().mockResolvedValue(undefined);
    rateMock.mockReset().mockResolvedValue({ allowed: true, resetAt: new Date() });
    normalizeMock.mockReset();
    assessmentMock.mockReset();
    assessmentMock.mockResolvedValue("## ok");
});

describe("POST /api/intelligence/upload", () => {
    it("normaliza con el tenant y el usuario del token", async () => {
        normalizeMock.mockResolvedValue([{ ServiceName: "VM", ChargeCategory: "Usage", BilledCost: 1, EffectiveCost: 1 }]);
        const res = await POST(upload());
        expect(res.status).toBe(200);
        expect(normalizeMock).toHaveBeenCalledWith(ROWS, "t1", "ana@x.com");
        expect(tierMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "t1", "Business", "/api/intelligence/upload");
    });

    // La pantalla es Business; llamar la API directo no puede saltarse el plan.
    it("un plan sin la carga responde 403 sin gastar cupo ni IA", async () => {
        tierMock.mockRejectedValue(new AuthError("Esta función requiere el plan Business o superior.", 403));
        const res = await POST(upload());
        expect(res.status).toBe(403);
        expect(rateMock).not.toHaveBeenCalled();
        expect(normalizeMock).not.toHaveBeenCalled();
        expect(assessmentMock).not.toHaveBeenCalled();
    });

    it.each([
        ["tier", 403],
        ["tenant_disabled", 403],
        ["quota", 429],
        ["rate_limited", 429],
        ["invalid_mapping", 422],
    ])("un CSV que no se pudo mapear (%s) responde %i con el motivo, sin evaluar", async (reason, status) => {
        normalizeMock.mockRejectedValue(new CsvMappingError(reason));
        const res = await POST(upload());
        expect(res.status).toBe(status);
        expect((await res.json()).reason).toBe(reason);
        expect(assessmentMock).not.toHaveBeenCalled();
    });
});
