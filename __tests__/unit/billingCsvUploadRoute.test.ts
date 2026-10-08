// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { identityMock, normalizeMock, assessmentMock, CsvMappingError } = vi.hoisted(() => {
    class CsvMappingError extends Error {
        reason: string;
        constructor(reason: string) { super(`csv: ${reason}`); this.reason = reason; }
    }
    return { identityMock: vi.fn(), normalizeMock: vi.fn(), assessmentMock: vi.fn(), CsvMappingError };
});
vi.mock("@/lib/requestAuth", () => ({ requireRequestIdentity: identityMock, AuthError: class extends Error {} }));
vi.mock("@/lib/rateLimiter", () => ({
    default: { checkByKeyDistributed: vi.fn(async () => ({ allowed: true, resetAt: new Date() })) },
}));
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
