// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { identityMock, tierMock, rateMock, gateMock, currencyMock, normalizeMock, assessmentMock, CsvMappingError, AuthError } = vi.hoisted(() => {
    class CsvMappingError extends Error {
        reason: string;
        constructor(reason: string) { super(`csv: ${reason}`); this.reason = reason; }
    }
    class AuthError extends Error {
        status: number;
        constructor(message: string, status = 401) { super(message); this.status = status; }
    }
    return {
        identityMock: vi.fn(), tierMock: vi.fn(), rateMock: vi.fn(), gateMock: vi.fn(), currencyMock: vi.fn(),
        normalizeMock: vi.fn(), assessmentMock: vi.fn(), CsvMappingError, AuthError,
    };
});
vi.mock("@/lib/requestAuth", () => ({ requireRequestIdentity: identityMock, assertTenantTier: tierMock, AuthError }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rateMock } }));
vi.mock("@/modules/core/aiProvider", () => ({ getAssessment: assessmentMock, extractAiErrorMessage: () => "" }));
vi.mock("@/services/billingCsvMapping.service", () => ({
    normalizeBillingCsv: normalizeMock,
    csvCurrency: currencyMock,
    CsvMappingError,
}));
vi.mock("@/lib/aiFeatureGate", () => ({
    checkAiFeature: gateMock,
    AI_FEATURES: { "billing-upload-assessment": { maxOutputTokens: 4000 } },
}));

import { POST } from "@/app/api/intelligence/upload/route";

const ROWS = [{ Service: "VM", Cost: "1" }];
const upload = (extra: object = {}, data: object[] = ROWS) => new NextRequest("http://localhost/api/intelligence/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, ...extra }),
});
const VM = { ServiceName: "VM", ChargeCategory: "Usage", BilledCost: 1, EffectiveCost: 1 };

beforeEach(() => {
    identityMock.mockReset();
    identityMock.mockResolvedValue({ tenantId: "t1", email: "ana@x.com" });
    tierMock.mockReset().mockResolvedValue(undefined);
    rateMock.mockReset().mockResolvedValue({ allowed: true, resetAt: new Date() });
    normalizeMock.mockReset();
    assessmentMock.mockReset();
    assessmentMock.mockResolvedValue("## ok");
    gateMock.mockReset().mockResolvedValue({ allowed: true });
    currencyMock.mockReset().mockReturnValue(null);
});

describe("POST /api/intelligence/upload", () => {
    it("normaliza con el tenant y el usuario del token", async () => {
        normalizeMock.mockResolvedValue([{ ServiceName: "VM", ChargeCategory: "Usage", BilledCost: 1, EffectiveCost: 1 }]);
        const res = await POST(upload());
        expect(res.status).toBe(200);
        expect(normalizeMock).toHaveBeenCalledWith(ROWS, "t1", "ana@x.com");
        expect(tierMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "t1", "Business", "/api/intelligence/upload");
    });

    it("el análisis pasa por el gate, en el idioma de la UI y la moneda del archivo", async () => {
        normalizeMock.mockResolvedValue([VM]);
        currencyMock.mockReturnValue("EUR");
        const res = await POST(upload({ locale: "en" }));
        expect(res.status).toBe(200);
        expect(currencyMock).toHaveBeenCalledWith(ROWS);
        expect(gateMock).toHaveBeenCalledWith("t1", "billing-upload-assessment", "ana@x.com");
        expect(assessmentMock).toHaveBeenCalledWith([VM], "t1", {
            feature: "billing-upload-assessment",
            maxOutputTokens: 4000,
            locale: "en",
            currency: "EUR",
        });
    });

    // El gate niega sin romper la carga: el resumen ya está calculado.
    it("sin IA devuelve el resumen calculado y el motivo, sin llamar al modelo", async () => {
        normalizeMock.mockResolvedValue([VM, { ...VM, ServiceName: "SQL", BilledCost: 5, EffectiveCost: 4 }]);
        gateMock.mockResolvedValue({ allowed: false, reason: "quota" });
        const res = await POST(upload());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toMatchObject({ success: true, assessment: null, aiUnavailable: "quota", currency: null, mappedEntries: 2 });
        expect(json.summary.map((r: { ServiceName: string }) => r.ServiceName)).toEqual(["SQL", "VM"]);
        expect(assessmentMock).not.toHaveBeenCalled();
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

    describe("AISEC-06 — topes del body y de las filas", () => {
        const raw = (body: string, headers: Record<string, string> = {}) =>
            new NextRequest("http://localhost/api/intelligence/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...headers },
                body,
            });

        it("rechaza con 413 por Content-Length declarado sin leer el body", async () => {
            const res = await POST(raw("{}", { "content-length": String(64 * 1024 * 1024) }));
            expect(res.status).toBe(413);
            expect(normalizeMock).not.toHaveBeenCalled();
        });

        it("corta con 413 al pasar el tope aunque no haya Content-Length (stream)", async () => {
            const big = new TextEncoder().encode(" ".repeat(1024 * 1024));
            let sent = 0;
            const stream = new ReadableStream<Uint8Array>({
                pull(c) {
                    if (sent++ < 40) c.enqueue(big);
                    else c.close();
                },
            });
            const req = new NextRequest("http://localhost/api/intelligence/upload", {
                method: "POST",
                body: stream,
                // @ts-expect-error duplex es requerido por undici para bodies en stream
                duplex: "half",
            });
            const res = await POST(req);
            expect(res.status).toBe(413);
            expect(sent).toBeLessThan(40);
        });

        it("JSON inválido → 400", async () => {
            expect((await POST(raw("{nope"))).status).toBe(400);
        });

        it.each([
            ["demasiadas columnas", [Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`c${i}`, "1"]))]],
            ["celda gigante", [{ Service: "x".repeat(4097), Cost: "1" }]],
            ["columna __proto__", [JSON.parse('{"__proto__": "x", "Cost": "1"}')]],
            ["nombre de columna gigante", [{ ["k".repeat(129)]: "1" }]],
            ["celda objeto", [{ Service: { nested: true }, Cost: "1" }]],
            ["fila que no es objeto", ["hola"]],
            ["fila vacía", [{}]],
        ])("%s → 400 sin llegar a la IA", async (_label, data) => {
            const res = await POST(upload({}, data as object[]));
            expect(res.status).toBe(400);
            expect(normalizeMock).not.toHaveBeenCalled();
        });

        it("la agregación no mezcla ('a-b','c') con ('a','b-c')", async () => {
            normalizeMock.mockResolvedValue([
                { ServiceName: "a-b", ChargeCategory: "c", BilledCost: 1, EffectiveCost: 1 },
                { ServiceName: "a", ChargeCategory: "b-c", BilledCost: 2, EffectiveCost: 2 },
            ]);
            await POST(upload());
            expect(assessmentMock.mock.calls[0][0]).toHaveLength(2);
        });
    });
});
