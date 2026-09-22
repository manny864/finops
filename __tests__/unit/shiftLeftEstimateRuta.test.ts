// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

const verifyApiKey = vi.fn();
const requireScope = vi.fn();
const checkByKeyDistributed = vi.fn();
const queryMock = vi.fn();

vi.mock("@/lib/publicApiAuth", () => ({
    verifyApiKey: (...a: unknown[]) => verifyApiKey(...a),
    requireScope: (...a: unknown[]) => requireScope(...a),
}));
vi.mock("@/lib/rateLimiter", () => ({
    default: { checkByKeyDistributed: (...a: unknown[]) => checkByKeyDistributed(...a) },
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));
// La tarificacion se prueba en iacCostEstimator.test.ts; aca importa la ruta.
vi.mock("@/services/pricingService", () => ({ getMonthlyCostEstimate: async () => 10 }));

import { POST } from "@/app/api/v1/shift-left/estimate/route";

const PLAN = readFileSync("__tests__/fixtures/terraform-plan-azurerm.json", "utf-8");

const pedido = (cuerpo: string) =>
    new Request("https://x/api/v1/shift-left/estimate", { method: "POST", body: cuerpo }) as any;

beforeEach(() => {
    verifyApiKey.mockReset().mockResolvedValue({ tenantId: "t1", keyId: 7, name: "ci", scopes: ["write:shift-left"], rateLimitPerMin: 60 });
    requireScope.mockReset();
    checkByKeyDistributed.mockReset().mockResolvedValue({ allowed: true });
    queryMock.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
});

describe("POST /api/v1/shift-left/estimate", () => {
    it("rechaza sin API key, antes de mirar el cuerpo", async () => {
        verifyApiKey.mockResolvedValue(null);
        const r = await POST(pedido(PLAN));
        expect(r.status).toBe(401);
        expect((await r.json()).error.code).toBe("unauthorized");
        // Lo importante: no se tarifo nada ni se escribio nada sin autenticar.
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("rechaza una clave sin el scope", async () => {
        requireScope.mockImplementation(() => { throw new Error("Insufficient scope. Required: write:shift-left"); });
        const r = await POST(pedido(PLAN));
        expect(r.status).toBe(403);
        expect((await r.json()).error.code).toBe("insufficient_scope");
    });

    it("respeta el rate limit por clave", async () => {
        checkByKeyDistributed.mockResolvedValue({ allowed: false });
        const r = await POST(pedido(PLAN));
        expect(r.status).toBe(429);
    });

    it("estima un plan real y devuelve el delta", async () => {
        const r = await POST(pedido(PLAN));
        expect(r.status).toBe(200);
        const { data } = await r.json();
        // 3 recursos tarifables a 10 cada uno; los otros 4 no cuestan.
        expect(data.delta_cost_usd).toBeCloseTo(30, 2);
        expect(data.currency).toBe("USD");
        expect(data.resources_free).toBe(4);
        expect(data.lines).toHaveLength(7);
    });

    it("acepta el plan pelado o envuelto", async () => {
        const envuelto = JSON.stringify({ plan: JSON.parse(PLAN), repository: "manny864/finops", pr_number: 42 });
        const r = await POST(pedido(envuelto));
        expect(r.status).toBe(200);
        // Con repository se registra la corrida; sin el, no hay donde archivarla.
        expect(queryMock).toHaveBeenCalledTimes(1);
        const params = queryMock.mock.calls[0][1];
        expect(params[0]).toBe("t1");
        expect(params[1]).toBe("manny864/finops");
        expect(params[2]).toBe(42);
    });

    it("no registra nada cuando no se dice de que repo viene", async () => {
        await POST(pedido(PLAN));
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("si MySQL falla igual responde la estimacion", async () => {
        // El CI esta esperando este numero para comentar el PR. Perder una fila
        // de historial no puede costar la respuesta.
        queryMock.mockRejectedValue(new Error("ECONNREFUSED"));
        const envuelto = JSON.stringify({ plan: JSON.parse(PLAN), repository: "manny864/finops" });
        const r = await POST(pedido(envuelto));
        expect(r.status).toBe(200);
        expect((await r.json()).data.delta_cost_usd).toBeCloseTo(30, 2);
    });

    it("distingue un JSON roto de un plan que no es un plan", async () => {
        const roto = await POST(pedido("{no es json"));
        expect(roto.status).toBe(400);
        expect((await roto.json()).error.code).toBe("invalid_json");

        const noEsPlan = await POST(pedido(JSON.stringify({ hola: "mundo" })));
        expect(noEsPlan.status).toBe(400);
        expect((await noEsPlan.json()).error.code).toBe("invalid_plan");
    });

    it("corta un plan desmedido antes de parsearlo", async () => {
        const enorme = JSON.stringify({ relleno: "x".repeat(7 * 1024 * 1024) });
        const r = await POST(pedido(enorme));
        expect(r.status).toBe(413);
    });

    it("siempre devuelve X-Request-Id, tambien en los errores", async () => {
        const ok = await POST(pedido(PLAN));
        expect(ok.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
        verifyApiKey.mockResolvedValue(null);
        const mal = await POST(pedido(PLAN));
        expect(mal.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    });
});
