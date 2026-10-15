// @vitest-environment node
/**
 * PERIM-09 — Respuestas públicas y logs sin internals.
 *
 * Cada fallo se provoca con un error sintético que trae un SAS, una password, SQL y una
 * URL firmada. Ninguno de esos fragmentos puede aparecer en la respuesta ni en los logs;
 * sí tiene que haber un `errorId` que esté en ambos para correlacionar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const SECRETS = [
    "sig=SASFIRMA123",
    "password=Hunter2!",
    "SELECT * FROM Tenants WHERE secret",
    "https://acct.blob.core.windows.net/c/x?sv=2024&sig=URLFIRMADA",
    "client_secret=MKT_SECRETO",
];
const poison = (extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`fallo interno ${SECRETS.join(" ")}`), extra);

const h = vi.hoisted(() => ({
    query: vi.fn(),
    connQuery: vi.fn(),
    upsert: vi.fn(),
    budgets: vi.fn(),
    resolveSubscription: vi.fn(),
    activateSubscription: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ redis: { eval: vi.fn(async () => [1, 60000]) } }));
vi.mock("@/modules/storage/db", () => ({
    default: {
        query: h.query,
        getConnection: vi.fn(async () => ({ query: h.connQuery, release: vi.fn() })),
    },
    initializeDatabase: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({
    invalidateCache: vi.fn(async () => undefined),
    getWithStaleWhileRevalidate: vi.fn(async () => []),
}));
vi.mock("@/services/azureUnitEconomics.service", async (orig) => ({
    ...(await orig<object>()),
    upsertBusinessUnits: h.upsert,
}));
vi.mock("@/services/budgetUtilization.service", async (orig) => ({
    ...(await orig<object>()),
    getBudgetStatuses: h.budgets,
}));
vi.mock("@/lib/marketplace/azure", async (orig) => ({
    ...(await orig<typeof import("@/lib/marketplace/azure")>()),
    resolveSubscription: h.resolveSubscription,
    activateSubscription: h.activateSubscription,
}));

import { POST as ingestPOST } from "@/app/api/unit-metrics/ingest/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { POST as activatePOST } from "@/app/api/webhooks/marketplace/azure/activate/route";
import { GET as statusGET } from "@/app/api/status/route";
import { __resetKeyGuardsForTests } from "@/lib/apiKeyGuards";
import { actionableCause, errorCategory } from "@/lib/publicErrors";

const PAK = "pak_" + "a".repeat(40);
const MCP = "mcp_" + "b".repeat(40);
const sha = (k: string) => crypto.createHash("sha256").update(k).digest("hex");

let logs: string[];

beforeEach(() => {
    vi.clearAllMocks();
    __resetKeyGuardsForTests();
    logs = [];
    const capture = (...args: unknown[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    for (const m of ["error", "warn", "log", "info"] as const) vi.spyOn(console, m).mockImplementation(capture);
    h.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM PublicApiKeys") && params?.[0] === sha(PAK)) {
            return [[{ id: 7, tenant_id: "t1", name: "ci", scopes: JSON.stringify(["write:metrics"]), rate_limit_per_min: 60 }]];
        }
        if (sql.includes("FROM MCPApiKeys") && params?.[0] === sha(MCP)) return [[{ id: 9, tenant_id: "t1" }]];
        return [[]];
    });
});
afterEach(() => vi.restoreAllMocks());

async function expectClean(res: Response) {
    const text = await res.text();
    const all = text + "\n" + logs.join("\n");
    for (const s of SECRETS) expect(all).not.toContain(s);
    expect(all).not.toContain("fallo interno");
    return text;
}

function expectCorrelated(text: string) {
    const id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    expect(id).toBeTruthy();
    expect(logs.some((l) => l.includes(id!))).toBe(true);
}

const mcp = (body: unknown) =>
    mcpPOST(new NextRequest("https://app/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${MCP}`, "content-type": "application/json" },
        body: JSON.stringify(body),
    }));

describe("PERIM-09 — MCP", () => {
    it("fallo no atrapado de una tool: -32603 'Internal error' con errorId, sin mensaje", async () => {
        h.query.mockImplementation(async (sql: string, params?: unknown[]) => {
            if (sql.includes("FROM MCPApiKeys") && params?.[0] === sha(MCP)) return [[{ id: 9, tenant_id: "t1" }]];
            if (sql.includes("cost_snapshots")) throw poison({ code: "ER_ACCESS_DENIED_ERROR" });
            return [[]];
        });
        const res = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_cost_summary" } });
        expect(res.status).toBe(500);
        const text = await expectClean(res);
        const body = JSON.parse(text);
        expect(body.error).toMatchObject({ code: -32603, message: "Internal error" });
        expect(body.error.data.errorId).toMatch(/^[0-9a-f-]{36}$/);
        expectCorrelated(text);
        expect(logs.join(" ")).toContain("ER_ACCESS_DENIED_ERROR");
    });

    it("fallo atrapado de una tool: isError=true y nota fija con errorId", async () => {
        h.budgets.mockRejectedValue(poison());
        const res = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_budgets_status" } });
        expect(res.status).toBe(200);
        const text = await expectClean(res);
        const body = JSON.parse(text);
        expect(body.result.isError).toBe(true);
        expect(JSON.parse(body.result.content[0].text).note).toMatch(/^No se pudieron leer los presupuestos: error interno \(errorId /);
        expectCorrelated(text);
    });

    it("causa accionable conocida: texto fijo, sin el mensaje original", async () => {
        h.budgets.mockRejectedValue(poison({ code: "MISSING_RBAC_ROLE" }));
        const res = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_budgets_status" } });
        const text = await expectClean(res);
        expect(JSON.parse(JSON.parse(text).result.content[0].text).note).toContain("Falta rol Lector en las suscripciones de Azure");
    });

    it("éxito sin nota: isError=false", async () => {
        h.budgets.mockResolvedValue([]);
        const res = await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_budgets_status" } });
        expect((await res.json()).result.isError).toBe(false);
    });

    it("validación conserva su significado: tool inexistente", async () => {
        const res = await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } });
        expect((await res.json()).error.message).toBe("Tool not found: nope");
    });
});

describe("PERIM-09 — ingesta", () => {
    const ingest = (rows: unknown) =>
        ingestPOST(new NextRequest("https://app/api/unit-metrics/ingest", {
            method: "POST",
            headers: { "x-api-key": PAK, "content-type": "application/json" },
            body: JSON.stringify(rows),
        }));

    it("fila que falla al persistir: motivo fijo e índice del lote original", async () => {
        h.upsert.mockRejectedValueOnce(poison({ code: "ER_LOCK_DEADLOCK" }));
        const res = await ingest([
            { metricDate: "mal", metricType: "TRANSACTIONS", unitCount: 1 },
            { metricDate: "2026-10-01", metricType: "TRANSACTIONS", unitCount: 1 },
        ]);
        expect(res.status).toBe(400);
        const body = JSON.parse(await expectClean(res));
        expect(body.rejected).toEqual([
            { index: 0, reason: "metricDate debe tener formato YYYY-MM-DD" },
            { index: 1, reason: "Error al persistir la fila" },
        ]);
        expect(logs.join(" ")).toContain("ER_LOCK_DEADLOCK");
    });

    it("401 conserva su significado", async () => {
        const res = await ingestPOST(new NextRequest("https://app/api/unit-metrics/ingest", { method: "POST", body: "[]" }));
        expect(res.status).toBe(401);
    });
});

describe("PERIM-09 — activación de Marketplace", () => {
    const activate = () =>
        activatePOST(new NextRequest("https://app/api/webhooks/marketplace/azure/activate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: "tok" }),
        }));

    it("resolve falla: 502 genérico con errorId", async () => {
        h.resolveSubscription.mockRejectedValue(poison({ status: 400 }));
        const res = await activate();
        expect(res.status).toBe(502);
        const text = await expectClean(res);
        expect(JSON.parse(text)).toEqual({ error: "Unable to complete activation", errorId: expect.any(String) });
        expectCorrelated(text);
    });

    it("persistencia falla: 500 genérico con errorId", async () => {
        h.resolveSubscription.mockResolvedValue({ id: "sub-1", planId: "p" });
        h.connQuery.mockRejectedValue(poison({ code: "ER_BAD_FIELD_ERROR" }));
        const res = await activate();
        expect(res.status).toBe(500);
        const text = await expectClean(res);
        expect(JSON.parse(text).error).toBe("Unable to complete activation");
        expectCorrelated(text);
    });

    it("activateSubscription falla: se registra sin el mensaje y la activación sigue", async () => {
        h.resolveSubscription.mockResolvedValue({ id: "sub-1", planId: "p" });
        h.connQuery.mockResolvedValue([[]]);
        h.activateSubscription.mockRejectedValue(poison());
        const res = await activate();
        expect(res.status).toBe(200);
        await expectClean(res);
    });
});

describe("PERIM-09 — helper de Fulfillment", () => {
    it("el cuerpo remoto no entra en la excepción", async () => {
        const { resolveSubscription } = await vi.importActual<typeof import("@/lib/marketplace/azure")>("@/lib/marketplace/azure");
        process.env.AZURE_MARKETPLACE_AAD_TENANT_ID = "t";
        process.env.AZURE_MARKETPLACE_AAD_APP_ID = "a";
        process.env.AZURE_MARKETPLACE_AAD_APP_SECRET = "s";
        vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
            String(url).includes("/oauth2/")
                ? Response.json({ access_token: "x", expires_in: 3600 })
                : new Response(`{"error":"${SECRETS.join(" ")}"}`, { status: 400 }));
        const err = await resolveSubscription("tok").catch((e) => e);
        expect(err.message).toBe("resolveSubscription failed: 400");
        expect(err.status).toBe(400);
    });
});

describe("PERIM-09 — status y helpers", () => {
    it("status no publica versión, commit ni latencia", async () => {
        const text = await (await statusGET()).text();
        expect(text).not.toMatch(/version|sha|commit|latency|node|runtime/i);
    });

    it("errorCategory no devuelve mensajes ni códigos con texto arbitrario", () => {
        expect(errorCategory(poison({ code: "ER_X" }))).toBe("ER_X");
        expect(errorCategory(poison({ code: "a b=secret" }))).toBe("Error");
        expect(errorCategory("texto")).toBe("UnknownError");
        expect(actionableCause(poison())).toBeNull();
        expect(actionableCause(poison({ statusCode: 429 }))).toContain("429");
    });
});
