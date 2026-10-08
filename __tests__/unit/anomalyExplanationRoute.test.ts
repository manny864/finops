// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, AuthError, queryMock, explainMock, feedbackMock, normalizeMock } = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(m: string, s = 401) { super(m); this.status = s; }
    }
    return {
        accessMock: vi.fn(),
        AuthError,
        queryMock: vi.fn(),
        explainMock: vi.fn(),
        feedbackMock: vi.fn(),
        normalizeMock: vi.fn(),
    };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, AuthError }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/services/anomalyExplanation.service", () => ({
    getAnomalyExplanation: explainMock,
    saveExplanationFeedback: feedbackMock,
    normalizeExplanationLocale: normalizeMock,
}));

import { GET, POST } from "@/app/api/intelligence/anomalies/[id]/explanation/route";

const URL = "http://localhost/api/intelligence/anomalies/7/explanation";
const ctx = (id = "7") => ({ params: Promise.resolve({ id }) });
const get = (qs: string, headers: Record<string, string> = {}) => new NextRequest(`${URL}${qs}`, { headers });
const post = (body: unknown) => new NextRequest(URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
});
const HASH = "a".repeat(64);
const FEEDBACK = { tenantId: "t1", locale: "es", factsHash: HASH, feedback: "down" };

beforeEach(() => {
    accessMock.mockReset();
    accessMock.mockResolvedValue({ email: "ana@x.com" });
    queryMock.mockReset();
    queryMock.mockResolvedValue([[{ id: 7 }]]);
    explainMock.mockReset();
    explainMock.mockResolvedValue({ aiAvailable: false, reason: "quota" });
    feedbackMock.mockReset();
    feedbackMock.mockResolvedValue(true);
    normalizeMock.mockReset();
    normalizeMock.mockImplementation((l: string | null) => (l?.startsWith("en") ? "en" : "es"));
});

describe("GET /api/intelligence/anomalies/[id]/explanation", () => {
    it("sin tenantId o con un id inválido responde 400 sin autenticar", async () => {
        expect((await GET(get(""), ctx())).status).toBe(400);
        expect((await GET(get("?tenantId=t1"), ctx("abc"))).status).toBe(400);
        expect(accessMock).not.toHaveBeenCalled();
    });

    it("propaga el status del AuthError", async () => {
        accessMock.mockRejectedValue(new AuthError("acotado", 403));
        expect((await GET(get("?tenantId=t1"), ctx())).status).toBe(403);
    });

    it("una anomalía de otro tenant es 404 y no se explica", async () => {
        queryMock.mockResolvedValue([[]]);
        expect((await GET(get("?tenantId=t1"), ctx())).status).toBe(404);
        expect(queryMock.mock.calls[0][1]).toEqual([7, "t1"]);
        expect(explainMock).not.toHaveBeenCalled();
    });

    it("un denegado del gate es 200 con el motivo; el idioma sale de accept-language si no hay ?locale", async () => {
        const res = await GET(get("?tenantId=t1", { "accept-language": "en-US,en;q=0.9" }), ctx());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, aiAvailable: false, reason: "quota" });
        expect(normalizeMock).toHaveBeenCalledWith("en-US,en;q=0.9");
        expect(explainMock).toHaveBeenCalledWith({ tenantId: "t1", userEmail: "ana@x.com", locale: "en", anomaly: { id: 7 } });

        await GET(get("?tenantId=t1&locale=pt-BR", { "accept-language": "en" }), ctx());
        expect(normalizeMock).toHaveBeenLastCalledWith("pt-BR");
    });
});

describe("POST /api/intelligence/anomalies/[id]/explanation (feedback)", () => {
    it("rechaza payloads inválidos con 400 sin autenticar", async () => {
        for (const body of ["{no json", { ...FEEDBACK, factsHash: "x" }, { ...FEEDBACK, feedback: "meh" }, { ...FEEDBACK, tenantId: "" }]) {
            expect((await POST(post(body), ctx())).status).toBe(400);
        }
        expect(accessMock).not.toHaveBeenCalled();
    });

    it("guarda el feedback con el usuario autenticado", async () => {
        const res = await POST(post(FEEDBACK), ctx());
        expect(res.status).toBe(200);
        expect(feedbackMock).toHaveBeenCalledWith({
            tenantId: "t1", anomalyId: 7, locale: "es", factsHash: HASH, feedback: "down", userEmail: "ana@x.com",
        });
    });

    it("404 si no hay una explicación de IA que coincida", async () => {
        feedbackMock.mockResolvedValue(false);
        expect((await POST(post(FEEDBACK), ctx())).status).toBe(404);
    });
});
